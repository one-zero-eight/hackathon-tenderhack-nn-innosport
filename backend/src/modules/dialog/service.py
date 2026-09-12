from __future__ import annotations

from fastapi import HTTPException, status

from src.modules.dialog.abuse import is_abuse
from src.modules.dialog.classify import (
    clarification_options,
    lock_topic,
    match_pending_option,
    rank_topics,
)
from src.modules.dialog.llama import DialogLlamaClient, NullLlamaClient
from src.modules.dialog.models import KnowledgeBase, Topic
from src.modules.dialog.retrieval import KnowledgeRetriever, extractive_reply
from src.modules.dialog.routing import is_l2_request
from src.modules.dialog.schemas import (
    Citation,
    DialogDeleteResult,
    DialogListItem,
    DialogMessage,
    DialogResponse,
    DialogStatus,
    DialogView,
    SupportLine,
    TopicRef,
)
from src.modules.dialog.store import (
    ConversationConflictError,
    ConversationState,
    ConversationStore,
    StoredCitation,
    StoredMessage,
)
from src.modules.dialog.texts import (
    ABUSE_REPLY,
    CLARIFY_FAILED_REPLY,
    CLARIFY_REPLY,
    CLOSED_REPLY,
    L1_REPLY,
    L2_REPLY,
    NO_KNOWLEDGE_REPLY,
)


class DialogClosedError(HTTPException):
    def __init__(self, payload: DialogResponse) -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=payload.model_dump(mode="json"))


