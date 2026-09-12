import datetime as dtm
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import EmailStr, Field, StringConstraints, field_validator

from src.pydantic_base import BaseSchema


class DialogStatus(StrEnum):
    CLARIFYING = "clarifying"
    ANSWERED = "answered"
    ESCALATE = "escalate"
    CLOSED_ABUSE = "closed_abuse"


class SupportLine(StrEnum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


class Citation(BaseSchema):
    document: str
    section: str
    path: str


class ToolCall(BaseSchema):
    id: str
    name: str
    arguments: dict[str, Any]
    result: dict[str, Any]


class ClarificationQuestion(BaseSchema):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    options: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] = Field(
        min_length=2,
        max_length=6,
    )

    @field_validator("options")
    @classmethod
    def validate_options(cls, values: list[str]) -> list[str]:
        normalized = [value.casefold() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Options must be unique")
        return values


class Clarification(ClarificationQuestion):
    id: str


class MessageCreate(BaseSchema):
    content: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
    ]
    clarification_id: str | None = None


class DialogFeedbackCreate(BaseSchema):
    rating: Literal["complete", "partial", "irrelevant"]
    comment: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class DialogFeedback(DialogFeedbackCreate):
    submitted_at: dtm.datetime

    @field_validator("submitted_at")
    @classmethod
    def normalize_submitted_at(cls, value: dtm.datetime) -> dtm.datetime:
        return value.replace(tzinfo=dtm.UTC) if value.tzinfo is None else value


class SpecialistContact(BaseSchema):
    inn: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^(?:[0-9]{10}|[0-9]{12})$")]
    organization_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    contact_email: EmailStr


class EscalationPreview(BaseSchema):
    line: SupportLine


class DialogResponse(BaseSchema):
    id: str
    reply: str
    clarification: Clarification | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    status: DialogStatus | None = None
    line: SupportLine | None = None
    citations: list[Citation] = Field(default_factory=list)
    closed: bool = False
    reason: str | None = None
    feedback: DialogFeedback | None = None
    specialist_contact: SpecialistContact | None = None
    updated_at: dtm.datetime | None = None


type ToolStatus = Literal["preparing", "running", "completed", "error", "awaiting_user"]


class DialogStreamEvent(BaseSchema):
    type: Literal["text", "tool", "done", "error"]
    text: str = ""
    tool_call: ToolCall | None = None
    status: ToolStatus | None = None
    response: DialogResponse | None = None
    detail: str | None = None


class DialogListItem(BaseSchema):
    id: str
    title: str
    preview: str = ""
    status: DialogStatus | None = None
    line: SupportLine | None = None
    closed: bool = False
    reason: str | None = None
    feedback: DialogFeedback | None = None
    updated_at: dtm.datetime


class DialogMessage(BaseSchema):
    role: str
    content: str
    clarification: Clarification | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)


class DialogView(DialogResponse):
    messages: list[DialogMessage] = Field(default_factory=list)


class DialogSummaryContent(BaseSchema):
    user_request: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    remaining_questions: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]]


class DialogSummary(DialogSummaryContent):
    generated_at: dtm.datetime
    dialog_updated_at: dtm.datetime | None


class DialogDeleteResult(BaseSchema):
    deleted: int
