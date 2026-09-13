import asyncio
import re
from html import unescape
from itertools import pairwise
from pathlib import PurePosixPath
from typing import Any, Protocol

from beanie import PydanticObjectId

from src.logging_ import logger
from src.modules.dialog.embeddings import OllamaEmbeddings
from src.modules.dialog.models import Chunk
from src.modules.dialog.normalize import ABBREVIATIONS, normalize_text, root_ru, significant_stems
from src.modules.dialog.sources import pdf_source_path
from src.storages.mongo.knowledge import TEXT_INDEX_NAME, VECTOR_INDEX_NAME, KnowledgeChunk

SENTENCE_RE = re.compile(r'(?<=[.!?])\s+(?=[А-ЯЁA-Z«"\d])')
MIN_RETRIEVAL_SCORE = 2.0
SEARCH_TIMEOUT_SECONDS = 15.0
# How many candidates each Mongo search stage contributes to the pool that gets
# reranked in Python (below). numCandidates is oversampled relative to limit,
# as Atlas Vector Search recommends, since it just controls recall internally.
CANDIDATE_LIMIT = 50
VECTOR_NUM_CANDIDATES = 400
# Expand language, not support topics: the subject (including «поставщик»)
# must remain in the query even when it also appears in the portal name.
SEARCH_SYNONYMS = (
    ("найти", "поиск", "искать"),
    ("сайт", "портал"),
    ("сведения", "информация"),
    ("страница", "карточка"),
    ("возможности", "функциональность", "функционал"),
)
ROOT_ALIASES = {
    root_ru(stem): root_ru(significant_stems(words[0])[0])
    for words in SEARCH_SYNONYMS
    for word in words
    for stem in significant_stems(word)
}
GENERIC_ROOT_WEIGHTS = {
    ROOT_ALIASES.get(root_ru(stem), root_ru(stem)): weight
    for word, weight in (("найти", 0.45), ("сведения", 0.55), ("страница", 0.8), ("сайт", 0.65))
    for stem in significant_stems(word)
}


def _roots(text: str) -> list[str]:
    return [ROOT_ALIASES.get(root_ru(word), root_ru(word)) for word in significant_stems(text)]


def _content_roots(text: str) -> list[str]:
    # The product name is not evidence that a passage discusses suppliers.
    text = re.sub(r"\b(портал[а-я]*)\s+поставщиков\b", r"\1", text, flags=re.IGNORECASE)
    return _roots(text)


