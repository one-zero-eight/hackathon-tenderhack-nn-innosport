from pathlib import Path

from memvid_sdk.embeddings import OllamaEmbeddings

from src.config_schema import ModelProvider, Settings
from src.modules.dialog.llama import DialogLlamaClient, LlamaCppClient, NullLlamaClient
from src.modules.dialog.retrieval import KnowledgeRetriever, MemvidKnowledgeRetriever
from src.modules.dialog.service import DialogService
from src.modules.dialog.store import ConversationStore, MemoryConversationStore

LINE_EXAMPLES_PATH = Path("data/line_question_examples.txt")


def _line_examples() -> str:
    path = LINE_EXAMPLES_PATH if LINE_EXAMPLES_PATH.is_absolute() else Path.cwd() / LINE_EXAMPLES_PATH
    return path.read_text(encoding="utf-8")


def build_llama_client_from_settings(settings: Settings | None = None) -> DialogLlamaClient:
    if settings is None:
        from src.config import settings as loaded

        settings = loaded

    if settings.model_provider is ModelProvider.MLX:
        mlx = settings.mlx
        return LlamaCppClient(
            base_url=mlx.base_url,
            model=mlx.model,
            answer_max_tokens=mlx.answer_max_tokens,
            context_tokens=mlx.context_tokens,
            max_tool_rounds=mlx.max_tool_rounds,
            temperature=mlx.temperature,
            llama_extensions=False,
            line_examples=_line_examples(),
        )
    llama = settings.llama_cpp
    if not llama.enabled:
        return NullLlamaClient()
    return LlamaCppClient(
        base_url=llama.base_url,
        model=llama.model,
        answer_max_tokens=llama.answer_max_tokens,
        context_tokens=llama.context_tokens,
        max_tool_rounds=llama.max_tool_rounds,
        temperature=llama.temperature,
        line_examples=_line_examples(),
    )


def build_dialog_service(
    *,
    store: ConversationStore | None = None,
    retriever: KnowledgeRetriever | None = None,
    llama_client: DialogLlamaClient | None = None,
    memvid_path: Path | None = None,
    use_mongo: bool = False,
) -> DialogService:
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
        store=store,
        retriever=retriever,
        llama_client=llama_client,
    )
