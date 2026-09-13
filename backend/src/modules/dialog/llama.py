import json
import re
import time as tm
from collections.abc import Awaitable, Callable
from functools import lru_cache
from dataclasses import dataclass, field
from typing import Annotated, Literal, Protocol
from uuid import uuid4

import httpx
from pydantic import Field, StringConstraints, ValidationError
from pydantic_core import from_json

from src.logging_ import logger
from src.modules.dialog.abuse import has_profanity_or_insult, has_working_request, preferred_rephrase, usable_rephrase
from src.modules.dialog.catalog import load_knowledge
from src.modules.dialog.classify import is_open_help, reports_ui_defect
from src.modules.dialog.models import Chunk
from src.modules.dialog.normalize import ABBREVIATIONS, significant_stems
from src.modules.dialog.retrieval import KnowledgeRetriever, clean_source_text, score_chunk
from src.modules.dialog.schemas import ClarificationQuestion, SupportLine, ToolCall, ToolStatus
from src.pydantic_base import BaseSchema

AGENT_INSTRUCTIONS = """Ты — справочная поддержка Портала поставщиков. Отвечай по-русски, на «вы».
Справочник, не кабинет:
- Не выполняешь действия и не меняешь данные.
- Не просишь ID, ИНН, пароль или другие данные аккаунта.
- Не выдумывай. Используй только найденные источники.

За шаг верни ровно одно JSON-действие:
{"reason":"одно предложение","name":"<tool>","arguments":{...}}

ПОРЯДОК

1. Приветствие, благодарность, светская беседа («как дела») → respond(kind="conversation"), без поиска.

2. «Помоги», «поможешь», «что умеешь» — не тема справочника. Сразу ask_clarification:
«С чем помочь?» → Регистрация, Электронная подпись, Личный кабинет, Закупки, Контракты, Прайс-листы.
Без поиска. Не «Что нужно по теме «поможешь»».

3. Сообщение о сломанном интерфейсе: пропала кнопка, форма падает, элемент не работает → respond(kind="no_knowledge"). Не объясняй клики.

4. Короткий запрос («регистрация», «МЧД», «хочу удалить») — сначала search_knowledge по теме.
Потом ask_clarification: Конкретный вопрос по которому нужно уточнить → понятные сценарии
(«Как пройти», «Статус заявки», «Ошибка»).
Не «что именно», не ID/ИНН/пароль, не подтверждение. ask_clarification после ответа пользователя
должен дать полезную информацию для следующих сообщений. не выдумывай варианты.

5. Понятный вопрос с действием или «что такое» («как зарегистрироваться», «что такое ИНН») → search_knowledge.
Переформулируй query, сохраняя смысл и ключевые термины.
Номера сессий, заявок и контрактов в справочнике нет — ищи процедуру (оферта, котировочная сессия), не номер.

6. После search_knowledge:
- sources описывают разные процедуры, а в вопросе нет выбора → ask_clarification, варианты из sources.section. Не склеивай несколько инструкций в один ответ;
- один сценарий и вопрос понятен → respond(kind="answer") с citation_ids;
- короткий запрос без объекта → ask_clarification по правилам инструмента;
- пусто или нерелевантно → respond(kind="no_knowledge").
Не копируй текст sources в варианты. Не уточняй, если sources уже сходятся в одну процедуру.
«Не пришло / не получена оферта» — не проверка номера. Если sources про создание или публикацию оферты, ответь answer: кто создаёт, срок. Не no_knowledge.

7. Если sources нет или они не отвечают на вопрос → respond(kind="no_knowledge").
Не додумывай отсутствующие факты. Не no_knowledge, если sources уже есть.

8. Если пользователь просит выполнить действие («удали», «измени», «разблокируй») — никогда не утверждай, что сделал это. Если есть инструкция для самостоятельного выполнения, найди её; иначе no_knowledge.

answer = только подтверждённая справочником информация.
conversation = разговор без citations.
no_knowledge = информации недостаточно.

До 1200 символов. Краткий Markdown. Не заканчивай ответ двоеточием."""

LINE_CLASSIFY_INSTRUCTIONS = (
    "Определи линию поддержки для обращения. Верни только JSON "
    '{"line": "L1"} или {"line": "L2"} по правилам и примерам ниже. '
    "Если в одном сообщении есть и самообслуживание, и сбой/нет кнопки/действие оператора — L2."
)
LINE_CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {"line": {"type": "string", "enum": ["L1", "L2"]}},
    "required": ["line"],
    "additionalProperties": False,
}
LINE_CLASSIFY_QUESTION_CHARS = 1200
LINE_CLASSIFY_MAX_TOKENS = 16

MODERATION_INSTRUCTIONS = """Оцени ТОЛЬКО текущее сообщение. История не нужна. Верни JSON.
- clean — нет мата и прямых оскорблений. Злость без оскорбления («Это ужас, ничего не работает») — clean.
- mixed — мат/оскорбление И отдельный рабочий запрос: объект, действие, тема портала. Не закрывай.
- pure_abuse — одна ругань/оскорбление, даже с «?»: «ебанат?», «блядь», «идиоты». Вопросительный знак без объекта — не запрос.
Словарь — сигнал, не решение. Контекстные анатомические слова без оскорбления — clean.
cleaned_request только для mixed: готовое следующее сообщение пользователя, как он сам бы написал в чат.
Пиши вопрос или просьбу: «Когда починят оплату?», «Как добавить МЧД?». Без мата и оскорблений.
Запрещено: «Пользователь спрашивает…», «Клиент хочет…», «Запрос:…», повтор исходной ругани."""
MODERATION_QUESTION_CHARS = 1200
MODERATION_MAX_TOKENS = 192


class AgentReply(BaseSchema):
    kind: Literal["answer", "clarify", "conversation", "no_knowledge"]
    text: str = Field(min_length=1, max_length=1200)
    citation_ids: list[str]


class RespondReply(AgentReply):
    kind: Literal["answer", "conversation", "no_knowledge"]


class ModerationVerdict(BaseSchema):
    verdict: Literal["clean", "mixed", "pure_abuse"]
    cleaned_request: Annotated[str, StringConstraints(max_length=400)] = ""


@dataclass
class AgentResult:
    reply: AgentReply | None
    sources: list[Chunk]
    clarification: ClarificationQuestion | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


MODERATION_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["clean", "mixed", "pure_abuse"]},
        "cleaned_request": {"type": "string", "maxLength": 400},
    },
    "required": ["verdict", "cleaned_request"],
    "additionalProperties": False,
}


type TextCallback = Callable[[str], Awaitable[None]]
type ToolCallback = Callable[[ToolCall, ToolStatus], Awaitable[None]]


