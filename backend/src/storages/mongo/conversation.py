from __future__ import annotations

import re
from datetime import datetime, timezone

from beanie import PydanticObjectId
from pydantic import Field

from src.modules.dialog.schemas import DialogStatus, SupportLine
from src.modules.dialog.store import (
    ConversationConflictError,
    ConversationState,
    StoredCitation,
    StoredMessage,
    utcnow,
)
from src.pydantic_base import BaseSchema
from src.storages.mongo.__base__ import CustomDocument


class ConversationMessageSchema(BaseSchema):
    role: str
    content: str


class ConversationCitationSchema(BaseSchema):
    document: str
    section: str
    path: str


class ConversationSchema(BaseSchema):
    revision: int = 0
    closed: bool = False
    status: DialogStatus | None = None
    topic_id: str | None = None
    line: SupportLine | None = None
    reason: str | None = None
    failed_clarifications: int = 0
    pending_option_ids: list[str] = Field(default_factory=list)
    citations: list[ConversationCitationSchema] = Field(default_factory=list)
    messages: list[ConversationMessageSchema] = Field(default_factory=list)
    updated_at: datetime | None = None


class Conversation(ConversationSchema, CustomDocument):
    class Settings:
        name = "conversations"
        keep_nulls = False
        max_nesting_depth = 1
        indexes = ["updated_at"]


def _document_updated_at(document: Conversation) -> datetime:
    if document.updated_at is not None:
        value = document.updated_at
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if document.id is not None:
        generated = document.id.generation_time
        if generated.tzinfo is None:
            return generated.replace(tzinfo=timezone.utc)
        return generated
    return utcnow()


def document_to_state(document: Conversation) -> ConversationState:
    return ConversationState(
        id=str(document.id),
        revision=document.revision,
        closed=document.closed,
        status=document.status,
        topic_id=document.topic_id,
        line=document.line,
        reason=document.reason,
        failed_clarifications=document.failed_clarifications,
        pending_option_ids=list(document.pending_option_ids),
        citations=[
            StoredCitation(
                document=item.document,
                section=item.section,
                path=item.path,
            )
            for item in document.citations
        ],
        messages=[StoredMessage(role=item.role, content=item.content) for item in document.messages],
        updated_at=_document_updated_at(document),
    )


class MongoConversationStore:
    async def create(self) -> ConversationState:
        document = Conversation(updated_at=utcnow())
        await document.insert()
        return document_to_state(document)

    async def list(self, *, limit: int = 100) -> list[ConversationState]:
        documents = await Conversation.find_all().sort("-updated_at").limit(limit).to_list()
        return [document_to_state(document) for document in documents]

    async def get(self, dialog_id: str) -> ConversationState | None:
        object_id = self._object_id(dialog_id)
        if object_id is None:
            return None
        document = await Conversation.get(object_id)
        if document is None:
            return None
        return document_to_state(document)

    async def save(self, state: ConversationState) -> None:
        object_id = self._object_id(state.id)
        if object_id is None:
            raise KeyError(state.id)
        revision_filter: dict = {"revision": state.revision}
        if state.revision == 0:
            revision_filter = {
                "$or": [
                    {"revision": 0},
                    {"revision": {"$exists": False}},
                ]
            }
        state.updated_at = utcnow()
        result = await Conversation.get_motor_collection().update_one(
            {"_id": object_id, **revision_filter},
            {
                "$set": {
                    "closed": state.closed,
                    "status": state.status,
                    "topic_id": state.topic_id,
                    "line": state.line,
                    "reason": state.reason,
                    "failed_clarifications": state.failed_clarifications,
                    "pending_option_ids": list(state.pending_option_ids),
                    "updated_at": state.updated_at,
                    "citations": [
                        ConversationCitationSchema(
                            document=item.document,
                            section=item.section,
                            path=item.path,
                        ).model_dump(mode="python")
                        for item in state.citations
                    ],
                    "messages": [
                        ConversationMessageSchema(
                            role=item.role,
                            content=item.content,
                        ).model_dump(mode="python")
                        for item in state.messages
                    ],
                },
                "$inc": {"revision": 1},
            },
        )
        if result.matched_count != 1:
            raise ConversationConflictError(state.id)
        state.revision += 1

    @staticmethod
    def _object_id(value: str) -> PydanticObjectId | None:
        if re.fullmatch(r"[0-9a-fA-F]{24}", value) is None:
            return None
        return PydanticObjectId(value)