def clean_source_text(text: str) -> str:
    """Remove PDF decoration without changing instructions or Markdown tables."""
    text = unescape(text).replace(" ", " ").replace("­", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"</?(?:mark|u|span|p|div|strong|em|b|i)(?:\s[^>]*)?>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    # Captions and headings are often glued to the next paragraph by PDF ingestion.
    text = re.sub(r"(?:#{1,6}\s*)?\*\*Рисунок\s+\d+[^*]*\*\*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"#{1,6}\s*\*\*([^*]+)\*\*", r"\n\n\1\n\n", text)
    text = re.sub(r"\(\s*(?:\*\*)?Рисунок\s+\d+(?:[.,–-]\s*\d+)*(?:\*\*)?\s*\)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?m)^\s*Рисунок\s+\d+\s*[–—-].*$", "", text)
    text = text.replace("**", "")
    text = re.sub(r"(?<!\w)_([^_\n]+)_(?!\w)", r"\1", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r" +([.,;:!?])", r"\1", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _query_roots(text: str) -> set[str]:
    roots = set(_roots(text))
    # «Какие сведения можно найти ...» asks about contents, not how to search.
    if ROOT_ALIASES[root_ru(significant_stems("сведения")[0])] in roots:
        roots.discard(ROOT_ALIASES[root_ru(significant_stems("найти")[0])])
    return roots


def _sentences(text: str) -> list[str]:
    parts = [re.sub(r"\s+", " ", part).strip() for part in SENTENCE_RE.split(text)]
    return [part for part in parts if part]


def _pipe_cells(line: str) -> list[str] | None:
    """Split Markdown cells on unescaped pipes, including optional outer pipes."""
    if line.startswith(("    ", "\t")):
        return None
    line = line.strip()
    separators: list[int] = []
    escaped = False
    for index, character in enumerate(line):
        if character == "|" and not escaped:
            separators.append(index)
        escaped = character == "\\" and not escaped
    if not separators:
        return None
    boundaries = [-1, *separators, len(line)]
    cells = [line[start + 1 : end].strip() for start, end in pairwise(boundaries)]
    if separators[0] == 0:
        cells.pop(0)
    if separators[-1] == len(line) - 1:
        cells.pop()
    return cells


def _reply_units(text: str) -> list[tuple[str, bool]]:
    """Keep pipe tables whole before normalizing or splitting prose sentences."""
    lines = text.splitlines()
    units: list[tuple[str, bool]] = []
    prose: list[str] = []

    def flush_prose() -> None:
        paragraph = "\n".join(prose).strip()
        if paragraph:
            # Do not separate a condition or a list introduction from its steps.
            sentences = (
                [paragraph]
                if ":" in paragraph or re.search(r"(?m)^\s*(?:[-*•]|\d+[.)])\s", paragraph)
                else _sentences(paragraph) or [re.sub(r"\s+", " ", paragraph)]
            )
            units.extend((sentence, False) for sentence in sentences)
        prose.clear()

    index = 0
    fence: str | None = None
    while index < len(lines):
        line = lines[index]
        fence_match = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence_match:
            marker = fence_match.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
        header = _pipe_cells(line) if fence is None else None
        delimiter = _pipe_cells(lines[index + 1]) if index + 1 < len(lines) else None
        if (
            header
            and delimiter
            and len(header) == len(delimiter)
            and all(re.fullmatch(r":?-+:?", cell) for cell in delimiter)
        ):
            flush_prose()
            end = index + 2
            while end < len(lines) and _pipe_cells(lines[end]):
                end += 1
            units.append(("\n".join(lines[index:end]).strip(), True))
            index = end
        else:
            if line.strip():
                prose.append(line)
            else:
                flush_prose()
            index += 1
    flush_prose()
    return units


def score_chunk(query: str, chunk: Chunk) -> float:
    query_stems = _query_roots(query)
    if not query_stems:
        return 0.0
    chunk_stems = set(_content_roots(chunk.text))
    overlap = query_stems & chunk_stems
    if not overlap:
        return 0.0
    heading_roots = _roots(chunk.section)
    # PDF page metadata sometimes contains an entire unrelated paragraph.
    heading_stems = set(heading_roots) if len(heading_roots) <= 12 else set()
    subject_roots = query_stems - GENERIC_ROOT_WEIGHTS.keys()
    # A search verb or a portal mention alone does not answer a subject question.
    if subject_roots and not subject_roots & (chunk_stems | heading_stems):
        return 0.0
    abbreviation_overlap = overlap & ABBREVIATIONS
    coverage = len(overlap) / len(query_stems)
    return (
        2.0 * sum(GENERIC_ROOT_WEIGHTS.get(root, 1.0) for root in overlap)
        + len(abbreviation_overlap)
        + 2.0 * len(query_stems & heading_stems)
        + coverage
    )


def _root_windows(text: str) -> list[list[str]]:
    roots = _roots(text)
    return [roots[index : index + 16] for index in range(0, len(roots), 8)]


def _object_id(value: str) -> PydanticObjectId | None:
    if re.fullmatch(r"[0-9a-fA-F]{24}", value) is None:
        return None
    return PydanticObjectId(value)


def _build_chunk(
    *, doc_id: str, text: str, document: str, section_number: str, section_title: str, path: str, order: int
) -> Chunk | None:
    cleaned = clean_source_text(text.strip())
    path = path.strip()
    document = document.strip() or PurePosixPath(path).name
    if not cleaned:
        return None
    section = " ".join(part for part in (section_number.strip(), section_title.strip()) if part)
    source_path = pdf_source_path(document, cleaned) or path
    return Chunk(id=doc_id, text=cleaned, document=document, section=section, path=source_path, order=order)


def _chunk_from_raw(doc: dict[str, Any]) -> Chunk | None:
    path = str(doc.get("path") or "")
    document = str(doc.get("document") or "")
    return _build_chunk(
        doc_id=str(doc.get("_id", "")),
        text=str(doc.get("text") or ""),
        document=document,
        section_number=str(doc.get("section_number") or ""),
        section_title=str(doc.get("section_title") or ""),
        path=path,
        order=int(doc.get("order") or 0),
    )


def _chunk_from_document(row: KnowledgeChunk) -> Chunk | None:
    return _build_chunk(
        doc_id=str(row.id),
        text=row.text,
        document=row.document,
        section_number=row.section_number,
        section_title=row.section_title,
        path=row.path,
        order=row.order,
    )


class KnowledgeRetriever(Protocol):
    async def find(self, query: str, limit: int = 3) -> list[Chunk]: ...

    async def read_section(self, chunk_id: str, limit: int = 6) -> list[Chunk]: ...


class MemoryKnowledgeRetriever:
    """Deterministic retriever used by tests."""

    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks

    async def find(self, query: str, limit: int = 3) -> list[Chunk]:
        ranked = [(score_chunk(query, chunk), chunk) for chunk in self.chunks]
        ranked = [item for item in ranked if item[0] >= MIN_RETRIEVAL_SCORE]
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [chunk for _score, chunk in ranked[:limit]]

    async def read_section(self, chunk_id: str, limit: int = 6) -> list[Chunk]:
        anchor = next((chunk for chunk in self.chunks if chunk.id == chunk_id), None)
        if anchor is None or limit <= 0:
            return []
        section = [c for c in self.chunks if (c.document, c.section) == (anchor.document, anchor.section)]
        section.sort(key=lambda c: c.order)
        start = next(index for index, c in enumerate(section) if c.id == chunk_id)
        return section[start : start + limit]


class MongoKnowledgeRetriever:
    """Semantic ($vectorSearch) + lexical (Atlas $search) candidate generation,
    reranked with the Russian root-stemmed subject scorer below."""

    def __init__(self, embedder: OllamaEmbeddings) -> None:
        self.embedder = embedder

    async def find(self, query: str, limit: int = 3) -> list[Chunk]:
        if limit <= 0 or not _query_roots(query):
            return []
        try:
            async with asyncio.timeout(SEARCH_TIMEOUT_SECONDS):
                return await self._find(query, limit)
        except TimeoutError:
            logger.warning("Mongo knowledge retrieval exceeded %.1fs", SEARCH_TIMEOUT_SECONDS)
            return []

    async def _find(self, query: str, limit: int) -> list[Chunk]:
        collection = KnowledgeChunk.get_motor_collection()
        query_vector = await asyncio.to_thread(self.embedder.embed_query, query)

        vector_pipeline = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX_NAME,
                    "path": "embedding",
                    "queryVector": query_vector,
                    "numCandidates": VECTOR_NUM_CANDIDATES,
                    "limit": CANDIDATE_LIMIT,
                }
            },
            {"$project": {"embedding": 0}},
        ]
        text_pipeline = [
            {"$search": {"index": TEXT_INDEX_NAME, "text": {"query": query, "path": ["text", "section_title"]}}},
            {"$limit": CANDIDATE_LIMIT},
            {"$project": {"embedding": 0}},
        ]

        vector_hits, text_hits = await asyncio.gather(
            collection.aggregate(vector_pipeline).to_list(length=CANDIDATE_LIMIT),
            collection.aggregate(text_pipeline).to_list(length=CANDIDATE_LIMIT),
        )

        raw_by_id: dict[str, dict[str, Any]] = {}
        chunks: dict[str, Chunk] = {}
        semantic_ranks: dict[str, int] = {}
        lexical_ranks: dict[str, int] = {}
        for rank, doc in enumerate(vector_hits, start=1):
            chunk = _chunk_from_raw(doc)
            if chunk is None:
                continue
            chunks[chunk.id] = chunk
            raw_by_id[chunk.id] = doc
            semantic_ranks[chunk.id] = rank
        for rank, doc in enumerate(text_hits, start=1):
            chunk = _chunk_from_raw(doc)
            if chunk is None:
                continue
            chunks.setdefault(chunk.id, chunk)
            raw_by_id.setdefault(chunk.id, doc)
            lexical_ranks[chunk.id] = rank

        query_roots = _query_roots(query)
        ranked: list[tuple[float, Chunk]] = []
        seen: set[str] = set()
        for chunk in chunks.values():
            subject_score = score_chunk(query, chunk)
            if subject_score < MIN_RETRIEVAL_SCORE:
                continue
            key = normalize_text(chunk.text)
            if key in seen:
                continue
            seen.add(key)
            coverage = len(query_roots & set(_content_roots(chunk.text))) / len(query_roots)
            proximity = max(
                (len(query_roots & set(window)) for window in _root_windows(chunk.text)),
                default=0,
            ) / len(query_roots)
            # Rank-decay both native Mongo signals the same way the old memvid
            # semantic rank was decayed, since neither's raw score is directly
            # comparable to the hand-rolled subject_score/coverage/proximity terms.
            semantic_score = 1 / (1 + semantic_ranks.get(chunk.id, CANDIDATE_LIMIT * 4) / 20)
            lexical_score = 1 / (1 + lexical_ranks.get(chunk.id, CANDIDATE_LIMIT * 4) / 20)
            score = semantic_score + lexical_score + subject_score + 4 * coverage**2 + 3 * proximity**2
            ranked.append((score, chunk))
        ranked.sort(key=lambda item: item[0], reverse=True)
        if not ranked:
            return []

        # Small ingestion chunks split lists mid-answer. Keep the strongest
        # passage with its immediate same-section continuations, even when a
        # continuation does not repeat the user's subject (e.g. portal features).
        best_score, anchor = ranked[0]
        selected = [anchor]
        selected_ids = {anchor.id}
        for continuation in await self._fetch_continuations(raw_by_id[anchor.id], limit):
            if len(selected) >= limit:
                break
            if continuation.id not in selected_ids:
                selected.append(continuation)
                selected_ids.add(continuation.id)
        # Preserve relevance order across sections, never global frame order.
        for score, chunk in ranked[1:]:
            if len(selected) >= limit or score < best_score * 0.85:
                break
            if chunk.id not in selected_ids:
                selected.append(chunk)
                selected_ids.add(chunk.id)
        return selected[:limit]

    @staticmethod
    async def _fetch_continuations(anchor_doc: dict[str, Any], limit: int) -> list[Chunk]:
        if limit <= 1:
            return []
        rows = await (
            KnowledgeChunk.find(
                {
                    "document": anchor_doc.get("document"),
                    "section_number": anchor_doc.get("section_number", ""),
                    "section_title": anchor_doc.get("section_title", ""),
                    "order": {"$gt": anchor_doc.get("order", 0)},
                }
            )
            .sort("+order")
            .limit(limit - 1)
            .to_list()
        )
        continuations: list[Chunk] = []
        expected = int(anchor_doc.get("order", 0)) + 1
        for row in rows:
            if row.order != expected:
                break
            chunk = _chunk_from_document(row)
            if chunk is not None:
                continuations.append(chunk)
            expected += 1
        return continuations

    async def read_section(self, chunk_id: str, limit: int = 6) -> list[Chunk]:
        if limit <= 0:
            return []
        object_id = _object_id(chunk_id)
        if object_id is None:
            return []
        try:
            async with asyncio.timeout(SEARCH_TIMEOUT_SECONDS):
                anchor = await KnowledgeChunk.get(object_id)
                if anchor is None:
                    return []
                rows = await (
                    KnowledgeChunk.find(
                        {
                            "document": anchor.document,
                            "section_number": anchor.section_number,
                            "section_title": anchor.section_title,
                            "order": {"$gte": anchor.order},
                        }
                    )
                    .sort("+order")
                    .limit(limit)
                    .to_list()
                )
                return [chunk for row in rows if (chunk := _chunk_from_document(row)) is not None]
        except TimeoutError:
            logger.warning("Mongo knowledge section read exceeded %.1fs", SEARCH_TIMEOUT_SECONDS)
            return []


