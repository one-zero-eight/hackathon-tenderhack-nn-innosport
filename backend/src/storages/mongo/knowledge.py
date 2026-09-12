from typing import ClassVar

from pymongo import IndexModel

from src.logging_ import logger
from src.storages.mongo.__base__ import CustomDocument

# Atlas Search index names. Also created (and, unlike here, polled until READY)
# by backend/ingest/ingest_documents.py after a full re-ingest; creating them
# here too means a fresh database gets queryable indexes as soon as the app
# starts, without waiting on a separate ingestion run.
VECTOR_INDEX_NAME = "knowledge_vector_index"
TEXT_INDEX_NAME = "knowledge_text_index"
EMBEDDING_DIMENSION = 1024  # mxbai-embed-large


class KnowledgeChunk(CustomDocument):
    text: str
    text_hash: str  # sha256(text), unique - dedupes identical chunk text across documents
    document: str
    section_number: str = ""
    section_title: str = ""
    path: str
    label: str = "manual"  # "manual" | "glossary"
    term: str | None = None
    order: int  # 0-based, local to (document, section_number, section_title)
    embedding: list[float]

    class Settings:
        name = "knowledge_chunks"
        keep_nulls = False
        max_nesting_depth = 1
        indexes: ClassVar[list[IndexModel]] = [
            IndexModel(
                [("document", 1), ("section_number", 1), ("section_title", 1), ("order", 1)],
                name="document_section_order",
            ),
        ]