class DialogLlamaClient(Protocol):
    async def run(
        self,
        question: str,
        history: list[tuple[str, str]],
        retriever: KnowledgeRetriever,
        *,
        on_text: TextCallback | None = None,
        on_tool: ToolCallback | None = None,
    ) -> AgentResult | None: ...

    async def moderate(self, question: str, *, lexicon_matches: tuple[str, ...] = ()) -> ModerationVerdict | None: ...

    async def classify_line(self, question: str) -> SupportLine | None: ...

    async def aclose(self) -> None: ...


class NullLlamaClient:
    async def run(
        self,
        question: str,
        history: list[tuple[str, str]],
        retriever: KnowledgeRetriever,
        *,
        on_text: TextCallback | None = None,
        on_tool: ToolCallback | None = None,
    ) -> AgentResult | None:
        return None

    async def moderate(self, question: str, *, lexicon_matches: tuple[str, ...] = ()) -> ModerationVerdict | None:
        return None

    async def classify_line(self, question: str) -> SupportLine | None:
        return None

    async def aclose(self) -> None:
        return None


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


TOOLS = [
    _tool(
        "search_knowledge",
        "Найти инструкции портала по смысловому запросу (можешь переформулировать запрос). "
        "Номеров обращений в справочнике нет — ищи процедуру, не номер сессии или заявки.",
        {"query": {"type": "string", "minLength": 2, "maxLength": 500}},
        ["query"],
    ),
    # _tool(
    #     "read_section",
    #     "Прочитать продолжение раздела по ID фрагмента из поиска.",
    #     {"chunk_id": {"type": "string"}, "offset": {"type": "integer", "minimum": 0, "default": 0}},
    #     ["chunk_id"],
    # ),
    _tool(
        "ask_clarification",
        "Карточка с вариантами, когда в вопросе не хватает выбора. "
        "«Помоги», «поможешь», «что умеешь» — это не тема. "
        "question: «С чем помочь?». "
        "options: Регистрация, Электронная подпись, Личный кабинет, Закупки, Контракты, Прайс-листы. "
        "Без поиска. Не «Что нужно по теме «поможешь»». "
        "После search_knowledge, если sources — разные процедуры: "
        "question про недостающий выбор, options — 2–6 коротких названий из sources.section. "
        "Не склеивай разные инструкции в respond. Не копируй «Рисунок …» и обрывки. "
        "Не «что именно». Не вопросы в вариантах. Не ИНН/пароль/подтвердить.",
        ClarificationQuestion.model_json_schema()["properties"],
        ["question", "options"],
    ),
    _tool(
        "respond",
        "Итоговый ответ без сбора id и без подтверждения действий. answer требует источники.",
        RespondReply.model_json_schema()["properties"],
        ["kind", "text", "citation_ids"],
    ),
]


