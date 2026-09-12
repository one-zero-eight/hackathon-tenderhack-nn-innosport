import asyncio
import math
import re
from collections import Counter
from html import unescape
from itertools import pairwise
from pathlib import Path
from typing import Any, Protocol

from memvid_sdk import MemvidError, use
from memvid_sdk.embeddings import EmbeddingProvider

from src.logging_ import logger
from src.modules.dialog.models import Chunk
from src.modules.dialog.normalize import ABBREVIATIONS, normalize_text, root_ru, significant_stems
from src.modules.dialog.sources import pdf_source_path

SENTENCE_RE = re.compile(r'(?<=[.!?])\s+(?=[А-ЯЁA-Z«"\d])')
SOURCE_RE = re.compile(r'\bsource:\s*"([^"]+)"', re.IGNORECASE)
SECTION_RE = re.compile(r'\bsection:\s*"([^"]+)"', re.IGNORECASE)
SECTION_TITLE_RE = re.compile(r'\bsection_title:\s*"([^"]+)"', re.IGNORECASE)
PATH_RE = re.compile(r'\bpath:\s*"([^"]+)"', re.IGNORECASE)
SERIALIZED_METADATA_RE = re.compile(
    r"\s+title:\s.*?(?=\s+(?:labels?|path|section|section_title|source|topic_id):)",
    re.IGNORECASE,
)
MIN_RETRIEVAL_SCORE = 2.0
SEARCH_TIMEOUT_SECONDS = 15.0
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
    text = unescape(text).replace("\u00a0", " ").replace("\u00ad", "")
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


def _read_cached_section(chunks: list[Chunk], chunk_id: str, limit: int) -> list[Chunk]:
    """Read forward from a known frame without opening a user-supplied path."""
    anchor = next((chunk for chunk in chunks if chunk.id == chunk_id), None)
    if anchor is None or limit <= 0:
        return []
    section = [chunk for chunk in chunks if (chunk.document, chunk.section) == (anchor.document, anchor.section)]
    section.sort(key=lambda chunk: (0, int(chunk.id)) if chunk.id.isdigit() else (1, chunk.id))
    start = next(index for index, chunk in enumerate(section) if chunk.id == chunk_id)
    return section[start : start + limit]


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
        return _read_cached_section(self.chunks, chunk_id, limit)


