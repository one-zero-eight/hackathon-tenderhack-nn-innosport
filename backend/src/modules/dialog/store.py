from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

from src.modules.dialog.schemas import DialogStatus, SupportLine


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class StoredMessage:
    role: str
    content: str


@dataclass
class StoredCitation:
    document: str
    section: str
    path: str


@dataclass
class ConversationState:
    id: str
    revision: int = 0
    closed: bool = False
    status: DialogStatus | None = None
    topic_id: str | None = None
    line: SupportLine | None = None
    reason: str | None = None
    failed_clarifications: int = 0
    pending_option_ids: list[str] = field(default_factory=list)
    citations: list[StoredCitation] = field(default_factory=list)
    messages: list[StoredMessage] = field(default_factory=list)
    updated_at: datetime = field(default_factory=utcnow)


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