class LlamaCppClient:
    """Bounded schema-constrained agent. Retrieval runs only when the model selects it."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str = "",
        answer_max_tokens: int = 1024,
        context_tokens: int = 2048,
        temperature: float = 0.0,
        max_tool_rounds: int = 2,
        llama_extensions: bool = True,
        enable_thinking: bool = False,
        line_examples: str = "",
        line_base_url: str | None = None,
        line_model: str | None = None,
        line_llama_extensions: bool | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.answer_max_tokens = answer_max_tokens
        self.context_tokens = context_tokens
        self.temperature = temperature
        self.max_tool_rounds = max_tool_rounds
        self.llama_extensions = llama_extensions
        self.enable_thinking = enable_thinking
        self.line_examples = line_examples
        self.line_base_url = (line_base_url or base_url).rstrip("/")
        self.line_model = line_model or model
        self.line_llama_extensions = llama_extensions if line_llama_extensions is None else line_llama_extensions
        # Deliberately wait for the local model; the agent still has a step limit.
        self._client = httpx.AsyncClient(timeout=None)  # noqa: S113

    async def run(
        self,
        question: str,
        history: list[tuple[str, str]],
        retriever: KnowledgeRetriever,
        *,
        on_text: TextCallback | None = None,
        on_tool: ToolCallback | None = None,
    ) -> AgentResult | None:
        started = tm.monotonic()
        trace = {"stage": "start", "round": 0}
        tool_calls: list[ToolCall] = []
        try:
            result = await self._run(question, history, retriever, trace, tool_calls, on_text, on_tool)
        except httpx.HTTPError as exc:
            response_body = exc.response.text[:4000] if isinstance(exc, httpx.HTTPStatusError) else None
            logger.warning(
                "Support agent HTTP failure: stage=%s round=%s elapsed=%.1fs error=%r response_body=%r",
                trace["stage"],
                trace["round"],
                tm.monotonic() - started,
                exc,
                response_body,
            )
            result = None
        if result is None and tool_calls:
            return AgentResult(reply=None, sources=[], tool_calls=tool_calls)
        return result

    async def classify_line(self, question: str) -> SupportLine | None:
        text = question[-LINE_CLASSIFY_QUESTION_CHARS:].strip()
        if not text or not self.line_examples.strip():
            return None
        messages = [
            {"role": "system", "content": f"{LINE_CLASSIFY_INSTRUCTIONS}\n\n{self.line_examples.strip()}"},
            {"role": "user", "content": text},
        ]
        payload: dict = {
            "model": self.line_model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "support_line",
                    "strict": True,
                    "schema": LINE_CLASSIFY_SCHEMA,
                },
            },
            "temperature": 0,
            "max_tokens": LINE_CLASSIFY_MAX_TOKENS,
        }
        if self.line_llama_extensions:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
            payload["cache_prompt"] = True
        started = tm.monotonic()
        try:
            response = await self._client.post(f"{self.line_base_url}/v1/chat/completions", json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content) if isinstance(content, str) else content
            line = parsed["line"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
            logger.warning("Line classify failed: elapsed=%.1fs error=%r", tm.monotonic() - started, exc)
            return None
        logger.info("Line classify elapsed=%.1fs line=%s", tm.monotonic() - started, line)
        if line == SupportLine.L1:
            return SupportLine.L1
        if line == SupportLine.L2:
            return SupportLine.L2
        return None

    async def moderate(self, question: str, *, lexicon_matches: tuple[str, ...] = ()) -> ModerationVerdict | None:
        text = question[-MODERATION_QUESTION_CHARS:].strip()
        if not text:
            return None
        messages = [
            {"role": "system", "content": MODERATION_INSTRUCTIONS},
            {"role": "user", "content": _moderation_preamble(lexicon_matches) + text},
        ]
        payload: dict = {
            "model": self.line_model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "moderation",
                    "strict": True,
                    "schema": MODERATION_SCHEMA,
                },
            },
            "temperature": 0,
            "max_tokens": MODERATION_MAX_TOKENS,
        }
        if self.line_llama_extensions:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
            payload["cache_prompt"] = True
        started = tm.monotonic()
        try:
            response = await self._client.post(f"{self.line_base_url}/v1/chat/completions", json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content) if isinstance(content, str) else content
            verdict = _parse_moderation(parsed, question=question)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
            logger.warning("Moderation failed: elapsed=%.1fs error=%r", tm.monotonic() - started, exc)
            return None
        logger.info(
            "Moderation elapsed=%.1fs verdict=%s",
            tm.monotonic() - started,
            None if verdict is None else verdict.verdict,
        )
        return verdict

    async def _run(
        self,
        question: str,
        history: list[tuple[str, str]],
        retriever: KnowledgeRetriever,
        trace: dict,
        tool_calls: list[ToolCall],
        on_text: TextCallback | None,
        on_tool: ToolCallback | None,
    ) -> AgentResult | None:
        turns = history[:-1] if history and history[-1] == ("user", question) else history
        messages: list[dict] = [{"role": "system", "content": AGENT_INSTRUCTIONS}]
        # Preserve whole recent exchanges; the current question is never clipped.
        for role, text in turns[-4:]:
            if role in {"user", "assistant"} and len(text) <= 800:
                messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": question})
        evidence: dict[str, Chunk] = {}
        executed: set[tuple[str, str]] = set()
        # Reserve one bounded repair turn, including after the last retrieval round.
        for round_number in range(self.max_tool_rounds + 2):
            if round_number > self.max_tool_rounds and not evidence:
                break
            trace.update(stage="model", round=round_number)
            if is_open_help(question):
                allowed = {"ask_clarification"}
            elif reports_ui_defect(question):
                allowed = {"respond"}
            elif evidence:
                if _needs_disambiguation(question, evidence) or (
                    _needs_fork(question) and len(_catalog_fork_options(question)) >= 2
                ):
                    allowed = {"ask_clarification"}
                elif _needs_fork(question):
                    allowed = {"ask_clarification", "respond"}
                else:
                    allowed = {"respond"}
            elif _needs_fork(question):
                allowed = {"search_knowledge"}
            else:
                allowed = {"search_knowledge", "respond"}
            tools = TOOLS if round_number < self.max_tool_rounds else TOOLS[-2:]
            if allowed is not None:
                tools = [tool for tool in tools if tool["function"]["name"] in allowed]
                if not tools:
                    tools = [tool for tool in TOOLS if tool["function"]["name"] == "respond"]
            message_budget = max(2600, (self.context_tokens - self.answer_max_tokens - 200) * 3)
            _compact_messages(messages, max_chars=message_budget)
            # One completion per step; no reviewer or blind regeneration loop.
            if on_text is not None:
                await on_text("")
            message = await self._complete(messages, tools, on_text=on_text, on_tool=on_tool)
            if message is None:
                return None
            calls = message.get("tool_calls")
            if not isinstance(calls, list) or len(calls) != 1:
                logger.warning("Support agent did not return exactly one tool call")
                return None
            call = calls[0]
            try:
                name = call["function"]["name"]
                args = json.loads(call["function"]["arguments"])
                call_id = call["id"]
            except KeyError, TypeError, json.JSONDecodeError:
                return None
            if not isinstance(args, dict) or not isinstance(call_id, str) or not isinstance(name, str):
                return None
            # Keep the complete trace outside messages, which are compacted for the model.
            tool_call = ToolCall(id=call_id, name=name, reason=call["reason"], arguments=args, result={})
            tool_calls.append(tool_call)
            if on_tool is not None:
                await on_tool(tool_call.model_copy(deep=True), "running")
            trace["stage"] = name
            if name == "ask_clarification":
                try:
                    if set(args) != {"question", "options"}:
                        raise ValueError("Unexpected clarification fields")
                    clarification = ClarificationQuestion.model_validate(args, strict=True)
                except ValueError:
                    result = {"error": "Нужен непустой вопрос и 2–6 уникальных вариантов."}
                else:
                    if reports_ui_defect(question):
                        result = {
                            "error": "Пользователь уже описал сбой интерфейса. "
                            "Не уточняй кнопку или карточку. respond kind=no_knowledge без citation_ids."
                        }
                    elif not evidence:
                        if is_open_help(question):
                            if not _is_help_menu(clarification):
                                clarification = help_menu_clarification()
                            return await _finish_clarification(clarification, tool_call, tool_calls, on_tool)
                        result = {
                            "error": "Сначала search_knowledge. "
                            "Варианты бери из найденных sources.section, не выдумывай."
                        }
                    elif not _may_clarify(question, evidence):
                        result = {"error": f"Вопрос уже понятен. {_respond_hint(evidence)}"}
                    elif (
                        not _is_type_fork(clarification)
                        or _echo_options(question, clarification.options)
                        or _is_generic_intent_card(clarification.options)
                        or any(not _usable_option(option, _topic_label(question)) for option in clarification.options)
                    ):
                        grounded = _clarification_from_evidence(question, evidence)
                        if grounded is not None:
                            return await _finish_clarification(grounded, tool_call, tool_calls, on_tool)
                        result = {
                            "error": "Варианты — 2–6 коротких сценариев из sources.section, "
                            "не «что именно» и не вопросы."
                        }
                    elif _harvests_user_value(clarification.question) or _is_form_clarification(clarification):
                        result = {
                            "error": "Не собирай данные пользователя и не рисуй форму. "
                            "search_knowledge, как пользователь сделает это сам, "
                            "иначе respond kind=no_knowledge или conversation с отказом."
                        }
                    elif _named_mutation(question):
                        result = {
                            "error": "Не выполняй действие и не рисуй мастер. "
                            "search_knowledge, как сделать самому, или respond kind=conversation с отказом."
                        }
                    else:
                        return await _finish_clarification(clarification, tool_call, tool_calls, on_tool)
            elif name == "respond":
                reply = _parse_reply(args, evidence)
                if reply is not None and reply.kind == "answer" and _needs_disambiguation(question, evidence):
                    reply = None
                    result = {
                        "error": "В источниках несколько разных процедур. "
                        "ask_clarification: вопрос про недостающий выбор, "
                        "варианты из sources.section, не склеивай инструкции."
                    }
                elif reply is not None and reply.kind == "answer" and reports_ui_defect(question):
                    reply = None
                    result = {
                        "error": "Это сбой интерфейса, не инструкция «как нажать». "
                        "respond kind=no_knowledge без citation_ids."
                    }
                elif reply is not None and reply.kind == "answer" and _asks_personal_fact(question):
                    reply = None
                    result = {
                        "error": "Это данные конкретного аккаунта, не процедура справочника. "
                        "respond kind=no_knowledge без citation_ids."
                    }
                elif (
                    reply is not None
                    and reply.kind == "answer"
                    and _asks_for_term(question)
                    and not _states_duration(reply.text)
                ):
                    reply = None
                    result = {
                        "error": "В источниках нет запрошенного срока. "
                        "Не подменяй статусами. respond kind=no_knowledge, citation_ids=[]."
                    }
                elif isinstance(args.get("text"), str) and _harvests_user_value(args["text"]):
                    if on_text is not None:
                        await on_text("")
                    result = {
                        "error": "Нельзя собирать id, номера и подтверждения действий. "
                        "search_knowledge, как пользователь сделает это сам, "
                        "иначе respond kind=no_knowledge или conversation с отказом. "
                        "Не вызывай ask_clarification для этих данных."
                    }
                elif args.get("kind") == "clarify" or (
                    isinstance(args.get("text"), str)
                    and _requests_clarification(args["text"])
                    and args.get("kind") != "no_knowledge"
                ):
                    if on_text is not None:
                        await on_text("")
                    if not _may_clarify(question, evidence):
                        result = {"error": "Не уточняй. " + _respond_hint(evidence)}
                    else:
                        result = {
                            "error": "Уточнение — только ask_clarification, варианты из найденных sources.section."
                        }
                elif reply is not None and _is_tool_noise(reply.text):
                    result = {"error": "Не повторяй текст ошибки. " + _respond_hint(evidence)}
                elif (
                    reply is not None
                    and reply.kind in {"conversation", "no_knowledge"}
                    and not reply.citation_ids
                    and _evidence_covers(question, evidence)
                    and not reports_ui_defect(question)
                    and not _asks_personal_fact(question)
                ):
                    result = {"error": "Источники уже есть. " + _respond_hint(evidence)}
                elif reply is not None:
                    tool_call.result = {"status": "completed", **reply.model_dump(mode="json")}
                    if on_tool is not None:
                        await on_tool(tool_call.model_copy(deep=True), "completed")
                    return AgentResult(
                        reply=reply,
                        sources=[evidence[item] for item in reply.citation_ids],
                        tool_calls=tool_calls,
                    )
                else:
                    logger.info(
                        "Support agent rejected respond: kind=%s cites=%s text=%s",
                        args.get("kind"),
                        args.get("citation_ids"),
                        str(args.get("text", ""))[:120],
                    )
                    result = {
                        "error": "Неверный ответ. "
                        f"{_respond_hint(evidence)} "
                        "Не уточняй понятный вопрос. Нет факта — no_knowledge, citation_ids=[]."
                    }
            else:
                key = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
                if key in executed:
                    result = {"error": "Этот запрос уже выполнен. " + _respond_hint(evidence)}
                elif round_number >= self.max_tool_rounds:
                    result = {"error": "Лимит инструментов исчерпан. Заверши ответ."}
                else:
                    executed.add(key)
                    started = tm.monotonic()
                    try:
                        chunks, error = await _execute(name, args, retriever, evidence, question)
                    except httpx.HTTPError, OSError, RuntimeError:
                        logger.exception("Support agent tool failed: tool=%s round=%d", name, round_number)
                        tool_call.result = {"error": "Не удалось выполнить инструмент."}
                        if on_tool is not None:
                            await on_tool(tool_call.model_copy(deep=True), "error")
                        return None
                    # Tool content is bounded before it enters the model context.
                    offset = args.get("offset", 0) if name == "read_section" and not error else 0
                    records, included = _source_records(
                        chunks, max_chars=max(800, message_budget - 1200), offset=offset
                    )
                    evidence.update((chunk.id, chunk) for chunk in included)
                    result = {"sources": records, "has_more": len(included) < len(chunks)}
                    if error:
                        result["error"] = error
                    logger.info(
                        "Support agent tool=%s round=%d sources=%d elapsed=%.1fs",
                        name,
                        round_number,
                        len(included),
                        tm.monotonic() - started,
                    )
            tool_call.result = result
            if on_tool is not None:
                await on_tool(tool_call.model_copy(deep=True), "error" if "error" in result else "completed")
            messages.extend(
                [
                    {"role": "assistant", "content": "", "tool_calls": calls},
                    {"role": "tool", "tool_call_id": call_id, "content": json.dumps(result, ensure_ascii=False)},
                ]
            )
            # Retain tool calls and their observations together when trimming history.
            _compact_messages(messages, max_chars=message_budget)
        return AgentResult(
            reply=AgentReply(
                kind="no_knowledge",
                text="Не удалось найти достаточно сведений для точного ответа. "
                "Вы можете выбрать специалиста через кнопку в чате.",
                citation_ids=[],
            ),
            sources=[],
            tool_calls=tool_calls,
        )

    async def _complete(
        self,
        messages: list[dict],
        tools: list[dict],
        *,
        on_text: TextCallback | None = None,
        on_tool: ToolCallback | None = None,
    ) -> dict | None:
        # Grammar-constrained actions avoid llama.cpp templates that allow prose
        # before a required native tool call, consuming the entire output budget.
        schema = _action_schema(tools)
        wire_messages = _action_messages(messages, tools)
        output_tokens = self.answer_max_tokens
        payload: dict = {
            "model": self.model,
            "messages": wire_messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "agent_action",
                    "strict": True,
                    "schema": schema,
                },
            },
            "temperature": self.temperature,
            "max_tokens": output_tokens,
        }
        # Qwen 3.5 (llama.cpp and mlx-vlm) thinks unless this is false. Gemma ignores it.
        payload["chat_template_kwargs"] = {"enable_thinking": self.enable_thinking}
        if self.llama_extensions:
            payload["cache_prompt"] = True
        started = tm.monotonic()
        call_id = f"action_{uuid4().hex}"
        content = await self._stream_completion(payload, on_text, on_tool=on_tool, call_id=call_id)
        if content is None:
            return None
        logger.info("Support agent model elapsed=%.1fs", tm.monotonic() - started)
        try:
            action = json.loads(content)
            if (
                set(action) != {"reason", "name", "arguments"}
                or action["name"] not in {tool["function"]["name"] for tool in tools}
                or not isinstance(action["arguments"], dict)
                or not isinstance(action.get("reason"), str)
            ):
                return None
        except ValueError, KeyError, TypeError:
            return None
        logger.info("Support agent reason=%s", action["reason"][:240])
        return {
            "content": "",
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "reason": action["reason"],
                    "function": {
                        "name": action["name"],
                        "arguments": json.dumps(action["arguments"], ensure_ascii=False),
                    },
                }
            ],
        }

    async def _stream_completion(
        self, payload: dict, on_text: TextCallback | None, *, on_tool: ToolCallback | None, call_id: str
    ) -> str | None:
        content = ""
        previous_text = ""
        preparing: ToolCall | None = None
        finish_reason = None
        async with self._client.stream(
            "POST", f"{self.base_url}/v1/chat/completions", json={**payload, "stream": True}
        ) as response:
            if response.is_error:
                # Streaming responses must be read before the handler can log their body.
                await response.aread()
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    if finish_reason not in {"stop", "tool_calls", "tool"}:
                        logger.warning("Incomplete agent completion: finish_reason=%s", finish_reason)
                        return None
                    return content
                try:
                    event = json.loads(data)
                except ValueError:
                    return None
                if not isinstance(event, dict) or "error" in event:
                    return None
                if not event.get("choices"):
                    continue
                try:
                    choice = event["choices"][0]
                    delta = choice.get("delta", {}).get("content") or ""
                    reason = choice.get("finish_reason")
                except KeyError, IndexError, TypeError, AttributeError:
                    return None
                if not isinstance(delta, str):
                    return None
                content += delta
                if reason is not None:
                    finish_reason = reason
                if on_tool is not None and delta:
                    try:
                        partial = from_json(content, allow_partial="trailing-strings")
                    except ValueError:
                        partial = None
                    if isinstance(partial, dict):
                        name = partial.get("name")
                        if not isinstance(name, str) or name not in {tool["function"]["name"] for tool in TOOLS}:
                            name = ""
                        action_reason = partial.get("reason", "")
                        if not isinstance(action_reason, str):
                            return None
                        args = partial.get("arguments", {})
                        current = ToolCall(
                            id=call_id,
                            name=name,
                            reason=action_reason,
                            arguments=args if isinstance(args, dict) else {},
                            result={},
                        )
                        if current != preparing:
                            await on_tool(current, "preparing")
                            preparing = current
                if on_text is not None and delta:
                    text = _partial_answer(content)
                    if text != previous_text:
                        await on_text(text)
                        previous_text = text
        # An EOF without the terminal event is not a completed answer.
        return None

    async def aclose(self) -> None:
        await self._client.aclose()


ASKS_TERM_RE = re.compile(
    r"(?:какой|каков|какая)\s+срок|срок\s+\S.{0,40}(?:заявк|модерац|рассмотр|регистрац)"
    r"|сколько\s+(?:рабочих\s+)?(?:дней|часов|будет\s+рассматрив|рассматрив)",
    re.IGNORECASE,
)
DURATION_RE = re.compile(
    r"\d+\s*(?:[-–—]\s*\d+\s*)?(?:раб(?:оч(?:их|ий|его|ие))?|календарн\w*)?\s*"
    r"(?:дн(?:я|ей|ень)?|час(?:а|ов)?)",
    re.IGNORECASE,
)


def _asks_for_term(text: str) -> bool:
    return bool(ASKS_TERM_RE.search(text))


def _states_duration(text: str) -> bool:
    return bool(DURATION_RE.search(text))


LOOKUP_RE = re.compile(
    r"\b(?:как|почему|зачем|где|когда|сколько)\b|что\s+(?:такое|означает|значит)",
    re.IGNORECASE,
)
VAGUE_CLARIFY_RE = re.compile(
    r"что именно|уточните|что вы (?:хотите|имели в виду|хотели)",
    re.IGNORECASE,
)


NAMED_MUTATION_RE = re.compile(
    r"(?:удал\w*|разблок\w*|смен\w*|поменя\w*).{0,40}"
    r"(?:аккаунт|компани|кабинет|контракт|поставщик|парол)|"
    r"(?:аккаунт|компани|кабинет|контракт|поставщик|парол).{0,40}"
    r"(?:удал\w*|разблок\w*)",
    re.IGNORECASE,
)
TOOL_NOISE_RE = re.compile(
    r"запрос уже выполнен|используйте найденн|измените (?:ваш )?запрос|"
    r"неверный ответ|сбой при получении|источники уже",
    re.IGNORECASE,
)


HANDBOOK_SECTION_RE = re.compile(r"^\d+(?:\.\d+)+\.?\s+[А-ЯЁA-Z]")
JUNK_OPTION_RE = re.compile(
    r"рисунок|блокок|при выборе|опци[яи]|форма\s+[«\"]|http|www\.|"
    r"кнопк|глоссар|<mark|модальн\w*\s+окн|уведомлен|схема рассмотрен|"
    r"года\s*№|меню личного|блок с полям|^блок\b|данные по заявк|"
    r"историческ|после чего",
    re.IGNORECASE,
)
HANGING_OPTION_WORDS = frozenset({"на", "по", "для", "без", "в", "с", "и", "к", "ко", "от", "из", "со", "о", "об", "про", "через"})
WEAK_OPTION_RE = re.compile(
    r"^(?:после|при|если|когда|нажм|выбер|откро|страниц|выгруз|удал|в архив)",
    re.IGNORECASE,
)
SECTION_FAMILY_RE = re.compile(r"^(\d+)(?:\.(\d+))?")
GENERIC_INTENTS = frozenset({"как пройти", "статус заявки", "ошибка"})
HELP_MENU = ClarificationQuestion(
    question="С чем помочь?",
    options=[
        "Регистрация",
        "Электронная подпись",
        "Личный кабинет",
        "Закупки",
        "Контракты",
        "Прайс-листы",
    ],
)


def help_menu_clarification() -> ClarificationQuestion:
    return HELP_MENU.model_copy()


async def _finish_clarification(
    clarification: ClarificationQuestion,
    tool_call: ToolCall,
    tool_calls: list[ToolCall],
    on_tool: ToolCallback | None,
) -> AgentResult:
    clarification.options = [option for option in clarification.options if option.casefold() != "другое"]
    tool_call.result = {"status": "awaiting_user", **clarification.model_dump(mode="json")}
    if on_tool is not None:
        await on_tool(tool_call.model_copy(deep=True), "awaiting_user")
    return AgentResult(
        reply=AgentReply(kind="clarify", text=clarification.question, citation_ids=[]),
        sources=[],
        clarification=clarification,
        tool_calls=tool_calls,
    )


def _is_generic_intent_card(options: list[str]) -> bool:
    return GENERIC_INTENTS <= {option.casefold() for option in options}


def _is_help_verb_topic(question: str) -> bool:
    stems = significant_stems(_topic_label(question))
    return bool(stems) and all(
        stem.startswith(("помог", "помож", "помощ", "подскаж")) or stem == "help" for stem in stems
    )


def _is_help_menu(clarification: ClarificationQuestion) -> bool:
    if "по теме" in clarification.question.casefold() or _is_generic_intent_card(clarification.options):
        return False
    if not _is_type_fork(clarification):
        return False
    return bool(re.search(r"чем помочь|с чем помочь|чем могу", clarification.question, re.IGNORECASE))


def _asks_personal_fact(question: str) -> bool:
    return bool(
        re.search(
            r"\bя\b.{0,60}заблок|заблок\w*.{0,40}\bя\b|"
            r"до какого (?:числа|года)|какого года",
            question,
            re.IGNORECASE,
        )
    )


_ABBREV_EXPAND = {
    "мчд": "машиночитаемая доверенность",
    "упд": "универсальный передаточный документ",
    "сте": "стандартная товарная единица",
    "эп": "электронная подпись",
    "эцп": "электронная подпись",
}


@lru_cache(maxsize=64)
def _catalog_fork_options(question: str) -> list[str]:
    qstems = set(significant_stems(question))
    lowered = question.casefold()
    for token, phrase in _ABBREV_EXPAND.items():
        if token in qstems or re.search(rf"\b{token}\b", lowered):
            qstems |= set(significant_stems(phrase))
    if not qstems:
        return []
    options: list[str] = []
    seen: set[str] = set()
    for topic in load_knowledge().topics:
        if topic.title.casefold() == "консультация":
            continue
        candidates = [topic.title]
        if topic.section:
            label = _short_option(topic.section)
            if label:
                candidates.append(label)
        for raw in candidates:
            label = raw.strip() if raw == topic.title else _short_option(raw)
            stems = set(significant_stems(label))
            if not (qstems & stems) or stems <= qstems:
                continue
            key = label.casefold()
            if key in seen or not _usable_option(label, question):
                continue
            seen.add(key)
            options.append(label)
            if len(options) == 6:
                return options
    return options if len(options) >= 2 else []


def _needs_fork(question: str) -> bool:
    """Short topic or action without an object — search, then offer a type-fork."""
    if is_open_help(question) or LOOKUP_RE.search(question) or _named_mutation(question):
        return False
    return len(significant_stems(question)) < 3


def _topic_label(question: str) -> str:
    topic = re.sub(r"[^\w\s\-]+", "", question, flags=re.UNICODE).strip() or question.strip()
    return topic[:40].rstrip()


def _short_option(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"^\d+(?:\.\d+)*\.?\s*", "", text).strip()
    text = re.sub(r"^рисунок\s+\d+\s*[–—-]\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^[–—\-•*«»\"]+\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip(" .:—-«»\"")
    words = text.split()
    while words and words[-1].casefold().strip(".,:;«»\"") in HANGING_OPTION_WORDS:
        words.pop()
    text = " ".join(words)
    if len(text) > 100:
        text = text[:100].rsplit(" ", 1)[0].strip()
        words = text.split()
        while words and words[-1].casefold().strip(".,:;«»\"") in HANGING_OPTION_WORDS:
            words.pop()
        text = " ".join(words)
    return text[:1].upper() + text[1:] if text else text


def _complete_option(label: str) -> bool:
    words = label.split()
    if not words:
        return False
    if words[-1].casefold().strip(".,:;«»\"") in HANGING_OPTION_WORDS:
        return False
    return label.count("«") == label.count("»")


def _usable_option(label: str, topic: str) -> bool:
    if len(label) < 4 or label.casefold() == topic.casefold():
        return False
    if JUNK_OPTION_RE.search(label) or WEAK_OPTION_RE.search(label) or label.endswith(("«", "»", '"', "(", "—", "№")):
        return False
    if re.search(r"\d{4}\s*года|№\s*\d", label, re.IGNORECASE):
        return False
    if not _complete_option(label):
        return False
    return bool(re.search(r"[А-Яа-яA-Za-z]{3,}", label))


def _section_family(section: str) -> str:
    match = SECTION_FAMILY_RE.match(section.strip())
    if match is None:
        return ""
    if match.group(2):
        return f"{match.group(1)}.{match.group(2)}"
    return match.group(1)


def _procedure_options(evidence: dict[str, Chunk], topic: str = "") -> list[str]:
    options: list[str] = []
    seen: set[str] = set()
    for chunk in evidence.values():
        section = chunk.section.strip()
        if not HANDBOOK_SECTION_RE.match(section):
            continue
        label = _short_option(section)
        key = label.casefold()
        if not _usable_option(label, topic) or key in seen:
            continue
        seen.add(key)
        options.append(label)
        if len(options) >= 6:
            break
    return options


def _procedure_families(evidence: dict[str, Chunk]) -> set[str]:
    return {
        family
        for chunk in evidence.values()
        if HANDBOOK_SECTION_RE.match(chunk.section.strip()) and (family := _section_family(chunk.section))
    }


NARROW_PHRASE_RE = re.compile(r"\b(?:на|по|для|про|без|через)\s+\w+", re.IGNORECASE)


def _question_selects_one(question: str, labels: list[str]) -> bool:
    """True only if the user added a qualifier that matches exactly one procedure."""
    query_stems = set(significant_stems(question))
    label_stems = [set(significant_stems(label)) for label in labels]
    if len(label_stems) < 2:
        return True
    unique = [stem for stem in query_stems if sum(stem in stems for stems in label_stems) == 1]
    if not unique:
        return False
    return bool(query_stems & ABBREVIATIONS) or bool(NARROW_PHRASE_RE.search(question))


def _needs_disambiguation(question: str, evidence: dict[str, Chunk]) -> bool:
    """Sources describe several procedures and the question does not pick one."""
    if not evidence or is_open_help(question):
        return False
    if re.search(r"что\s+такое", question, re.IGNORECASE) or _asks_for_term(question):
        return False
    labels = _procedure_options(evidence)
    if len(labels) < 2:
        return False
    families = _procedure_families(evidence)
    if len(families) < 2:
        return False
    return not _question_selects_one(question, labels)


def _facet_options(evidence: dict[str, Chunk], topic: str) -> list[str]:
    options: list[str] = []
    seen: set[str] = set()
    for chunk in evidence.values():
        if not HANDBOOK_SECTION_RE.match(chunk.section.strip()):
            continue
        label = _short_option(chunk.section)
        key = label.casefold()
        if not _usable_option(label, topic) or key in seen:
            continue
        seen.add(key)
        options.append(label)
        if len(options) >= 6:
            break
    return options


def _clarification_from_evidence(question: str, evidence: dict[str, Chunk]) -> ClarificationQuestion | None:
    if is_open_help(question) or _is_help_verb_topic(question):
        return help_menu_clarification()
    topic = _topic_label(question)
    if _needs_fork(question):
        options = _catalog_fork_options(question)
        if len(options) < 2:
            options = _procedure_options(evidence, topic)
    else:
        options = _procedure_options(evidence, topic)
        if len(options) < 2:
            options = _facet_options(evidence, topic)
        if len(options) < 2:
            options = _catalog_fork_options(question)
    if len(options) < 2:
        return None
    prompt = (
        f"Что нужно по теме «{topic}»?" if _needs_fork(question) else "Какой вариант имеется в виду?"
    )
    card = ClarificationQuestion(question=prompt, options=options)
    if not _is_type_fork(card):
        return None
    return card


def _evidence_covers(question: str, evidence: dict[str, Chunk]) -> bool:
    return any(score_chunk(question, chunk) >= 2.0 for chunk in evidence.values())


def _may_clarify(question: str, evidence: dict[str, Chunk]) -> bool:
    """Clarify when the request is short, topic-less, or sources fork."""
    if is_open_help(question):
        return True
    if not evidence:
        return False
    return _needs_fork(question) or _needs_disambiguation(question, evidence)


def _is_type_fork(clarification: ClarificationQuestion) -> bool:
    question = clarification.question.strip()
    if len(question) > 70 or not question.endswith("?") or VAGUE_CLARIFY_RE.search(question):
        return False
    if _echo_options(question, clarification.options):
        return False
    return all("?" not in option and len(option.split()) <= 10 for option in clarification.options)


def _named_mutation(question: str) -> bool:
    return bool(NAMED_MUTATION_RE.search(question))


def _is_tool_noise(text: str) -> bool:
    return bool(TOOL_NOISE_RE.search(text))


def _respond_hint(evidence: dict[str, Chunk]) -> str:
    if not evidence:
        return "Сначала search_knowledge, затем respond kind=answer с citation_ids."
    ids = ", ".join(evidence)
    return f"respond kind=answer с citation_ids=[{ids}]. Не no_knowledge — источники уже есть."


def _requests_clarification(text: str) -> bool:
    """Catch common Russian clarification requests outside Markdown blockquotes."""
    prose = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith(">"))
    if _harvests_user_value(prose):
        return False
    return bool(
        re.search(
            r"\b(?:уточните|уточни|уточнить)\b[^.!?\n]{0,100}"
            r"\b(?:что|какой|какая|какое|какую|какие|каких|где|когда|на каком|о ч[её]м|ид[её]т речь|"
            r"тип|вид|цель|роль|этап|вопрос|запрос)\b"
            r"|\b(?:расскажите|опишите)\s+(?:подробнее|ваш[уае]|сво[юёе]|проблему|ситуацию)\b"
            r"|\b(?:что именно|какую именно|какой именно|какие именно|на каком этапе)\b[^.!?\n]*\?"
            r"|\bвы\s+(?:хотите|имеете в виду|пытаетесь)\b[^.!?\n]*\?",
            prose,
            re.IGNORECASE,
        )
    )


HARVEST_RE = re.compile(
    r"(?:напишите|пришлите|предоставьте|сообщите)\s+"
    r"(?:мне\s+|сюда\s+|пожалуйста,?\s+)*(?:ваш[аеи]?\s+)?"
    r"(?:идентификатор|номер|\bid\b|логин|инн|парол)"
    r"|ваш[аеи]?\s+(?:инн|логин|парол|идентификатор)"
    r"|какой\s+именно\s+(?:контракт|договор|закупк|аккаунт|учетн|компани)"
    r"|по\s+какой\s+компани"
    r"|по\s+какому\s+типу\s+сделк"
    r"|необратим"
    r"|потер[еяи]\s+всех\s+данных"
    r"|подтвердите.{0,80}(?:удал|продолж|что\s+понимаете)"
    r"|подтвердить\s+и\s+продолжить",
    re.IGNORECASE,
)
WIZARD_OPTION_RE = re.compile(r"подтверд|отменит|продолж", re.IGNORECASE)


def _prose(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith(">"))


def _harvests_user_value(text: str) -> bool:
    """Instance data, secrets, or a fake 'confirm this action' wizard."""
    return bool(HARVEST_RE.search(_prose(text)))


def _echo_options(question: str, options: list[str]) -> bool:
    folded_question = re.sub(r"[^\w\s]+", " ", question.casefold())
    question_words = set(folded_question.split())
    # A lone topic word will appear inside normal options; that is not an echo.
    phrase = len(significant_stems(question)) >= 2
    for option in options:
        raw = option.strip()
        if raw.endswith(("?", "？")):
            return True
        folded = re.sub(r"[^\w\s]+", " ", raw.casefold())
        if folded and (folded in folded_question or (phrase and folded_question in folded)):
            return True
        words = [word for word in folded.split() if len(word) > 2]
        if phrase and len(words) >= 2 and all(word in question_words for word in words):
            return True
    return False


def _is_confirm_wizard(options: list[str]) -> bool:
    return sum(1 for option in options if WIZARD_OPTION_RE.search(option)) >= 2


def _is_form_clarification(clarification: ClarificationQuestion) -> bool:
    return (
        _echo_options(clarification.question, clarification.options)
        or _is_confirm_wizard(clarification.options)
        or any(_harvests_user_value(option) for option in clarification.options)
    )


def _partial_answer(content: str) -> str:
    """Decode only user-facing fields, never stream raw actions or tool arguments."""
    try:
        action = from_json(content, allow_partial="trailing-strings")
    except ValueError:
        return ""
    if not isinstance(action, dict) or not isinstance(action.get("arguments"), dict):
        return ""
    field = {"respond": "text", "ask_clarification": "question"}.get(action.get("name"))
    text = action["arguments"].get(field) if field is not None else None
    if not isinstance(text, str):
        return ""
    if action.get("name") == "respond" and (_requests_clarification(text) or _harvests_user_value(text)):
        return ""
    return text


REASON_SCHEMA = {"type": "string", "minLength": 1, "maxLength": 240}


def _action_schema(tools: list[dict]) -> dict:
    variants = []
    for tool in tools:
        variants.append(
            {
                "type": "object",
                "properties": {
                    "reason": REASON_SCHEMA,
                    "name": {"type": "string", "const": tool["function"]["name"]},
                    "arguments": tool["function"]["parameters"],
                },
                "required": ["reason", "name", "arguments"],
                "additionalProperties": False,
            }
        )
    return {"anyOf": variants}


def _moderation_preamble(matches: tuple[str, ...]) -> str:
    if not matches:
        return ""
    listed = ", ".join(matches[:8])
    return f"[Сигнал словаря, не вердикт: {listed}]\n"


NARRATOR_PREFIX_RE = re.compile(
    r"^\s*(?:"
    r"(?:пользователь|клиент|абонент|человек|автор)\s+"
    r"(?:спрашивает|спрашивал|хочет(?:\s+(?:узнать|спросить|уточнить|получить))?"
    r"|просит|пишет|интересуется|уточняет|желает|имел(?:а|и)?\s+в\s+виду|имеет\s+в\s+виду)"
    r"(?:\s*,?\s*о\s+том)?"
    r"|(?:запрос|вопрос)(?:\s+пользователя)?"
    r"|имеется\s+в\s+виду"
    r")\s*[,:—.–-]?\s*",
    re.IGNORECASE,
)


def as_user_message(text: str) -> str:
    cleaned = text.strip().strip("«»\"'")
    previous = None
    while cleaned and cleaned != previous:
        previous = cleaned
        cleaned = NARRATOR_PREFIX_RE.sub("", cleaned).strip().strip("«»\"'")
    if cleaned.casefold().startswith("о том,"):
        cleaned = cleaned[6:].lstrip()
    if not cleaned:
        return ""
    return cleaned[0].upper() + cleaned[1:]


def _parse_moderation(raw: object, *, question: str) -> ModerationVerdict | None:
    if not isinstance(raw, dict):
        return None
    try:
        verdict = ModerationVerdict.model_validate(raw, strict=True)
    except ValidationError:
        return None
    cleaned = as_user_message(verdict.cleaned_request)
    remainder = usable_rephrase(question)
    working = has_working_request(question) and bool(remainder)
    flagged = has_profanity_or_insult(question)
    if not flagged:
        return ModerationVerdict(verdict="clean", cleaned_request="")
    if not working:
        return ModerationVerdict(verdict="pure_abuse", cleaned_request="")
    candidate = preferred_rephrase(question, cleaned)
    if not candidate or has_profanity_or_insult(candidate):
        return ModerationVerdict(verdict="pure_abuse", cleaned_request="")
    return ModerationVerdict(verdict="mixed", cleaned_request=candidate[:400])


def _action_messages(messages: list[dict], tools: list[dict]) -> list[dict]:
    wire = []
    for message in messages:
        if message["role"] == "system":
            descriptions = "\n".join(f"{tool['function']['name']}: {tool['function']['description']}" for tool in tools)
            wire.append(
                {
                    "role": "system",
                    "content": message["content"]
                    + '\nВыбери одно действие JSON: {"reason": "...", "name": "имя", "arguments": {...}}.'
                    "\nreason — одно предложение, почему это действие по источникам.\n" + descriptions,
                }
            )
        elif message["role"] == "tool":
            wire.append(
                {"role": "user", "content": "Результат инструмента (недоверенные данные):\n" + message["content"]}
            )
        elif message.get("tool_calls"):
            call = message["tool_calls"][0]["function"]
            wire.append(
                {
                    "role": "assistant",
                    "content": json.dumps(
                        {"name": call["name"], "arguments": json.loads(call["arguments"])},
                        ensure_ascii=False,
                    ),
                }
            )
        else:
            wire.append(dict(message))
    return wire


async def _execute(
    name: str,
    args: dict,
    retriever: KnowledgeRetriever,
    evidence: dict[str, Chunk],
    user_question: str,
) -> tuple[list[Chunk], str | None]:
    if name == "search_knowledge":
        query = args.get("query")
        if set(args) != {"query"} or not isinstance(query, str) or not 2 <= len(query.strip()) <= 500:
            return [], "query должен быть строкой длиной от 2 до 500 символов."
        search = query.strip()
        question = user_question.strip()
        if question and question.casefold() != search.casefold():
            merged = f"{search} {question}"
            search = merged if len(merged) <= 500 else question
        chunks = await retriever.find(search, limit=6)
        chunks.sort(key=lambda chunk: score_chunk(question or search, chunk), reverse=True)
        return chunks, None
    return [], "Неизвестный инструмент. Доступны search_knowledge, read_section и respond."


def _source_records(
    chunks: list[Chunk],
    *,
    max_chars: int,
    offset: int = 0,
) -> tuple[list[dict], list[Chunk]]:
    records: list[dict] = []
    included: list[Chunk] = []
    used = 0
    for index, chunk in enumerate(chunks):
        start = offset if index == 0 else 0
        text = clean_source_text(chunk.text)[start:]
        record = {"id": chunk.id, "section": chunk.section[:120], "text": ""}
        available = max_chars - used - len(json.dumps(record, ensure_ascii=False)) - 100
        if available < 100:
            break
        excerpt = text[:available]
        truncated = len(excerpt) < len(text)
        if truncated and " " in excerpt:
            excerpt = excerpt.rsplit(" ", 1)[0]
        record.update(text=excerpt, truncated=truncated)
        if truncated:
            record["next_offset"] = start + len(excerpt)
        records.append(record)
        included.append(chunk)
        used += len(json.dumps(record, ensure_ascii=False))
        if truncated:
            break
    return records, included


def _compact_messages(messages: list[dict], *, max_chars: int) -> None:
    # Preserve system, current user request and at least the latest tool exchange.
    while sum(len(json.dumps(item, ensure_ascii=False)) for item in messages) > max_chars and len(messages) > 4:
        if (
            messages[1].get("role") == "user"
            and messages[2].get("role") == "assistant"
            and "tool_calls" not in messages[2]
        ):
            del messages[1:3]
        elif messages[1].get("role") != "user":
            del messages[1]
        elif len(messages) > 4 and "tool_calls" in messages[2]:
            del messages[2:4]
        else:
            break


def _parse_reply(raw: dict, evidence: dict[str, Chunk]) -> AgentReply | None:
    ids = raw.get("citation_ids", raw.get("citations"))
    if isinstance(ids, str):
        ids = [ids] if ids.strip() else []
    elif isinstance(ids, list):
        ids = [str(item).strip() for item in ids if str(item).strip()]
    else:
        ids = []
    payload = {"kind": raw.get("kind"), "text": raw.get("text"), "citation_ids": ids}
    try:
        reply = RespondReply.model_validate(payload, strict=True)
    except ValidationError:
        return None
    reply.text = reply.text.strip()
    if not reply.text or reply.text.endswith(":"):
        return None
    reply.citation_ids = list(dict.fromkeys(item for item in reply.citation_ids if item in evidence))
    if reply.kind in {"conversation", "no_knowledge"} and reply.citation_ids:
        reply = RespondReply(kind="answer", text=reply.text, citation_ids=reply.citation_ids)
    if reply.kind == "answer" and not reply.citation_ids:
        return None
    if reply.kind != "answer" and reply.citation_ids:
        return None
    return reply
