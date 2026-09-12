import asyncio
import json
import re
from collections.abc import AsyncIterator
from contextlib import suppress
from uuid import uuid4

from fastapi import HTTPException, status

from src.logging_ import logger
from src.modules.dialog.abuse import is_abuse
from src.modules.dialog.classify import is_capability_question, is_greeting, is_thanks
from src.modules.dialog.llama import DialogLlamaClient, NullLlamaClient, TextCallback, ToolCallback
from src.modules.dialog.retrieval import KnowledgeRetriever, extractive_answer
from src.modules.dialog.routing import is_l2_request
from src.modules.dialog.schemas import (
    Citation,
    Clarification,
    DialogDeleteResult,
    DialogFeedback,
    DialogFeedbackCreate,
    DialogListItem,
    DialogMessage,
    DialogResponse,
    DialogStatus,
    DialogStreamEvent,
    DialogView,
    EscalationPreview,
    SpecialistContact,
    SupportLine,
    ToolCall,
    ToolStatus,
)
from src.modules.dialog.store import (
    ConversationConflictError,
    ConversationState,
    ConversationStore,
    StoredCitation,
    StoredMessage,
    utcnow,
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

    async def submit_feedback(self, dialog_id: str, payload: DialogFeedbackCreate) -> DialogFeedback:
        state = (await self._require(dialog_id)).model_copy(deep=True)
        feedback = DialogFeedback(**payload.model_dump(), submitted_at=utcnow())
        state.feedback = feedback
        await self._save(state)
        return feedback

    async def delete(self, dialog_id: str) -> DialogDeleteResult:
        if not await self.store.delete(dialog_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dialog not found")
        return DialogDeleteResult(deleted=1)

    async def delete_all(self) -> DialogDeleteResult:
        return DialogDeleteResult(deleted=await self.store.delete_all())

    async def _prepare_message(self, dialog_id: str, clarification_id: str | None) -> ConversationState:
        state = await self._require(dialog_id)
        if state.closed:
            raise DialogClosedError(self._response(state, CLOSED_REPLY))
        if clarification_id is not None and (state.clarification is None or state.clarification.id != clarification_id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Clarification is no longer pending")
        # Keep provisional changes isolated even with an in-memory store.
        return state.model_copy(deep=True)

    async def add_message(self, dialog_id: str, content: str, clarification_id: str | None = None) -> DialogResponse:
        state = await self._prepare_message(dialog_id, clarification_id)
        return await self._add_message(state, content)

    async def stream_message(
        self, dialog_id: str, content: str, clarification_id: str | None = None
    ) -> AsyncIterator[str]:
        # Validate before the response headers are sent (404/409 remain HTTP errors).
        state = await self._prepare_message(dialog_id, clarification_id)
        return self._message_events(state, content)

    async def _message_events(self, state: ConversationState, content: str) -> AsyncIterator[str]:
        queue: asyncio.Queue[DialogStreamEvent] = asyncio.Queue(maxsize=1)

        async def on_text(text: str) -> None:
            await queue.put(DialogStreamEvent(type="text", text=text))

        async def on_tool(tool_call: ToolCall, tool_status: ToolStatus) -> None:
            await queue.put(DialogStreamEvent(type="tool", tool_call=tool_call, status=tool_status))

        async def generate() -> None:
            try:
                response = await self._add_message(state, content, on_text=on_text, on_tool=on_tool)
                await queue.put(DialogStreamEvent(type="done", response=response))
            except HTTPException as exc:
                await queue.put(DialogStreamEvent(type="error", detail=str(exc.detail)))
            except Exception:  # noqa: BLE001 - terminate the stream on any producer failure.
                logger.exception("Dialog stream failed: dialog=%s", state.id)
                await queue.put(
                    DialogStreamEvent(type="error", detail="Не удалось получить ответ. Попробуйте ещё раз.")
                )

        task = asyncio.create_task(generate())
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield "\n"  # Keep idle connections alive during retrieval/prompt preparation.
                    continue
                yield event.model_dump_json() + "\n"
                if event.type in {"done", "error"}:
                    break
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def _add_message(
        self,
        state: ConversationState,
        content: str,
        *,
        on_text: TextCallback | None = None,
        on_tool: ToolCallback | None = None,
    ) -> DialogResponse:
        text = content.strip()
        pending = state.clarification
        state.clarification = None
        state.messages.append(StoredMessage(role="user", content=text))
        response = await self._step(state, text, pending=pending, on_text=on_text, on_tool=on_tool)
        state.messages.append(
            StoredMessage(
                role="assistant",
                content=response.reply,
                clarification=response.clarification,
                tool_calls=response.tool_calls,
            )
        )
        await self._save(state)
        response.updated_at = state.updated_at
        return response

    @staticmethod
    def _specialist_line(state: ConversationState) -> SupportLine:
        history = "\n".join(item.content for item in state.messages if item.role == "user")
        return SupportLine.L2 if is_l2_request(history) else SupportLine.L1

    async def escalation_preview(self, dialog_id: str) -> EscalationPreview:
        state = await self._require(dialog_id)
        if state.closed:
            raise DialogClosedError(self._response(state, CLOSED_REPLY))
        return EscalationPreview(line=self._specialist_line(state))

    async def request_specialist(self, dialog_id: str, payload: SpecialistContact) -> DialogResponse:
        state = (await self._require(dialog_id)).model_copy(deep=True)
        if state.closed:
            raise DialogClosedError(self._response(state, CLOSED_REPLY))
        line = self._specialist_line(state)
        state.specialist_contact = payload.model_copy(deep=True)
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
        response.updated_at = state.updated_at
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

    async def _step(
        self,
        state: ConversationState,
        text: str,
        *,
        pending: Clarification | None = None,
        on_text: TextCallback | None = None,
        on_tool: ToolCallback | None = None,
    ) -> DialogResponse:
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

        if pending is None and is_thanks(text):
            return self._finish(
                state,
                reply="Пожалуйста! Обращайтесь, если появятся вопросы.",
                status=DialogStatus.CLARIFYING,
                closed=False,
                reason=None,
                line=None,
            )

        history = [(item.role, item.content) for item in state.messages]
        agent_question = text
        if pending is not None:
            # The current turn includes the pending tool question, so even short
            # selections remain meaningful after the model compacts chat history.
            original = next(
                (
                    item.content
                    for index, item in reversed(list(enumerate(state.messages[:-1])))
                    if item.role == "user" and (index == 0 or state.messages[index - 1].clarification is None)
                ),
                "",
            )
            agent_question = (
                "Уточнение получено. Продолжи решать исходный запрос; не повторяй этот вопрос.\n"
                + json.dumps(
                    {
                        "original_request": original,
                        "question": pending.question,
                        "options": pending.options,
                        "answer": text,
                    },
                    ensure_ascii=False,
                )
            )
            history[-1] = ("user", agent_question)
        result = await self.llama_client.run(agent_question, history, self.retriever, on_text=on_text, on_tool=on_tool)
        tool_calls = result.tool_calls if result is not None else []
        if result is not None and result.reply is not None:
            generated = result.reply
            if result.clarification is not None:
                clarification = Clarification(id=uuid4().hex, **result.clarification.model_dump())
                return self._finish(
                    state,
                    reply=clarification.question,
                    status=DialogStatus.CLARIFYING,
                    closed=False,
                    reason=None,
                    line=None,
                    clarification=clarification,
                    tool_calls=tool_calls,
                )
            if generated.kind != "answer":
                return self._finish(
                    state,
                    reply=generated.text,
                    status=DialogStatus.ESCALATE if generated.kind == "no_knowledge" else DialogStatus.CLARIFYING,
                    closed=False,
                    reason="no_knowledge" if generated.kind == "no_knowledge" else None,
                    line=None,
                    tool_calls=tool_calls,
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
                tool_calls=tool_calls,
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
            tool_calls=tool_calls,
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
        clarification: Clarification | None = None,
        tool_calls: list[ToolCall] | None = None,
    ) -> DialogResponse:
        state.clarification = clarification
        state.status = status
        state.closed = closed
        state.reason = reason
        state.line = line
        state.citations = []
        return self._response(state, reply, tool_calls=tool_calls)

    def _response(
        self,
        state: ConversationState,
        reply: str,
        *,
        citations: list[Citation] | None = None,
        tool_calls: list[ToolCall] | None = None,
    ) -> DialogResponse:
        return DialogResponse(
            id=state.id,
            reply=reply,
            clarification=state.clarification,
            tool_calls=tool_calls or [],
            status=state.status,
            line=state.line,
            citations=citations or [],
            closed=state.closed,
            reason=state.reason,
            feedback=state.feedback,
            specialist_contact=state.specialist_contact,
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
            feedback=state.feedback,
            updated_at=state.updated_at,
        )

    def _view(self, state: ConversationState, reply: str) -> DialogView:
        citations = [Citation(document=item.document, section=item.section, path=item.path) for item in state.citations]
        last_assistant = next((item for item in reversed(state.messages) if item.role == "assistant"), None)
        base = self._response(
            state,
            reply,
            citations=citations,
            tool_calls=last_assistant.tool_calls if last_assistant is not None else [],
        )
        return DialogView(
            **base.model_dump(),
            messages=[
                DialogMessage(
                    role=item.role,
                    content=item.content,
                    clarification=item.clarification,
                    tool_calls=item.tool_calls,
                )
                for item in state.messages
            ],
        )


def _preview_text(text: str, *, limit: int = 80) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"
