import datetime as dtm
from typing import Protocol
from uuid import uuid4

from pydantic import Field

from src.modules.dialog.schemas import Clarification, DialogStatus, SupportLine, ToolCall
from src.pydantic_base import BaseSchema


def utcnow() -> dtm.datetime:
    return dtm.datetime.now(dtm.UTC)


class StoredMessage(BaseSchema):
    role: str
    content: str
    clarification: Clarification | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)


class StoredCitation(BaseSchema):
    document: str
    section: str
    path: str


class ConversationState(BaseSchema):
    id: str
    revision: int = 0
    clarification: Clarification | None = None
    closed: bool = False
    status: DialogStatus | None = None
    line: SupportLine | None = None
    reason: str | None = None
    citations: list[StoredCitation] = Field(default_factory=list)
    messages: list[StoredMessage] = Field(default_factory=list)
    updated_at: dtm.datetime = Field(default_factory=utcnow)


class ConversationConflictError(RuntimeError):
    pass


class ConversationStore(Protocol):
    async def create(self) -> ConversationState: ...

    async def get(self, dialog_id: str) -> ConversationState | None: ...

    async def list(self, *, limit: int = 100) -> list[ConversationState]: ...

    async def save(self, state: ConversationState) -> None: ...

    async def delete(self, dialog_id: str) -> bool: ...

    async def delete_all(self) -> int: ...


class MemoryConversationStore:
    def __init__(self) -> None:
        self._items: dict[str, ConversationState] = {}

    async def create(self) -> ConversationState:
        state = ConversationState(id=uuid4().hex)
        self._items[state.id] = state
        return state

    async def get(self, dialog_id: str) -> ConversationState | None:
        return self._items.get(dialog_id)

    async def list(self, *, limit: int = 100) -> list[ConversationState]:
        items = sorted(self._items.values(), key=lambda item: item.updated_at, reverse=True)
        return items[:limit]

    async def save(self, state: ConversationState) -> None:
        state.updated_at = utcnow()
        state.revision += 1
        self._items[state.id] = state

    async def delete(self, dialog_id: str) -> bool:
        return self._items.pop(dialog_id, None) is not None

    async def delete_all(self) -> int:
        count = len(self._items)
        self._items.clear()
        return count
