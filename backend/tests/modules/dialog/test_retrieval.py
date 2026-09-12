import asyncio
from pathlib import Path

from memvid_sdk import create
from memvid_sdk.embeddings import HashEmbeddings

from src.modules.dialog.models import Topic
from src.modules.dialog.retrieval import MemvidKnowledgeRetriever, _hit_to_chunk


def _topic() -> Topic:
    return Topic(
        id="t-001",
        title="Регистрация",
        parent_title="Личный кабинет пользователя",
        description="Регистрация поставщика.",
        keys=["регистрация"],
    )


def test_memvid_hit_metadata_becomes_citation() -> None:
    chunk = _hit_to_chunk(
        {
            "frame_id": 42,
            "text": "Для регистрации поставщика нажмите кнопку Регистрация.",
            "metadata": {
                "source": "manual.pdf",
                "section": "3.3",
                "section_title": "Регистрация поставщика",
                "path": "docs/manual.pdf",
            },
        },
        _topic(),
    )
    assert chunk is not None
    assert chunk.id == "42"
    assert chunk.document == "manual.pdf"
    assert chunk.section == "3.3 Регистрация поставщика"
    assert chunk.path == "docs/manual.pdf"


def test_serialized_source_without_path_becomes_docs_citation() -> None:
    chunk = _hit_to_chunk(
        {
            "frame_id": 3,
            "text": (
                "Загрузите доверенность в формате XML. "
                'section: "1.1" section_title: "Операции с МЧД" '
                'source: "Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf"'
            ),
        },
        _topic(),
    )

    assert chunk is not None
    assert chunk.document == "Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf"
    assert chunk.path == "docs/Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf"


async def test_memvid_runtime_forces_semantic_search() -> None:
    class FakeMemory:
        kwargs = None

        def find(self, query, **kwargs):
            self.kwargs = kwargs
            return {
                "hits": [
                    {
                        "frame_id": 42,
                        "text": "Для регистрации поставщика нажмите кнопку Регистрация.",
                        "metadata": {
                            "source": "manual.pdf",
                            "section": "3.3",
                            "section_title": "Регистрация поставщика",
                            "path": "docs/manual.pdf",
                        },
                    }
                ]
            }

    retriever = object.__new__(MemvidKnowledgeRetriever)
    retriever.path = Path("knowledge.mv2")
    retriever.embedder = object()
    retriever.memory = FakeMemory()
    retriever._lock = asyncio.Lock()

    chunks = await retriever.find("Как зарегистрироваться поставщику?", _topic())
    assert chunks
    assert retriever.memory.kwargs["mode"] == "sem"
    assert retriever.memory.kwargs["embedder"] is retriever.embedder


async def test_real_memvid_semantic_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "knowledge.mv2"
    embedder = HashEmbeddings(dimension=32)
    memory = create(str(path), enable_lex=False, enable_vec=True)
    text = "Для регистрации поставщика нажмите кнопку Регистрация."
    memory.put_many(
        [
            {
                "title": "Регистрация поставщика",
                    "label": "manual",
                "text": text,
                "kind": "text/plain",
                "metadata": {
                    "source": "manual.pdf",
                    "section": "3.3",
                    "section_title": "Регистрация поставщика",
                    "path": "docs/manual.pdf",
                    "topic_id": "t-001",
                },
            }
        ],
        embeddings=embedder.embed_documents([text]),
    )
    memory.commit()
    memory.close()

    retriever = MemvidKnowledgeRetriever(path, embedder)
    chunks = await retriever.find("Как зарегистрироваться поставщику?", _topic())
    assert len(chunks) == 1
    assert chunks[0].document == "manual.pdf"
    assert chunks[0].path == "docs/manual.pdf"
    assert "source:" not in chunks[0].text