class DialogService:
    def __init__(
        self,
        knowledge: KnowledgeBase,
        store: ConversationStore,
        retriever: KnowledgeRetriever,
        llama_client: DialogLlamaClient | None = None,
        max_clarifications: int = 3,
    ) -> None:
        self.knowledge = knowledge
        self.store = store
        self.retriever = retriever
        self.llama_client = llama_client or NullLlamaClient()
        self.max_clarifications = max_clarifications

    async def create(self) -> DialogView:
        state = await self.store.create()
        return self._view(state, reply="")

    async def get(self, dialog_id: str) -> DialogView:
        state = await self._require(dialog_id)
        reply = next((item.content for item in reversed(state.messages) if item.role == "assistant"), "")
        return self._view(state, reply=reply)

    async def list_dialogs(self, *, limit: int = 100) -> list[DialogListItem]:
        return [self._list_item(state) for state in await self.store.list(limit=limit)]

    async def delete(self, dialog_id: str) -> DialogDeleteResult:
        if not await self.store.delete(dialog_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dialog not found")
        return DialogDeleteResult(deleted=1)

    async def delete_all(self) -> DialogDeleteResult:
        return DialogDeleteResult(deleted=await self.store.delete_all())

    async def add_message(self, dialog_id: str, content: str) -> DialogResponse:
        state = await self._require(dialog_id)
        if state.closed:
            raise DialogClosedError(self._response(state, CLOSED_REPLY))
        text = content.strip()
        state.messages.append(StoredMessage(role="user", content=text))
        response = await self._step(state, text)
        state.messages.append(StoredMessage(role="assistant", content=response.reply))
        await self._save(state)
        return response

    async def request_specialist(self, dialog_id: str) -> DialogResponse:
        state = await self._require(dialog_id)
        if state.closed:
            raise DialogClosedError(self._response(state, CLOSED_REPLY))
        user_messages = [item.content for item in state.messages if item.role == "user"]
        if not user_messages:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="At least one user message is required before selecting a specialist",
            )
        history = "\n".join(user_messages)
        line = SupportLine.L2 if is_l2_request(history) else SupportLine.L1
        topic = self.knowledge.topic_by_id(state.topic_id) if state.topic_id else None
        response = self._finish(
            state,
            reply=L2_REPLY if line == SupportLine.L2 else L1_REPLY,
            status=DialogStatus.ESCALATE,
            closed=True,
            reason="specialist_requested",
            line=line,
            topic=topic,
        )
        state.messages.append(StoredMessage(role="assistant", content=response.reply))
        await self._save(state)
        return response

    async def _save(self, state: ConversationState) -> None:
        try:
            await self.store.save(state)
        except ConversationConflictError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Dialog changed concurrently; retry the request",
            ) from exc

    async def _require(self, dialog_id: str) -> ConversationState:
        state = await self.store.get(dialog_id)
        if state is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dialog not found")
        return state

    async def _step(self, state: ConversationState, text: str) -> DialogResponse:
        if is_abuse(text):
            return self._finish(
                state,
                reply=ABUSE_REPLY,
                status=DialogStatus.CLOSED_ABUSE,
                closed=True,
                reason="abuse",
                line=None,
            )

        dialog_query = self._dialog_query(state)
        topic = await self._resolve_topic(state, text, dialog_query)
        if topic is None:
            if state.failed_clarifications >= self.max_clarifications:
                return self._offer_specialist(state, CLARIFY_FAILED_REPLY, "topic_unresolved")
            options = [self.knowledge.topic_by_id(item) for item in state.pending_option_ids]
            topics = [item for item in options if item is not None]
            if not topics:
                ranked = rank_topics(text, self.knowledge)
                topics = clarification_options(ranked, self.knowledge)
                state.pending_option_ids = [item.id for item in topics]
            state.failed_clarifications += 1
            state.status = DialogStatus.CLARIFYING
            state.line = None
            state.citations = []
            return self._response(
                state,
                CLARIFY_REPLY,
                options=topics,
            )

        state.topic_id = topic.id
        state.pending_option_ids = []
        state.line = None
        chunks = await self.retriever.find(dialog_query, topic)
        if not chunks:
            return self._offer_specialist(
                state,
                NO_KNOWLEDGE_REPLY,
                "no_knowledge",
                topic=topic,
            )
        history = [(item.role, item.content) for item in state.messages]
        generated = await self.llama_client.generate_answer(text, history, topic, chunks)
        if generated is not None:
            selected = [chunk for chunk in chunks if chunk.id in generated.citation_ids]
            reply = generated.text
        else:
            selected = chunks
            reply = extractive_reply(dialog_query, selected)
        if not reply:
            return self._offer_specialist(
                state,
                NO_KNOWLEDGE_REPLY,
                "no_knowledge",
                topic=topic,
            )
        state.status = DialogStatus.ANSWERED
        state.closed = False
        state.reason = None
        state.line = None
        state.citations = [
            StoredCitation(
                document=chunk.document,
                section=chunk.section,
                path=chunk.path,
            )
            for chunk in selected
        ]
        return self._response(
            state,
            reply,
            topic=topic,
            citations=[Citation(document=chunk.document, section=chunk.section, path=chunk.path) for chunk in selected],
        )

    async def _resolve_topic(
        self,
        state: ConversationState,
        text: str,
        dialog_query: str,
    ) -> Topic | None:
        if state.topic_id:
            current = self.knowledge.topic_by_id(state.topic_id)
            if current is not None:
                return current
        pending: list[Topic] = []
        for topic_id in state.pending_option_ids:
            found = self.knowledge.topic_by_id(topic_id)
            if found is not None:
                pending.append(found)
        if pending:
            picked = match_pending_option(text, pending)
            if picked is not None:
                return picked
        ranked = rank_topics(dialog_query, self.knowledge)
        locked = lock_topic(ranked, dialog_query)
        if locked is not None:
            return locked
        candidate_topics = [item.topic for item in ranked[:6] if item.score > 0]
        if candidate_topics:
            history = [(item.role, item.content) for item in state.messages]
            suggested_id = await self.llama_client.suggest_topic_id(text, candidate_topics, history)
            if suggested_id:
                suggested = self.knowledge.topic_by_id(suggested_id)
                if suggested is not None:
                    return suggested
        options = clarification_options(ranked, self.knowledge)
        state.pending_option_ids = [item.id for item in options]
        return None

    @staticmethod
    def _dialog_query(state: ConversationState) -> str:
        user_messages = [item.content for item in state.messages if item.role == "user"]
        return "\n".join(user_messages[-8:])

    def _offer_specialist(
        self,
        state: ConversationState,
        reply: str,
        reason: str,
        topic: Topic | None = None,
    ) -> DialogResponse:
        state.status = DialogStatus.ESCALATE
        state.closed = False
        state.reason = reason
        state.line = None
        state.pending_option_ids = []
        state.citations = []
        if topic is not None:
            state.topic_id = topic.id
        return self._response(state, reply, topic=topic)

    def _finish(
        self,
        state: ConversationState,
        *,
        reply: str,
        status: DialogStatus,
        closed: bool,
        reason: str | None,
        line: SupportLine | None,
        topic: Topic | None = None,
    ) -> DialogResponse:
        state.status = status
        state.closed = closed
        state.reason = reason
        state.line = line
        state.pending_option_ids = []
        state.citations = []
        if topic is not None:
            state.topic_id = topic.id
        return self._response(state, reply, topic=topic)

    def _topic_ref(self, topic: Topic | None = None, state: ConversationState | None = None) -> TopicRef | None:
        if topic is None and state and state.topic_id:
            topic = self.knowledge.topic_by_id(state.topic_id)
        if topic is None:
            return None
        return TopicRef(id=topic.id, title=topic.title)

    def _response(
        self,
        state: ConversationState,
        reply: str,
        *,
        topic: Topic | None = None,
        options: list[Topic] | None = None,
        citations: list[Citation] | None = None,
    ) -> DialogResponse:
        return DialogResponse(
            id=state.id,
            reply=reply,
            status=state.status,
            topic=self._topic_ref(topic, state),
            line=state.line,
            clarification_options=[TopicRef(id=item.id, title=item.title) for item in options or []],
            citations=citations or [],
            closed=state.closed,
            reason=state.reason,
            updated_at=state.updated_at,
        )

    def _list_item(self, state: ConversationState) -> DialogListItem:
        topic = self._topic_ref(state=state)
        first_user = next((item.content for item in state.messages if item.role == "user"), "")
        last_user = next((item.content for item in reversed(state.messages) if item.role == "user"), "")
        title = topic.title if topic is not None else _preview_text(first_user) or "Новое обращение"
        return DialogListItem(
            id=state.id,
            title=title,
            preview=_preview_text(last_user or first_user),
            status=state.status,
            topic=topic,
            line=state.line,
            closed=state.closed,
            reason=state.reason,
            updated_at=state.updated_at,
        )

    def _view(self, state: ConversationState, reply: str) -> DialogView:
        options = [
            topic
            for topic_id in state.pending_option_ids
            if (topic := self.knowledge.topic_by_id(topic_id)) is not None
        ]
        citations = [Citation(document=item.document, section=item.section, path=item.path) for item in state.citations]
        base = self._response(state, reply, options=options, citations=citations)
        return DialogView(
            **base.model_dump(),
            messages=[DialogMessage(role=item.role, content=item.content) for item in state.messages],
        )


def _preview_text(text: str, *, limit: int = 80) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"
