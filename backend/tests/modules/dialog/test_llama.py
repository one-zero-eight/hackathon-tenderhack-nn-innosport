from src.modules.dialog.llama import (
    LlamaCppClient,
    _parse_grounded_answer,
    _parse_topic_id,
)
from src.modules.dialog.models import Chunk, Topic


def _topic(topic_id: str) -> Topic:
    return Topic(
        id=topic_id,
        title="Регистрация",
        parent_title="Личный кабинет пользователя",
        description="...",
        keys=[],
    )


def test_parse_topic_id_rejects_unknown() -> None:
    allowed = {"t-001": _topic("t-001")}
    assert _parse_topic_id('{"topic_id": "t-001"}', allowed) == "t-001"
    assert _parse_topic_id('{"topic_id": "t-999"}', allowed) is None
    assert _parse_topic_id("not json", allowed) is None


async def test_llama_timeout_returns_none(monkeypatch) -> None:
    client = LlamaCppClient(base_url="http://127.0.0.1:9", timeout_seconds=0.01)

    class BoomClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            raise TimeoutError("down")

    monkeypatch.setattr("src.modules.dialog.llama.httpx.AsyncClient", lambda **kwargs: BoomClient())
    result = await client.suggest_topic_id("регистрация", [_topic("t-001")])
    assert result is None


def test_grounded_answer_requires_valid_citation_and_evidence() -> None:
    chunks = [
        Chunk(
            id="frame-1",
            topic_id="t-001",
            text="Для регистрации поставщика нажмите кнопку Регистрация.",
            document="manual.pdf",
            section="3.3 Регистрация",
            path="docs/manual.pdf",
        )
    ]
    accepted = _parse_grounded_answer(
        '{"can_answer":true,"answer":"Для регистрации поставщика нажмите кнопку Регистрация.",'
        '"citation_ids":["frame-1"]}',
        chunks,
    )
    assert accepted is not None
    assert accepted.citation_ids == ["frame-1"]

    assert (
        _parse_grounded_answer(
            '{"can_answer":true,"answer":"Позвоните по выдуманному номеру телефона.","citation_ids":["frame-1"]}',
            chunks,
        )
        is None
    )
    assert (
        _parse_grounded_answer(
            '{"can_answer":true,"answer":"Для регистрации нажмите кнопку Регистрация.","citation_ids":["unknown"]}',
            chunks,
        )
        is None
    )
    assert (
        _parse_grounded_answer(
            '{"can_answer":true,"answer":"Для регистрации позвоните по номеру 123456.","citation_ids":["frame-1"]}',
            chunks,
        )
        is None
    )
    assert (
        _parse_grounded_answer(
            '{"can_answer":true,"answer":"Для регистрации поставщика нажмите кнопку Регистрация?",'
            '"citation_ids":["frame-1"]}',
            chunks,
        )
        is None
    )
