import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.modules.dialog.routes import router
from src.modules.dialog.service import DialogService
from src.modules.dialog.store import MemoryConversationStore, StoredMessage


@pytest.mark.parametrize(
    ("query", "line", "number"),
    [
        ("Нужна помощь с личным кабинетом", "L1", 1),
        ("Портал недоступен, массовый сбой", "L2", 2),
    ],
)
async def test_escalation_announces_selected_line_and_saves_before_closing(query, line, number):
    store = MemoryConversationStore()
    state = await store.create()
    state.messages.append(StoredMessage(role="user", content=query))
    app = FastAPI()
    app.state.dialog_service = DialogService(store, retriever=None)
    app.include_router(router)

    with TestClient(app) as client:
        response = client.post(f"/dialogs/{state.id}/escalate")
        assert response.status_code == 200
        payload = response.json()
        assert payload["line"] == line
        assert payload["reply"] == f"Ваш запрос отправлен на {number} линию поддержки"
        assert payload["closed"] is True
        assert payload["status"] == "escalate"
        history = client.get(f"/dialogs/{state.id}").json()
        assert history["messages"][-1] == {"role": "assistant", "content": payload["reply"]}
        assert history["line"] == line
        assert history["closed"] is True
        assert client.post(f"/dialogs/{state.id}/escalate").status_code == 409
        assert len(client.get(f"/dialogs/{state.id}").json()["messages"]) == 2
