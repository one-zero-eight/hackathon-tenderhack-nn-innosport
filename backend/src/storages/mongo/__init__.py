from typing import cast

from beanie import Document, View

from src.storages.mongo.conversation import Conversation
from src.storages.mongo.knowledge import KnowledgeChunk
from src.storages.mongo.user import User

document_models = cast(
    list[type[Document] | type[View] | str],
    [User, Conversation, KnowledgeChunk],
)
