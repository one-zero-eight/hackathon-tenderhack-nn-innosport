from __future__ import annotations

from src.modules.dialog.catalog import DEFAULT_DATA_DIR, load_knowledge
from src.modules.dialog.schemas import DialogStatus, SupportLine
from tests.modules.dialog.conftest import make_client, make_service


def test_routes_faq_and_history() -> None:
    client = make_client()
    created = client.post("/dialogs")
    assert created.status_code == 200
    dialog_id = created.json()["id"]
    posted = client.post(
        f"/dialogs/{dialog_id}/messages",
        json={"content": "Как зарегистрироваться поставщику на портале?"},
    )
    assert posted.status_code == 200
    body = posted.json()
    assert body["status"] == DialogStatus.ANSWERED
    assert body["citations"]
    assert body["line"] is None
    history = client.get(f"/dialogs/{dialog_id}")
    assert history.status_code == 200
    assert len(history.json()["messages"]) == 2
    assert history.json()["citations"] == body["citations"]


def test_routes_closed_dialog_rejects_messages() -> None:
    client = make_client()
    dialog_id = client.post("/dialogs").json()["id"]
    first = client.post(f"/dialogs/{dialog_id}/messages", json={"content": "это пиздец"})
    assert first.status_code == 200
    assert first.json()["status"] == DialogStatus.CLOSED_ABUSE
    second = client.post(f"/dialogs/{dialog_id}/messages", json={"content": "ещё вопрос"})
    assert second.status_code == 409
    assert second.json()["closed"] is True


def test_specialist_endpoint_assigns_line_and_closes() -> None:
    client = make_client()
    dialog_id = client.post("/dialogs").json()["id"]
    initial = client.post(
        f"/dialogs/{dialog_id}/messages",
        json={"content": "Уже не помогло, договор 1234567890 не открывается"},
    )
    assert initial.status_code == 200
    assert initial.json()["line"] is None
    assert initial.json()["closed"] is False

    escalated = client.post(f"/dialogs/{dialog_id}/escalate")
    assert escalated.status_code == 200
    assert escalated.json()["line"] == SupportLine.L2
    assert escalated.json()["closed"] is True


def test_get_restores_pending_clarification_options() -> None:
    client = make_client()
    dialog_id = client.post("/dialogs").json()["id"]
    response = client.post(
        f"/dialogs/{dialog_id}/messages",
        json={"content": "помогите"},
    ).json()
    assert response["status"] == DialogStatus.CLARIFYING
    restored = client.get(f"/dialogs/{dialog_id}").json()
    assert restored["clarification_options"] == response["clarification_options"]


def test_message_validation_and_unknown_dialog() -> None:
    client = make_client()
    dialog_id = client.post("/dialogs").json()["id"]
    assert client.post(f"/dialogs/{dialog_id}/messages", json={"content": "   "}).status_code == 422
    assert client.post(f"/dialogs/{dialog_id}/messages", json={"content": "x" * 4001}).status_code == 422
    assert client.get("/dialogs/not-an-object-id").status_code == 404


def test_real_catalog_faq_if_built() -> None:
    if not (DEFAULT_DATA_DIR / "topic_catalog.json").exists():
        return
    knowledge = load_knowledge(DEFAULT_DATA_DIR)
    service = make_service(knowledge=knowledge)
    client = make_client(service)
    dialog_id = client.post("/dialogs").json()["id"]
    body = client.post(
        f"/dialogs/{dialog_id}/messages",
        json={"content": "Как пройти регистрацию поставщика на Портале поставщиков?"},
    ).json()
    assert body["status"] == DialogStatus.ANSWERED
    assert body["citations"]
    assert body["topic"] is not None
    assert body["topic"]["title"] == "Регистрация"
    assert body["line"] is None
    citation = body["citations"][0]
    assert citation["document"]
    assert citation["path"].startswith("docs/")
