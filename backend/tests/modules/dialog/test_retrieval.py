import asyncio
from pathlib import Path

from memvid_sdk import create

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
        "t-001",
    )
    assert chunk is not None
    assert chunk.id == "42"
    assert chunk.document == "manual.pdf"
    assert chunk.section == "3.3 Регистрация поставщика"
    assert chunk.path == "docs/manual.pdf"


async def test_memvid_runtime_forces_lexical_search() -> None:
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
    retriever.memory = FakeMemory()
    retriever._lock = asyncio.Lock()

    chunks = await retriever.find("Как зарегистрироваться поставщику?", _topic())
    assert chunks
    assert retriever.memory.kwargs["mode"] == "lex"


async def test_real_memvid_lexical_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "knowledge.mv2"
    memory = create(str(path), enable_lex=True, enable_vec=False)
    memory.enable_lex()
    text = "Для регистрации поставщика нажмите кнопку Регистрация."
    memory.put(
        title="Регистрация поставщика",
        text=text,
        search_text="для регистрации поставщика нажмите кнопку регистрация",
        kind="text/plain",
        metadata={
            "source": "manual.pdf",
            "section": "3.3",
            "section_title": "Регистрация поставщика",
            "path": "docs/manual.pdf",
            "topic_id": "t-001",
        },
        auto_tag=False,
        extract_dates=False,
    )
    memory.commit()
    memory.close()

    retriever = MemvidKnowledgeRetriever(path)
    chunks = await retriever.find("Как зарегистрироваться поставщику?", _topic())
    assert len(chunks) == 1
    assert chunks[0].document == "manual.pdf"
    assert chunks[0].path == "docs/manual.pdf"
    assert "source:" not in chunks[0].text
