from pydantic import BaseModel, ConfigDict, Field

from src.pydantic_base import BaseSchema


class Topic(BaseSchema):
    id: str
    title: str
    parent_title: str
    description: str
    keys: list[str] = Field(default_factory=list)
    document: str = ""
    section: str = ""
    path: str = ""


class Chunk(BaseSchema):
    id: str
    topic_id: str
    text: str
    document: str
    section: str
    path: str


class KnowledgeBase(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=False)

    topics: list[Topic]

    def topic_by_id(self, topic_id: str) -> Topic | None:
        for topic in self.topics:
            if topic.id == topic_id:
                return topic
        return None
