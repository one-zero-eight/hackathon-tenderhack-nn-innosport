import asyncio
import re
from pathlib import Path
from typing import Any, Protocol

from memvid_sdk import MemvidError, use
from memvid_sdk.embeddings import EmbeddingProvider

from src.logging_ import logger
from src.modules.dialog.models import Chunk, Topic
from src.modules.dialog.normalize import ABBREVIATIONS, significant_stems

SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
SOURCE_RE = re.compile(r'\bsource:\s*"([^"]+)"', re.IGNORECASE)
SECTION_RE = re.compile(r'\bsection:\s*"([^"]+)"', re.IGNORECASE)
SECTION_TITLE_RE = re.compile(r'\bsection_title:\s*"([^"]+)"', re.IGNORECASE)
PATH_RE = re.compile(r'\bpath:\s*"([^"]+)"', re.IGNORECASE)
TOPIC_ID_RE = re.compile(r'\btopic_id:\s*"([^"]+)"', re.IGNORECASE)
SERIALIZED_METADATA_RE = re.compile(
    r"\s+title:\s.*?(?=\s+(?:labels?|path|section|section_title|source|topic_id):)",
    re.IGNORECASE,
)
MIN_RETRIEVAL_SCORE = 2.2


def _sentences(text: str) -> list[str]:
    parts = [re.sub(r"\s+", " ", part).strip() for part in SENTENCE_RE.split(text)]
    return [part for part in parts if len(part) >= 25]


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
    async def find(self, query: str, topic: Topic, limit: int = 3) -> list[Chunk]: ...


class MemoryKnowledgeRetriever:
    """Deterministic retriever used by tests."""

    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks

    async def find(self, query: str, topic: Topic, limit: int = 3) -> list[Chunk]:
        ranked = [(score_chunk(query, chunk), chunk) for chunk in self.chunks if chunk.topic_id == topic.id]
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

    async def find(self, query: str, topic: Topic, limit: int = 3) -> list[Chunk]:
        try:
            async with self._lock:
                return await asyncio.to_thread(self._find_sync, query, topic, limit)
        except MemvidError:
            logger.exception("Memvid lexical retrieval failed")
            return []

    def _find_sync(self, query: str, topic: Topic, limit: int) -> list[Chunk]:
        result = self.memory.find(
            f"{topic.title}. {query}",
            k=max(limit * 3, 8),
            mode="sem",
            snippet_chars=1400,
            embedder=self.embedder,
        )
        chunks: list[Chunk] = []
        for hit in result.get("hits", []):
            chunk = _hit_to_chunk(hit, topic)
            if chunk is None:
                continue
            metadata = hit.get("metadata")
            hit_topic: str | None = None
            if isinstance(metadata, dict):
                value = metadata.get("topic_id")
                hit_topic = value if isinstance(value, str) else None
            elif match := TOPIC_ID_RE.search(str(hit.get("text") or "")):
                hit_topic = match.group(1)
            if hit_topic and hit_topic != topic.id:
                continue
            if hit_topic is None and score_chunk(f"{topic.title} {query}", chunk) < MIN_RETRIEVAL_SCORE:
                continue
            chunks.append(chunk)
            if len(chunks) >= limit:
                break
        return chunks


def _metadata(hit: dict[str, Any]) -> dict[str, Any]:
    value = hit.get("metadata")
    return value if isinstance(value, dict) else {}


def _hit_to_chunk(hit: dict[str, Any], topic: Topic) -> Chunk | None:
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
        topic_id=topic.id,
        text=text,
        document=document,
        section=section,
        path=path,
    )


def extractive_reply(query: str, chunks: list[Chunk], limit: int = 900) -> str:
    query_stems = set(significant_stems(query))
    selected: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        sentences = _sentences(chunk.text)
        ranked = sorted(
            sentences,
            key=lambda sentence: len(query_stems & set(significant_stems(sentence))),
            reverse=True,
        )
        ordered = [sentence for sentence in sentences if sentence in ranked[:3]]
        if not ordered:
            ordered = sentences[:2] or [chunk.text]
        for sentence in ordered:
            if sentence in seen:
                continue
            seen.add(sentence)
            selected.append(sentence)
            if sum(len(item) for item in selected) >= limit:
                break
        if sum(len(item) for item in selected) >= limit:
            break
    text = " ".join(selected).strip()
    return text[:limit].rstrip()
