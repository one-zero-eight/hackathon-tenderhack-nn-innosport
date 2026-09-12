import datetime as dtm
import re
from typing import ClassVar

from beanie import PydanticObjectId
from pydantic import Field

from src.modules.dialog.analytics import AnalyticsAccumulator
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
    clarification: Clarification | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)


class ConversationCitationSchema(BaseSchema):
    document: str
    section: str
    path: str


class ConversationSchema(BaseSchema):
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
    citations: list[ConversationCitationSchema] = Field(default_factory=list)
    messages: list[ConversationMessageSchema] = Field(default_factory=list)
    updated_at: dtm.datetime | None = None


class Conversation(ConversationSchema, CustomDocument):
    class Settings:
        name = "conversations"
        keep_nulls = False
        max_nesting_depth = 1
        indexes: ClassVar[list[str]] = ["updated_at", "feedback.submitted_at", "closed_at", "insights_retry_at"]


def _document_updated_at(document: Conversation) -> dtm.datetime:
    if document.updated_at is not None:
        value = document.updated_at
        if value.tzinfo is None:
            return value.replace(tzinfo=dtm.UTC)
        return value
    if document.id is not None:
        generated = document.id.generation_time
        if generated.tzinfo is None:
            return generated.replace(tzinfo=dtm.UTC)
        return generated
    return utcnow()


def document_to_state(document: Conversation) -> ConversationState:
    return ConversationState(
        id=str(document.id),
        revision=document.revision,
        clarification=document.clarification,
        closed=document.closed,
        closed_at=document.closed_at or (document.updated_at if document.closed else None),
        summary=document.summary,
        classification=document.classification,
        insights_retry_at=document.insights_retry_at,
        status=document.status,
        line=document.line,
        reason=document.reason,
        feedback=document.feedback,
        specialist_contact=document.specialist_contact,
        citations=[
            StoredCitation(
                document=item.document,
                section=item.section,
                path=item.path,
            )
            for item in document.citations
        ],
        messages=[
            StoredMessage(
                role=item.role,
                content=item.content,
                clarification=item.clarification,
                tool_calls=item.tool_calls,
            )
            for item in document.messages
        ],
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
        if state.closed:
            state.summary = None
            state.classification = None
            state.insights_retry_at = None
        updated_at = utcnow()
        result = await Conversation.get_motor_collection().update_one(
            {"_id": object_id, **revision_filter},
            {
                "$set": {
                    "clarification": state.clarification.model_dump(mode="python") if state.clarification else None,
                    "closed": state.closed,
                    "closed_at": state.closed_at,
                    "summary": state.summary.model_dump(mode="python") if state.summary else None,
                    "classification": state.classification.model_dump(mode="python") if state.classification else None,
                    "insights_retry_at": state.insights_retry_at,
                    "status": state.status,
                    "line": state.line,
                    "reason": state.reason,
                    "feedback": state.feedback.model_dump(mode="python") if state.feedback else None,
                    "specialist_contact": state.specialist_contact.model_dump(mode="python")
                    if state.specialist_contact
                    else None,
                    "updated_at": updated_at,
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
                            clarification=item.clarification,
                            tool_calls=item.tool_calls,
                        ).model_dump(mode="python")
                        for item in state.messages
                    ],
                },
                "$inc": {"revision": 1},
            },
        )
        if result.matched_count != 1:
            raise ConversationConflictError(state.id)
        state.updated_at = updated_at
        state.revision += 1

    async def save_insights(self, state: ConversationState) -> None:
        revision_filter: dict = {"revision": state.revision}
        if state.revision == 0:
            revision_filter = {"$or": [{"revision": 0}, {"revision": {"$exists": False}}]}
        result = await Conversation.get_motor_collection().update_one(
            {"_id": self._object_id(state.id), "closed": True, **revision_filter},
            [
                {
                    "$set": {
                        "closed_at": {"$ifNull": ["$closed_at", "$updated_at"]},
                        "summary": {"$literal": state.summary.model_dump(mode="python") if state.summary else None},
                        "classification": {
                            "$literal": state.classification.model_dump(mode="python") if state.classification else None
                        },
                        "insights_retry_at": {"$literal": state.insights_retry_at},
                        "revision": {"$add": [{"$ifNull": ["$revision", 0]}, 1]},
                    }
                }
            ],
        )
        if result.matched_count != 1:
            raise ConversationConflictError(state.id)
        state.revision += 1

    @staticmethod
    def _current_expression(field: str) -> dict:
        return {
            "$and": [
                {"$ne": [{"$ifNull": [f"${field}", None]}, None]},
                {"$ne": [{"$ifNull": ["$updated_at", None]}, None]},
                {"$eq": [{"$ifNull": [f"${field}.dialog_updated_at", None]}, "$updated_at"]},
            ]
        }

    async def pending_insights(self, *, limit: int = 10) -> list[ConversationState]:
        query = {
            "closed": True,
            "$and": [
                {"$or": [{"insights_retry_at": None}, {"insights_retry_at": {"$lte": utcnow()}}]},
                {
                    "$or": [
                        {"closed_at": None, "updated_at": {"$type": "date"}},
                        {"$expr": {"$not": [self._current_expression("summary")]}},
                        {"$expr": {"$not": [self._current_expression("classification")]}},
                    ]
                },
            ],
        }
        documents = await Conversation.find(query).sort("insights_retry_at", "updated_at", "_id").limit(limit).to_list()
        return [document_to_state(document) for document in documents]

    async def analytics(self, *, days: int) -> DialogAnalytics:
        result = AnalyticsAccumulator(days)
        pipeline = [
            {"$match": {"closed": True}},
            {"$set": {"closed_at": {"$ifNull": ["$closed_at", "$updated_at"]}}},
            {"$match": {"closed_at": {"$gte": result.start, "$lt": result.end}}},
            {
                "$project": {
                    "_id": 0,
                    "closed_at": 1,
                    "reason": 1,
                    "status": 1,
                    "line": 1,
                    "summary_current": self._current_expression("summary"),
                    "classification_current": self._current_expression("classification"),
                    "remaining_questions": {"$gt": [{"$size": {"$ifNull": ["$summary.remaining_questions", []]}}, 0]},
                    "topic": "$classification.topic",
                    "subtopic": "$classification.subtopic",
                    "rating": "$feedback.rating",
                }
            },
        ]
        async for row in Conversation.get_motor_collection().aggregate(pipeline):
            result.add(row)
        return result.result()

    async def delete(self, dialog_id: str) -> bool:
        object_id = self._object_id(dialog_id)
        if object_id is None:
            return False
        result = await Conversation.get_motor_collection().delete_one({"_id": object_id})
        return result.deleted_count == 1

    async def delete_all(self) -> int:
        result = await Conversation.get_motor_collection().delete_many({})
        return int(result.deleted_count)

    @staticmethod
    def _object_id(value: str) -> PydanticObjectId | None:
        if re.fullmatch(r"[0-9a-fA-F]{24}", value) is None:
            return None
        return PydanticObjectId(value)
