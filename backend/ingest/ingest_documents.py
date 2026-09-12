import hashlib
import json
import os
import re
import time as tm
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pymongo
import pymongo.errors
import pymupdf4llm
from langchain_text_splitters import RecursiveCharacterTextSplitter
from shared import embedder

DOCS_DIR = Path(__file__).parent / "documents"
# Must match backend/src/storages/mongo/knowledge.py's KnowledgeChunk.Settings —
# duplicated, not imported, since backend/ingest deliberately doesn't depend on
# the backend package (see [[backend-ingest-separate-project]]).
COLLECTION_NAME = "knowledge_chunks"
VECTOR_INDEX_NAME = "knowledge_vector_index"
TEXT_INDEX_NAME = "knowledge_text_index"
EMBEDDING_DIMENSION = 1024  # mxbai-embed-large
MONGO_URI = "mongodb://localhost/db?directConnection=true"

# mxbai-embed-large's Ollama context window is 512 tokens; Cyrillic text runs
# well under 1 char/token, so keep chunks well short of that to avoid MV_HTTP 500s.
CHUNK_SIZE = 400
CHUNK_OVERLAP = 40
# Ollama embeds one text at a time (see shared.py), so the real parallelism
# comes from running several batches' worth of HTTP calls concurrently, not
# from batch size itself; each batch is embedded+inserted as a unit so partial
# progress is saved incrementally instead of one giant insert at the end.
BATCH_SIZE = 32
MAX_WORKERS = 6

GLOSSARY_SECTION_TITLE = "Глоссарий"
# 0-indexed page numbers (pymupdf4llm convention) of each document's glossary
# table, found by inspecting these PDFs directly. pdftotext's plain-text body
# extraction below can't reconstruct table structure, so these few pages get a
# second, table-aware pass via pymupdf4llm instead.
GLOSSARY_PAGES = {
    "Инструкция_по_работе_с_Порталом_для_поставщика.pdf": [3, 4],
    "Инструкция_по_созданию_оферты_и_СТЕ.pdf": [2],
    "Инструкция_по_электронному_актированию.pdf": [3],
}