def is_complete_prose(text: str) -> bool:
    return bool(re.search(r'[.!?][»”"\')]*$', text)) and all(
        text.count(opening) == text.count(closing) for opening, closing in (("«", "»"), ("(", ")"), ("[", "]"))
    )


def extractive_answer(query: str, chunks: list[Chunk], limit: int = 1800) -> tuple[str, list[Chunk]]:
    """Keep complete source paragraphs, their order and only the citations used."""
    selected: list[str] = []
    cited: list[Chunk] = []
    seen: set[str] = set()
    used = 0
    for chunk in chunks:
        if score_chunk(query, chunk) < MIN_RETRIEVAL_SCORE:
            continue
        paragraphs: list[str] = []
        for text, is_table in _reply_units(clean_source_text(chunk.text)):
            key = normalize_text(text)
            if key in seen:
                continue
            # A broken table row or an unfinished PDF sentence is not an answer.
            if not is_table and ("|" in text or not is_complete_prose(text)):
                continue
            separator_size = 2 if selected or paragraphs else 0
            if used + separator_size + len(text) > limit:
                break
            paragraphs.append(text)
            seen.add(key)
            used += separator_size + len(text)
        if paragraphs:
            selected.append("\n\n".join(paragraphs))
            cited.append(chunk)
    return "\n\n".join(selected), cited
