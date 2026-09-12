import datetime as dtm
from typing import Protocol
from uuid import uuid4

from pydantic import Field

from src.modules.dialog.analytics import AnalyticsAccumulator, as_utc, insight_current
from src.modules.dialog.schemas import (
    Clarification,
    DialogAnalytics,
    DialogClassification,
    DialogFeedback,
    DialogStatus,
    DialogSummary,
    SpecialistContact,
    SupportLine,
    ToolCall,
)
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
    closed_at: dtm.datetime | None = None
    summary: DialogSummary | None = None
    classification: DialogClassification | None = None
    insights_retry_at: dtm.datetime | None = None
    status: DialogStatus | None = None
    line: SupportLine | None = None
    reason: str | None = None
    feedback: DialogFeedback | None = None
    specialist_contact: SpecialistContact | None = None
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

    async def save_insights(self, state: ConversationState) -> None: ...

    async def pending_insights(self, *, limit: int = 10) -> list[ConversationState]: ...

    async def analytics(self, *, days: int) -> DialogAnalytics: ...

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
        current = self._items.get(state.id)
        if current is None or current.revision != state.revision:
            raise ConversationConflictError(state.id)
        if state.closed:
            state.closed_at = state.closed_at or state.updated_at
            state.summary = None
            state.classification = None
            state.insights_retry_at = None
        state.updated_at = utcnow()
        state.revision += 1
        self._items[state.id] = state.model_copy(deep=True)

    async def save_insights(self, state: ConversationState) -> None:
        current = self._items.get(state.id)
        if current is None or not current.closed or current.revision != state.revision:
            raise ConversationConflictError(state.id)
        state.closed_at = current.closed_at or current.updated_at
        state.updated_at = current.updated_at
        state.revision += 1
        self._items[state.id] = state.model_copy(deep=True)

    async def pending_insights(self, *, limit: int = 10) -> list[ConversationState]:
        now = utcnow()
        candidates = [
            state
            for state in self._items.values()
            if state.closed
            and (state.insights_retry_at is None or as_utc(state.insights_retry_at) <= now)
            and (
                state.closed_at is None
                or not insight_current(state.summary, state.updated_at)
                or not insight_current(state.classification, state.updated_at)
            )
        ]
        candidates.sort(key=lambda state: (as_utc(state.insights_retry_at or state.updated_at), state.id))
        return [state.model_copy(deep=True) for state in candidates[:limit]]

    async def analytics(self, *, days: int) -> DialogAnalytics:
        result = AnalyticsAccumulator(days)
        for state in self._items.values():
            if not state.closed:
                continue
            result.add(
                {
                    "closed_at": state.closed_at or state.updated_at,
                    "reason": state.reason,
                    "status": state.status,
                    "line": state.line,
                    "summary_current": insight_current(state.summary, state.updated_at),
                    "classification_current": insight_current(state.classification, state.updated_at),
                    "remaining_questions": state.summary.remaining_questions if state.summary else [],
                    "topic": state.classification.topic if state.classification else None,
                    "subtopic": state.classification.subtopic if state.classification else None,
                    "rating": state.feedback.rating if state.feedback else None,
                }
            )
        return result.result()

    async def delete(self, dialog_id: str) -> bool:
        return self._items.pop(dialog_id, None) is not None

    async def delete_all(self) -> int:
        count = len(self._items)
        self._items.clear()
        return count
