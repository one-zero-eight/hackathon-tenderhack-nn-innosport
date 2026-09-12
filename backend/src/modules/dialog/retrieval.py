import asyncio
import re
from itertools import pairwise
from pathlib import Path
from typing import Any, Protocol

from memvid_sdk import MemvidError, use
from memvid_sdk.embeddings import EmbeddingProvider

from src.logging_ import logger
from src.modules.dialog.models import Chunk
from src.modules.dialog.normalize import ABBREVIATIONS, significant_stems

SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
SOURCE_RE = re.compile(r'\bsource:\s*"([^"]+)"', re.IGNORECASE)
SECTION_RE = re.compile(r'\bsection:\s*"([^"]+)"', re.IGNORECASE)
SECTION_TITLE_RE = re.compile(r'\bsection_title:\s*"([^"]+)"', re.IGNORECASE)
PATH_RE = re.compile(r'\bpath:\s*"([^"]+)"', re.IGNORECASE)
SERIALIZED_METADATA_RE = re.compile(
    r"\s+title:\s.*?(?=\s+(?:labels?|path|section|section_title|source|topic_id):)",
    re.IGNORECASE,
)
MIN_RETRIEVAL_SCORE = 2.2


def _sentences(text: str) -> list[str]:
    parts = [re.sub(r"\s+", " ", part).strip() for part in SENTENCE_RE.split(text)]
    return [part for part in parts if len(part) >= 25]


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
            sentences = _sentences(paragraph) or [re.sub(r"\s+", " ", paragraph)]
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
    query_stems = set(significant_stems(query))
    if not query_stems:
        return 0.0
    chunk_stems = set(significant_stems(chunk.text))
    overlap = query_stems & chunk_stems
    heading_stems = set(significant_stems(chunk.section))
    abbreviation_overlap = overlap & ABBREVIATIONS
    return 2.0 * len(overlap) + len(abbreviation_overlap) + 1.2 * len(query_stems & heading_stems)


class KnowledgeRetriever(Protocol):
    async def find(self, query: str, limit: int = 3) -> list[Chunk]: ...


class MemoryKnowledgeRetriever:
    """Deterministic retriever used by tests."""

    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks

    async def find(self, query: str, limit: int = 3) -> list[Chunk]:
        ranked = [(score_chunk(query, chunk), chunk) for chunk in self.chunks]
        ranked = [item for item in ranked if item[0] >= MIN_RETRIEVAL_SCORE]
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [chunk for _score, chunk in ranked[:limit]]


class MemvidKnowledgeRetriever:
    """Read-only semantic search over the teammate-produced single-file .mv2."""

    def __init__(self, path: Path, embedder: EmbeddingProvider) -> None:
        if not path.is_file():
            raise FileNotFoundError(
                f"Memvid knowledge base not found: {path}. "
                "Place the teammate-produced file there or update knowledge_memvid_path."
            )
        self.path = path
        self.embedder = embedder
        self.memory = use("basic", str(path), read_only=True, enable_lex=False, enable_vec=True)
        self._lock = asyncio.Lock()

    async def find(self, query: str, limit: int = 3) -> list[Chunk]:
        try:
            async with self._lock:
                return await asyncio.to_thread(self._find_sync, query, limit)
        except MemvidError:
            logger.exception("Memvid semantic retrieval failed")
            return []

    def _find_sync(self, query: str, limit: int) -> list[Chunk]:
        result = self.memory.find(
            query,
            k=max(limit * 3, 8),
            mode="sem",
            snippet_chars=1400,
            embedder=self.embedder,
        )
        chunks: list[Chunk] = []
        for hit in result.get("hits", []):
            chunk = _hit_to_chunk(hit)
            if chunk is None:
                continue
            chunks.append(chunk)
            if len(chunks) >= limit:
                break
        return chunks


def _metadata(hit: dict[str, Any]) -> dict[str, Any]:
    value = hit.get("metadata")
    return value if isinstance(value, dict) else {}


def _hit_to_chunk(hit: dict[str, Any]) -> Chunk | None:
    raw_text = str(hit.get("text") or hit.get("snippet") or "").strip()
    if not raw_text:
        return None
    marker = SERIALIZED_METADATA_RE.search(raw_text)
    text = raw_text[: marker.start()].strip() if marker else raw_text
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
        section=section,
        path=path,
    )


def extractive_reply(query: str, chunks: list[Chunk], limit: int = 900) -> str:
    """Rank sentences and whole tables, returning blank-line-separated paragraphs.

    The character budget includes paragraph separators. Tables that do not fit
    are omitted (even if that leaves an empty reply); only prose may be clipped.
    """
    if limit <= 0:
        return ""
    query_stems = set(significant_stems(query))
    selected: list[str] = []
    seen: set[str] = set()
    used = 0
    for chunk in chunks:
        units = _reply_units(chunk.text)
        ranked = sorted(
            range(len(units)),
            key=lambda index: len(query_stems & set(significant_stems(units[index][0]))),
            reverse=True,
        )
        for index in sorted(ranked[:3]):
            text, is_table = units[index]
            if text in seen:
                continue
            seen.add(text)
            separator_size = 2 if selected else 0
            remaining = limit - used - separator_size
            if remaining <= 0:
                return "\n\n".join(selected)
            if len(text) > remaining:
                if is_table:
                    continue
                selected.append(text[:remaining].rstrip())
                return "\n\n".join(selected)
            selected.append(text)
            used += separator_size + len(text)
    return "\n\n".join(selected)
