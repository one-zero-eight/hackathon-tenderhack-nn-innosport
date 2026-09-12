from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import Field, StringConstraints

from src.pydantic_base import BaseSchema


class DialogStatus(StrEnum):
    CLARIFYING = "clarifying"
    ANSWERED = "answered"
    ESCALATE = "escalate"
    CLOSED_ABUSE = "closed_abuse"


class SupportLine(StrEnum):
    L1 = "L1"
    L2 = "L2"


class TopicRef(BaseSchema):
    id: str
    title: str


class Citation(BaseSchema):
    document: str
    section: str
    path: str


class MessageCreate(BaseSchema):
    content: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
    ]


class DialogResponse(BaseSchema):
    id: str
    reply: str
    status: DialogStatus | None = None
    topic: TopicRef | None = None
    line: SupportLine | None = None
    clarification_options: list[TopicRef] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    closed: bool = False
    reason: str | None = None
    updated_at: datetime | None = None


class DialogListItem(BaseSchema):
    id: str
    title: str
    preview: str = ""
    status: DialogStatus | None = None
    topic: TopicRef | None = None
    line: SupportLine | None = None
    closed: bool = False
    reason: str | None = None
    updated_at: datetime


class DialogMessage(BaseSchema):
    role: str
    content: str


class DialogView(DialogResponse):
    messages: list[DialogMessage] = Field(default_factory=list)