class MemvidKnowledgeRetriever:
    """Combine existing vectors with Russian BM25 over the small read-only corpus."""

    def __init__(self, path: Path, embedder: EmbeddingProvider) -> None:
        if not path.is_file():
            raise FileNotFoundError(
                f"Memvid knowledge base not found: {path}. "
                "Place the teammate-produced file there or update knowledge_memvid_path."
            )
        self.path = path
        self.embedder = embedder
        self.memory = use("basic", str(path), read_only=True, enable_lex=True, enable_vec=True)
        self._frame_count = self.memory.stats()["active_frame_count"]
        self._chunks: dict[str, Chunk] = {}
        self._term_counts: dict[str, Counter[str]] = {}
        self._document_frequency: Counter[str] = Counter()
        self._average_length = 1.0
        self._lock = asyncio.Lock()
        self._search_task: asyncio.Task[list[Chunk]] | None = None

    async def find(self, query: str, limit: int = 3) -> list[Chunk]:
        if limit <= 0 or not _query_roots(query):
            return []
        try:
            async with asyncio.timeout(SEARCH_TIMEOUT_SECONDS):
                await self._lock.acquire()
                # Cancellation cannot stop a running thread. Transfer lock ownership
                # to the shielded task so a timed-out query never exposes live caches
                # or the Memvid handle to another concurrent reader/search.
                self._search_task = asyncio.create_task(self._find_locked(query, limit))
                return await asyncio.shield(self._search_task)
        except TimeoutError:
            logger.warning("Memvid retrieval exceeded %.1fs", SEARCH_TIMEOUT_SECONDS)
            return []

    async def _find_locked(self, query: str, limit: int) -> list[Chunk]:
        try:
            return await asyncio.to_thread(self._find_sync, query, limit)
        except MemvidError, RuntimeError, TimeoutError:
            logger.exception("Memvid semantic retrieval failed")
            return []
        finally:
            self._lock.release()

    async def read_section(self, chunk_id: str, limit: int = 6) -> list[Chunk]:
        if limit <= 0:
            return []
        try:
            async with asyncio.timeout(SEARCH_TIMEOUT_SECONDS), self._lock:
                return _read_cached_section(list(self._chunks.values()), chunk_id, limit)
        except TimeoutError:
            logger.warning("Memvid section read exceeded %.1fs", SEARCH_TIMEOUT_SECONDS)
            return []

    def _find_sync(self, query: str, limit: int) -> list[Chunk]:
        if limit <= 0 or not _query_roots(query):
            return []
        # The shipped index has only ~800 frames. Its lexical analyzer matches
        # inflections literally, and sem top-24 misses whole relevant sections.
        # On first use fetch every existing vector's text with the real query;
        # cache a stemmed BM25 index, without writing/reembedding the .mv2 file.
        print(self._frame_count if not self._chunks else max(limit * 12, 64))
        result = self.memory.find(
            query,
            k=self._frame_count if not self._chunks else max(limit * 12, 64),
            mode="sem",
            snippet_chars=16000,
            embedder=self.embedder,
        )
        semantic_ranks: dict[str, int] = {}
        for rank, hit in enumerate(result.get("hits", []), start=1):
            chunk = _hit_to_chunk(hit)
            if chunk is None:
                continue
            semantic_ranks[chunk.id] = rank
            if chunk.id not in self._chunks:
                self._chunks[chunk.id] = chunk
                counts = Counter(_content_roots(chunk.text))
                self._term_counts[chunk.id] = counts
                self._document_frequency.update(counts.keys())
        self._average_length = sum(counts.total() for counts in self._term_counts.values()) / max(len(self._chunks), 1)
        query_roots = _query_roots(query)
        ranked: list[tuple[float, Chunk]] = []
        seen: set[str] = set()
        for chunk in self._chunks.values():
            lexical_score = score_chunk(query, chunk)
            if lexical_score < MIN_RETRIEVAL_SCORE:
                continue
            key = normalize_text(chunk.text)
            if key in seen:
                continue
            seen.add(key)
            counts = self._term_counts[chunk.id]
            bm25 = 0.0
            for root in query_roots:
                frequency = counts[root]
                if not frequency:
                    continue
                document_frequency = self._document_frequency[root]
                inverse_frequency = math.log(
                    1 + (len(self._chunks) - document_frequency + 0.5) / (document_frequency + 0.5)
                )
                denominator = frequency + 1.5 * (0.25 + 0.75 * counts.total() / self._average_length)
                bm25 += GENERIC_ROOT_WEIGHTS.get(root, 1.0) * inverse_frequency * frequency * 2.5 / denominator
            # Query coverage and local proximity prevent generic search instructions
            # or a repeated contract keyword from outranking the requested subject.
            coverage = len(query_roots & counts.keys()) / len(query_roots)
            proximity = max(
                (len(query_roots & set(window)) for window in _root_windows(chunk.text)),
                default=0,
            ) / len(query_roots)
            semantic_score = 1 / (1 + semantic_ranks.get(chunk.id, self._frame_count) / 20)
            score = bm25 + lexical_score + 4 * coverage**2 + 3 * proximity**2 + semantic_score
            ranked.append((score, chunk))
        ranked.sort(key=lambda item: item[0], reverse=True)
        if not ranked:
            return []
        # Small ingestion chunks split lists mid-answer. Keep the strongest
        # passage with its immediate same-section continuations, even when a
        # continuation does not repeat the user's subject (e.g. portal features).
        best_score, anchor = ranked[0]
        chunks = [anchor]
        if anchor.id.isdigit():
            for offset in range(1, limit):
                continuation = self._chunks.get(str(int(anchor.id) + offset))
                if (
                    continuation is None
                    or continuation.document != anchor.document
                    or continuation.section != anchor.section
                ):
                    break
                chunks.append(continuation)
        # Preserve relevance order across sections, never global frame order.
        selected_ids = {chunk.id for chunk in chunks}
        for score, chunk in ranked[1:]:
            if len(chunks) >= limit or score < best_score * 0.85:
                break
            if chunk.id not in selected_ids:
                chunks.append(chunk)
                selected_ids.add(chunk.id)
        return chunks[:limit]


def _root_windows(text: str) -> list[list[str]]:
    roots = _roots(text)
    return [roots[index : index + 16] for index in range(0, len(roots), 8)]


def _metadata(hit: dict[str, Any]) -> dict[str, Any]:
    value = hit.get("metadata")
    return value if isinstance(value, dict) else {}


def _hit_to_chunk(hit: dict[str, Any]) -> Chunk | None:
    raw_text = str(hit.get("text") or hit.get("snippet") or "").strip()
    if not raw_text:
        return None
    marker = SERIALIZED_METADATA_RE.search(raw_text)
    text = clean_source_text(raw_text[: marker.start()] if marker else raw_text)
    if not text:
        return None
    metadata = _metadata(hit)
    document = str(metadata.get("document") or metadata.get("source") or "").strip()
    section_number = str(metadata.get("section") or "").strip()
    section_title = str(metadata.get("section_title") or "").strip()
    path = str(metadata.get("path") or "").strip()

    # The existing notebook used the "langchain" adapter, which may serialize
    # metadata into the text instead of returning a metadata object.
    if not document and (match := SOURCE_RE.search(raw_text)):
        document = match.group(1)
    if not section_number and (match := SECTION_RE.search(raw_text)):
        section_number = match.group(1)
    if not section_title and (match := SECTION_TITLE_RE.search(raw_text)):
        section_title = match.group(1)
    if not path and (match := PATH_RE.search(raw_text)):
        path = match.group(1)
    if document and not path:
        path = f"docs/{document}"
    if not document or not path:
        return None
    section = " ".join(part for part in (section_number, section_title) if part)
    if not section:
        section = str(hit.get("title") or "Раздел не указан")
    return Chunk(
        id=str(hit.get("frame_id") or hit.get("uri") or ""),
        text=text,
        document=document,
        section=" ".join(clean_source_text(re.sub(r"#{1,6}\s*", "", section)).split())
        or section_number
        or "Раздел не указан",
        path=pdf_source_path(document, text) or path,
    )


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
