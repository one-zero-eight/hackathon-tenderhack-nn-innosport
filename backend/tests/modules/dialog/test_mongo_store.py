from types import SimpleNamespace

from beanie import PydanticObjectId

from src.modules.dialog.store import ConversationState
from src.storages.mongo.conversation import Conversation, MongoConversationStore


async def test_mongo_store_rejects_malformed_id_without_query() -> None:
    assert await MongoConversationStore().get("not-an-object-id") is None


async def test_mongo_store_uses_optimistic_revision(monkeypatch) -> None:
    class FakeCollection:
        query = None
        update = None

        async def update_one(self, query, update):
            self.query = query
            self.update = update
            return SimpleNamespace(matched_count=1)

    collection = FakeCollection()
    monkeypatch.setattr(Conversation, "get_motor_collection", lambda: collection)
    state = ConversationState(id=str(PydanticObjectId()), revision=2)

    await MongoConversationStore().save(state)

    assert collection.query["revision"] == 2
    assert collection.update["$inc"] == {"revision": 1}
    assert state.revision == 3
