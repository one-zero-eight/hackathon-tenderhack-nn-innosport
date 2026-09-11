__all__ = ["Impact", "SupportRecord", "TopicRecord"]

from enum import StrEnum

from pydantic import ConfigDict, Field

from src.pydantic_base import BaseSchema


class Impact(StrEnum):
    INFORMATION_REQUEST = "RFI - запрос информации"
    SINGLE_USER_UNAVAILABLE = "Среднее - услуга недоступна для одного пользователя"
    CHANGE_REQUEST = "RFC - запрос на изменение"
    MULTIPLE_USERS_UNAVAILABLE = "Наивысшее - услуга недоступна для нескольких пользователей"
    URGENT = "Срочно"
    MULTIPLE_USERS_DEGRADED = "Высокое - ухудшение услуги для нескольких пользователей"


class TopicRecord(BaseSchema):
    model_config = ConfigDict(strict=True, extra="forbid", str_min_length=1)

    topic: str
    subtopic: str


class SupportRecord(BaseSchema):
    model_config = ConfigDict(strict=True, extra="forbid")

    topic: str
    subtopic: str | None
    question: str
    answer: str
    # Excel and Polars supply strings; accept only values declared in Impact.
    impact: Impact = Field(strict=False)
