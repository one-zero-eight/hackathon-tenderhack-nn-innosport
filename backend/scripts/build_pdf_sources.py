"""Copy source PDFs and locate knowledge fragments on their physical PDF pages.

Run from backend/: uv run python scripts/build_pdf_sources.py
Requires Poppler's pdftotext at build time, not in the API container.
"""

import hashlib
import json
import re
import shutil
import subprocess  # noqa: S404
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote

from memvid_sdk import use

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))

from src.modules.dialog.retrieval import SERIALIZED_METADATA_RE, SOURCE_RE, clean_source_text  # noqa: E402


def document_key(name: str) -> str:
    return Path(name).stem.replace("_", " ").casefold()


def shingles(text: str) -> set[tuple[str, ...]]:
    words = re.findall(r"[а-яa-z0-9]+", clean_source_text(text).casefold().replace("ё", "е"))
    return {tuple(words[index : index + 3]) for index in range(len(words) - 2)}


def main() -> None:
    static_dir = BACKEND_DIR / "staticfiles"
    static_dir.mkdir(exist_ok=True)
    documents = {}
    for source in sorted((BACKEND_DIR.parent / "data").glob("*.pdf")):
        shutil.copy2(source, static_dir / source.name)
        result = subprocess.run(["pdftotext", str(source), "-"], capture_output=True, check=True)  # noqa: S603, S607
        pages = result.stdout.decode("utf-8").split("\f")
        page_index = defaultdict(set)
        for number, text in enumerate(pages, start=1):
            for shingle in shingles(text):
                page_index[shingle].add(number)
        documents[document_key(source.name)] = (source.name, page_index)
    if not documents:
        raise RuntimeError("No PDFs found in data/")

    memory = use("basic", str(BACKEND_DIR / "data" / "knowledge.mv2"), read_only=True)
    sources = {}
    unmatched = []
    try:
        stats = memory.stats()
        # Export every vector's text: requesting the whole corpus makes ranking irrelevant.
        # This avoids re-embedding and the lexical index's incomplete label matches.
        hits = memory.find(
            "sources",
            k=stats["active_frame_count"],
            mode="sem",
            query_embedding=[1.0] + [0.0] * (stats["effective_vec_dimension"] - 1),
            snippet_chars=16000,
        )["hits"]
        if len({hit["frame_id"] for hit in hits}) != stats["active_frame_count"]:
            raise RuntimeError("Source query did not return every knowledge frame")
        for hit in hits:
            uri = hit["uri"]
            raw_text = hit["text"]
            source_match = SOURCE_RE.search(raw_text)
            if source_match is None:
                unmatched.append(uri)
                continue
            document = documents.get(document_key(source_match.group(1)))
            if document is None:
                unmatched.append(uri)
                continue
            filename, page_index = document
            marker = SERIALIZED_METADATA_RE.search(raw_text)
            text = clean_source_text(raw_text[: marker.start()] if marker else raw_text)
            fragments = shingles(text)
            scores = Counter(page for fragment in fragments for page in page_index.get(fragment, ()))
            if not scores:
                unmatched.append(uri)
                continue
            page = max(scores, key=lambda number: (scores[number], -number))
            score = scores[page]
            if score < min(3, len(fragments)) or score / max(len(fragments), 1) < 0.12:
                unmatched.append(uri)
                continue
            digest = hashlib.sha256(text.encode()).hexdigest()
            sources[f"{source_match.group(1)}:{digest}"] = f"/staticfiles/{quote(filename)}#page={page}"
    finally:
        memory.close()
    (BACKEND_DIR / "data" / "pdf_sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Copied {len(documents)} PDFs; located {len(sources)} fragments; unmatched: {len(unmatched)}")
    if unmatched:
        print("Unmatched frames:", ", ".join(unmatched))


if __name__ == "__main__":
    main()
