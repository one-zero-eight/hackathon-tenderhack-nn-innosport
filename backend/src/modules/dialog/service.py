import re

from fastapi import HTTPException, status

from src.modules.dialog.abuse import is_abuse
from src.modules.dialog.classify import is_capability_question, is_greeting, is_thanks
from src.modules.dialog.llama import DialogLlamaClient, NullLlamaClient
from src.modules.dialog.retrieval import KnowledgeRetriever, extractive_answer
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
    CAPABILITIES_REPLY,
    CLOSED_REPLY,
    GREETING_REPLY,
    L1_REPLY,
    L2_REPLY,
    MODEL_UNAVAILABLE_REPLY,
    NO_KNOWLEDGE_REPLY,
)


class DialogClosedError(HTTPException):
    def __init__(self, payload: DialogResponse) -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=payload.model_dump(mode="json"))


class DialogService:
    def __init__(
        self,
        store: ConversationStore,
        retriever: KnowledgeRetriever,
        llama_client: DialogLlamaClient | None = None,
    ) -> None:
        self.store = store
        self.retriever = retriever
        self.llama_client = llama_client or NullLlamaClient()

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
        response = self._finish(
            state,
            reply=L2_REPLY if line == SupportLine.L2 else L1_REPLY,
            status=DialogStatus.ESCALATE,
            closed=True,
            reason="specialist_requested",
            line=line,
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

        if isinstance(self.llama_client, NullLlamaClient) and (is_greeting(text) or is_capability_question(text)):
            return self._finish(
                state,
                reply=GREETING_REPLY if is_greeting(text) else CAPABILITIES_REPLY,
                status=DialogStatus.CLARIFYING,
                closed=False,
                reason=None,
                line=None,
            )

        if is_thanks(text):
            return self._finish(
                state,
                reply="Пожалуйста! Обращайтесь, если появятся вопросы.",
                status=DialogStatus.CLARIFYING,
                closed=False,
                reason=None,
                line=None,
            )

        history = [(item.role, item.content) for item in state.messages]
        result = await self.llama_client.run(text, history, self.retriever)
        if result is not None:
            generated = result.reply
            if generated.kind != "answer":
                return self._finish(
                    state,
                    reply=generated.text,
                    status=DialogStatus.ESCALATE if generated.kind == "no_knowledge" else DialogStatus.CLARIFYING,
                    closed=False,
                    reason="no_knowledge" if generated.kind == "no_knowledge" else None,
                    line=None,
                )
            selected = result.sources
            reply = generated.text
        elif isinstance(self.llama_client, NullLlamaClient):
            dialog_query = self._dialog_query(state)
            chunks = await self.retriever.find(dialog_query, limit=6)
            reply, selected = extractive_answer(dialog_query, chunks)
        else:
            # Agent failure must not silently turn a related passage into an
            # authoritative answer. Keep the dialog open for retry/handoff.
            return self._finish(
                state,
                reply=MODEL_UNAVAILABLE_REPLY,
                status=DialogStatus.CLARIFYING,
                closed=False,
                reason="model_unavailable",
                line=None,
            )
        if not reply:
            return self._offer_specialist(state)
        state.status = DialogStatus.ANSWERED
        state.closed = False
        state.reason = None
        state.line = None
        unique_sources = dict.fromkeys((chunk.document, chunk.section, chunk.path) for chunk in selected)
        state.citations = [
            StoredCitation(document=document, section=section, path=path) for document, section, path in unique_sources
        ]
        return self._response(
            state,
            reply,
            citations=[
                Citation(document=document, section=section, path=path) for document, section, path in unique_sources
            ],
        )

    @staticmethod
    def _dialog_query(state: ConversationState) -> str:
        user_messages = [
            item.content
            for item in state.messages
            if item.role == "user" and not is_greeting(item.content) and not is_capability_question(item.content)
        ]
        if not user_messages:
            return ""
        current = user_messages[-1]
        # Resolve explicit follow-ups without polluting a new question with old topics.
        follow_up = re.search(
            r"^(?:а\s+)?(?:(?:как|где|когда|почему|зачем)\s+)?"
            r"(?:это|этого|этому|этой|этот|эту|этом|его|её|ее|их|такой|такую|там|дальше|подробнее)\b"
            r"|^(?:не получилось|не помогло|что делать дальше|а по|а если|я поставщик|я заказчик)\b",
            current,
            re.IGNORECASE,
        )
        if follow_up and len(user_messages) > 1:
            return f"{user_messages[-2]}\n{current}"
        return current

    def _offer_specialist(self, state: ConversationState) -> DialogResponse:
        return self._finish(
            state,
            reply=NO_KNOWLEDGE_REPLY,
            status=DialogStatus.ESCALATE,
            closed=False,
            reason="no_knowledge",
            line=None,
        )

    def _finish(
        self,
        state: ConversationState,
        *,
        reply: str,
        status: DialogStatus,
        closed: bool,
        reason: str | None,
        line: SupportLine | None,
    ) -> DialogResponse:
        state.status = status
        state.closed = closed
        state.reason = reason
        state.line = line
        state.citations = []
        return self._response(state, reply)

    def _response(
        self,
        state: ConversationState,
        reply: str,
        *,
        citations: list[Citation] | None = None,
    ) -> DialogResponse:
        return DialogResponse(
            id=state.id,
            reply=reply,
            status=state.status,
            line=state.line,
            citations=citations or [],
            closed=state.closed,
            reason=state.reason,
            updated_at=state.updated_at,
        )

    def _list_item(self, state: ConversationState) -> DialogListItem:
        first_user = next((item.content for item in state.messages if item.role == "user"), "")
        last_user = next((item.content for item in reversed(state.messages) if item.role == "user"), "")
        return DialogListItem(
            id=state.id,
            title=_preview_text(first_user) or "Новое обращение",
            preview=_preview_text(last_user or first_user),
            status=state.status,
            line=state.line,
            closed=state.closed,
            reason=state.reason,
            updated_at=state.updated_at,
        )

    def _view(self, state: ConversationState, reply: str) -> DialogView:
        citations = [Citation(document=item.document, section=item.section, path=item.path) for item in state.citations]
        base = self._response(state, reply, citations=citations)
        return DialogView(
            **base.model_dump(),
            messages=[DialogMessage(role=item.role, content=item.content) for item in state.messages],
        )


def _preview_text(text: str, *, limit: int = 80) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"
