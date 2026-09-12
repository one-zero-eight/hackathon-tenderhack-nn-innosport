from pathlib import Path

from src.config_schema import ModelProvider, Settings
from src.modules.dialog.embeddings import OllamaEmbeddings
from src.modules.dialog.llama import DialogLlamaClient, LlamaCppClient, NullLlamaClient
from src.modules.dialog.retrieval import KnowledgeRetriever, MongoKnowledgeRetriever
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

    llama = settings.llama_cpp
    # L1/L2 is a tiny JSON label. Qwen with thinking off beats Gemma; never enable thinking here.
    line_kwargs = (
        {
            "line_base_url": llama.base_url,
            "line_model": llama.model,
            "line_llama_extensions": True,
        }
        if llama.enabled
        else {}
    )

    if settings.model_provider is ModelProvider.MLX:
        mlx = settings.mlx
        return LlamaCppClient(
            base_url=mlx.base_url,
            model=mlx.model,
            answer_max_tokens=mlx.answer_max_tokens,
            context_tokens=mlx.context_tokens,
            max_tool_rounds=mlx.max_tool_rounds,
            temperature=mlx.temperature,
            enable_thinking=mlx.enable_thinking,
            llama_extensions=False,
            line_examples=_line_examples(),
            **line_kwargs,
        )
    if not llama.enabled:
        return NullLlamaClient()
    return LlamaCppClient(
        base_url=llama.base_url,
        model=llama.model,
        answer_max_tokens=llama.answer_max_tokens,
        context_tokens=llama.context_tokens,
        max_tool_rounds=llama.max_tool_rounds,
        temperature=llama.temperature,
        enable_thinking=llama.enable_thinking,
        line_examples=_line_examples(),
        **line_kwargs,
    )


def build_dialog_service(
    *,
    store: ConversationStore | None = None,
    retriever: KnowledgeRetriever | None = None,
    llama_client: DialogLlamaClient | None = None,
    use_mongo: bool = False,
) -> DialogService:
    if retriever is None:
        from src.config import settings

        search = settings.knowledge_search
        embedder = OllamaEmbeddings(model=search.embedding_model, base_url=search.ollama_base_url)
        retriever = MongoKnowledgeRetriever(embedder)
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
