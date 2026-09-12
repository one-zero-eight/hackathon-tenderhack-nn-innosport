from pathlib import Path

from memvid_sdk.embeddings import OllamaEmbeddings

from src.modules.dialog.catalog import DEFAULT_DATA_DIR, load_knowledge
from src.modules.dialog.llama import DialogLlamaClient, LlamaCppClient, NullLlamaClient
from src.modules.dialog.retrieval import KnowledgeRetriever, MemvidKnowledgeRetriever
from src.modules.dialog.service import DialogService
from src.modules.dialog.store import ConversationStore, MemoryConversationStore


def build_llama_client_from_settings() -> DialogLlamaClient:
    from src.config import settings

    llama = settings.llama_cpp
    if not llama.enabled:
        return NullLlamaClient()
    return LlamaCppClient(
        base_url=llama.base_url,
        model=llama.model,
        timeout_seconds=llama.timeout_seconds,
        max_tokens=llama.max_tokens,
        answer_max_tokens=llama.answer_max_tokens,
        temperature=llama.temperature,
    )


def build_dialog_service(
    *,
    store: ConversationStore | None = None,
    retriever: KnowledgeRetriever | None = None,
    llama_client: DialogLlamaClient | None = None,
    data_dir: Path | None = None,
    memvid_path: Path | None = None,
    use_mongo: bool = False,
) -> DialogService:
    directory = data_dir
    if directory is None:
        from src.config import settings

        directory = Path(settings.knowledge_dir)
        if not directory.is_absolute():
            directory = Path.cwd() / directory
        if not (directory / "topic_catalog.json").exists():
            directory = DEFAULT_DATA_DIR
    knowledge = load_knowledge(directory)
    if retriever is None:
        from src.config import settings

        if memvid_path is None:
            memvid_path = Path(settings.knowledge_memvid_path)
            if not memvid_path.is_absolute():
                memvid_path = Path.cwd() / memvid_path
        search = settings.knowledge_search
        retriever = MemvidKnowledgeRetriever(
            memvid_path,
            OllamaEmbeddings(
                model=search.embedding_model,
                base_url=search.ollama_base_url,
            ),
        )
    if store is None:
        if use_mongo:
            from src.storages.mongo.conversation import MongoConversationStore

            store = MongoConversationStore()
        else:
            store = MemoryConversationStore()
    if llama_client is None:
        llama_client = NullLlamaClient()
    return DialogService(
        knowledge=knowledge,
        store=store,
        retriever=retriever,
        llama_client=llama_client,
    )