def clean_text(text: str) -> str:
    text = text.replace("\x0c", "\n")  # page-break marker -> plain newline
    # Bullet lists use a custom font glyph that lands in the Private Use Area;
    # it always sits at the start of a bulleted line, so normalize it to "-".
    text = re.sub(r"(?m)^[-]\s*", "- ", text)
    text = re.sub(r"[-]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text


def extract_glossary(pdf_path: Path, pages: list[int]) -> list[dict]:
    """Glossary tables need pymupdf4llm's table-aware extraction — pdftotext's
    plain text can't reconstruct rows/columns."""
    document = pdf_path.name
    path = str(pdf_path)
    data = json.loads(pymupdf4llm.to_json(pdf_path, pages=pages))
    rows: list[list[str]] = []
    for page in data.get("pages", []):
        for block in page.get("boxes", []):
            if block.get("boxclass") == "table":
                rows.extend(block["table"]["extract"][1:])  # skip header row

    items = []
    for row in rows:
        # Most glossary tables here are (term, definition); one has a leading
        # "№ п/п" column, i.e. (number, term, definition) - term/definition
        # are always the last two cells regardless.
        if len(row) < 2:
            continue
        term, definition = row[-2].strip(), row[-1].strip()
        if not term or not definition:
            continue
        items.append(
            {
                "text": f"{term} — {definition}",
                "document": document,
                "section_number": "",
                "section_title": GLOSSARY_SECTION_TITLE,
                "path": path,
                "label": "glossary",
                "term": term,
            }
        )
    return items


def add_text_hash(item: dict) -> dict:
    item["text_hash"] = hashlib.sha256(item["text"].encode("utf-8")).hexdigest()
    return item


def assign_order(items: list[dict]) -> None:
    """0-based order local to each (document, section_number, section_title)
    group, in emission order - replaces memvid's numeric-frame-id trick for
    "read forward within this section"."""
    counters: dict[tuple[str, str, str], int] = {}
    for item in items:
        key = (item["document"], item["section_number"], item["section_title"])
        item["order"] = counters.get(key, 0)
        counters[key] = item["order"] + 1


def ensure_plain_indexes(collection) -> None:
    """Non-search indexes - created before any inserts so the unique index
    actually enforces dedup as concurrent batches write, instead of just
    detecting duplicates after the fact. Names must match
    backend/src/storages/mongo/knowledge.py's KnowledgeChunk.Settings.indexes
    exactly, since Beanie may have already created these against the same
    collection (both are idempotent no-ops when they already match)."""
    collection.create_index([("text_hash", 1)], name="text_hash", unique=True)
    collection.create_index(
        [("document", 1), ("section_number", 1), ("section_title", 1), ("order", 1)],
        name="document_section_order",
    )


def ensure_search_indexes(collection) -> None:
    existing = {index["name"] for index in collection.list_search_indexes()}
    created = []
    if VECTOR_INDEX_NAME not in existing:
        collection.create_search_index(
            {
                "name": VECTOR_INDEX_NAME,
                "type": "vectorSearch",
                "definition": {
                    "fields": [
                        {
                            "type": "vector",
                            "path": "embedding",
                            "numDimensions": EMBEDDING_DIMENSION,
                            "similarity": "cosine",
                        }
                    ]
                },
            }
        )
        created.append(VECTOR_INDEX_NAME)
    if TEXT_INDEX_NAME not in existing:
        collection.create_search_index(
            {
                "name": TEXT_INDEX_NAME,
                "definition": {
                    "mappings": {
                        "dynamic": False,
                        "fields": {
                            "text": {"type": "string", "analyzer": "lucene.russian"},
                            "section_title": {"type": "string", "analyzer": "lucene.russian"},
                        },
                    }
                },
            }
        )
        created.append(TEXT_INDEX_NAME)

    if not created:
        return
    print(f"Waiting for search indexes to build: {created}")
    deadline = tm.monotonic() + 180
    while tm.monotonic() < deadline:
        statuses = {index["name"]: index for index in collection.list_search_indexes()}
        if all(statuses.get(name, {}).get("queryable") for name in created):
            print("Search indexes are queryable.")
            return
        tm.sleep(2)
    raise TimeoutError(f"Search indexes did not become queryable in time: {created}")


def embed_and_insert_batch(collection, batch: list[dict]) -> tuple[int, int]:
    """Embed one batch and save it immediately, so progress lands in Mongo as
    each batch finishes rather than only after every batch has embedded."""
    embeddings = embedder.embed_documents([item["text"] for item in batch])
    for item, embedding in zip(batch, embeddings, strict=True):
        item["embedding"] = [float(x) for x in embedding]
    try:
        result = collection.insert_many(batch, ordered=False)
        return len(result.inserted_ids), 0
    except pymongo.errors.BulkWriteError as exc:
        write_errors = exc.details.get("writeErrors", [])
        duplicates = [e for e in write_errors if e.get("code") == 11000]
        if len(duplicates) != len(write_errors):
            raise
        return len(batch) - len(duplicates), len(duplicates)


def main() -> None:
    items: list[dict] = []
    splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
    for pdf_path in sorted(DOCS_DIR.glob("*.pdf")):
        text = clean_text(pymupdf4llm.to_markdown(pdf_path))
        rows = [
            {
                "text": chunk,
                "document": pdf_path.name,
                "section_number": "",
                "section_title": "",
                "path": str(pdf_path),
                "label": "manual",
                "term": None,
            }
            for chunk in splitter.split_text(text)
        ]
        items.extend(rows)
        if pdf_path.name in GLOSSARY_PAGES:
            items.extend(extract_glossary(pdf_path, GLOSSARY_PAGES[pdf_path.name]))

    if not items:
        print("No content extracted from documents/, nothing to ingest.")
        return

    assign_order(items)
    for item in items:
        add_text_hash(item)

    client = pymongo.MongoClient(MONGO_URI)
    collection = client.get_database()[COLLECTION_NAME]
    collection.delete_many({})
    ensure_plain_indexes(collection)

    batches = [items[i : i + BATCH_SIZE] for i in range(0, len(items), BATCH_SIZE)]
    inserted_total = 0
    duplicate_total = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(embed_and_insert_batch, collection, batch) for batch in batches]
        for done, future in enumerate(as_completed(futures), start=1):
            inserted, duplicates = future.result()
            inserted_total += inserted
            duplicate_total += duplicates
            print(f"Batch {done}/{len(batches)} done ({inserted} inserted, {duplicates} duplicate text skipped)")

    ensure_search_indexes(collection)
    client.close()
    print(
        f"Ingested {inserted_total} chunks ({duplicate_total} duplicate text skipped) "
        f"from {DOCS_DIR} into {COLLECTION_NAME}"
    )


if __name__ == "__main__":
    main()
