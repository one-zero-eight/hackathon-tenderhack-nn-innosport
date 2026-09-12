import asyncio
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

    @classmethod
    async def ensure_search_indexes(cls) -> None:
        """Create the Atlas Search indexes if missing. Beanie has no concept of
        search index definitions, so this runs once at startup instead of via
        Settings.indexes. Uses the same async Motor collection as the rest of
        the app (init_beanie/AsyncIOMotorClient) - not a separate sync client."""
        collection = cls.get_motor_collection()
        existing = {index["name"] async for index in collection.list_search_indexes()}
        created = []
        if VECTOR_INDEX_NAME not in existing:
            await collection.create_search_index(
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
            await collection.create_search_index(
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

        logger.info(f"Waiting for Atlas Search indexes to build: {created}")
        deadline = asyncio.get_running_loop().time() + 180
        while asyncio.get_running_loop().time() < deadline:
            statuses = {index["name"]: index async for index in collection.list_search_indexes()}
            if all(statuses.get(name, {}).get("queryable") for name in created):
                logger.info("Atlas Search indexes are queryable.")
                return
            await asyncio.sleep(2)
        raise TimeoutError(f"Search indexes did not become queryable in time: {created}")
