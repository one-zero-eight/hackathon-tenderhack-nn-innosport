import json
import re
from typing import Protocol

import httpx

from src.logging_ import logger
from src.modules.dialog.models import Chunk
from src.modules.dialog.normalize import normalize_text
from src.pydantic_base import BaseSchema

NUMBER_RE = re.compile(r"\d{2,}")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s)\]}]+", re.IGNORECASE)
ANSWER_PART_RE = re.compile(r"[^.!?\n]+[.!?]?")


class GroundedAnswer(BaseSchema):
    text: str
    citation_ids: list[str]


class AnswerGenerator(Protocol):
    async def generate_answer(
        self,
        question: str,
        history: list[tuple[str, str]],
        chunks: list[Chunk],
    ) -> GroundedAnswer | None: ...


class DialogLlamaClient(AnswerGenerator, Protocol):
    async def aclose(self) -> None: ...


class NullLlamaClient:
    async def generate_answer(
        self,
        question: str,
        history: list[tuple[str, str]],
        chunks: list[Chunk],
    ) -> GroundedAnswer | None:
        return None

    async def aclose(self) -> None:
        return None


class LlamaCppClient:
    """Local llama.cpp client with validated grounded-answer output."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str = "",
        timeout_seconds: float = 8.0,
        answer_max_tokens: int = 192,
        temperature: float = 0.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.answer_max_tokens = answer_max_tokens
        self.temperature = temperature
        self._client = httpx.AsyncClient(timeout=self.timeout_seconds)

    async def generate_answer(
        self,
        question: str,
        history: list[tuple[str, str]],
        chunks: list[Chunk],
    ) -> GroundedAnswer | None:
        if not chunks:
            return None
        history_text = _compact_history(history, limit=4)
        sources = "\n".join(f"[{chunk.id}] {chunk.text[:700]}" for chunk in chunks[:3])
        prompt = (
            "Ответь только по источникам, дословными предложениями. "
            "Для общего вопроса дай несколько разных релевантных фактов без повторов. "
            'JSON: {"can_answer":true,"answer":"...","citation_ids":["id"]}.\n'
            f"{history_text}\n"
            f"Вопрос: {question}\n"
            f"{sources}"
        )
        content = await self._complete(
            [
                {
                    "role": "system",
                    "content": "Оператор базы знаний. Только JSON по источникам, без выдумок.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=min(self.answer_max_tokens, 192),
        )
        if content is None:
            return None
        return _parse_grounded_answer(content, chunks)

    async def _complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
    ) -> str | None:
        payload: dict[str, object] = {
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        if self.model:
            payload["model"] = self.model
        url = f"{self.base_url}/v1/chat/completions"
        try:
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError, OSError, TimeoutError, json.JSONDecodeError:
            logger.warning("llama.cpp request failed; using deterministic fallback", exc_info=True)
            return None
        try:
            content = data["choices"][0]["message"]["content"]
        except KeyError, IndexError, TypeError:
            return None
        return content if isinstance(content, str) else None

    async def aclose(self) -> None:
        await self._client.aclose()


def _compact_history(history: list[tuple[str, str]] | None, *, limit: int) -> str:
    if not history:
        return ""
    lines: list[str] = []
    for role, content in history[-limit:]:
        compact = " ".join(content.split())
        if len(compact) > 280:
            compact = compact[:277] + "..."
        lines.append(f"{role}: {compact}")
    return "\n".join(lines)


def _json_object(content: str) -> dict[str, object] | None:
    match = re.search(r"\{.*\}", content, flags=re.DOTALL)
    raw = match.group(0) if match else content.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_grounded_answer(content: str, chunks: list[Chunk]) -> GroundedAnswer | None:
    parsed = _json_object(content)
    if parsed is None or parsed.get("can_answer") is not True:
        return None
    answer = parsed.get("answer")
    raw_ids = parsed.get("citation_ids")
    if not isinstance(answer, str) or len(answer.strip()) < 10 or not isinstance(raw_ids, list):
        return None
    allowed = {chunk.id: chunk for chunk in chunks}
    citation_ids = list(dict.fromkeys(item for item in raw_ids if isinstance(item, str) and item in allowed))
    if not citation_ids:
        return None
    evidence = " ".join(allowed[item].text for item in citation_ids)
    if not _is_grounded(answer, evidence):
        logger.warning("Rejected an ungrounded llama.cpp answer")
        return None
    return GroundedAnswer(text=answer.strip(), citation_ids=citation_ids)


def _is_grounded(answer: str, evidence: str) -> bool:
    evidence_numbers = set(NUMBER_RE.findall(evidence))
    if any(number not in evidence_numbers for number in NUMBER_RE.findall(answer)):
        return False
    evidence_urls = {item.rstrip(".,;").lower() for item in URL_RE.findall(evidence)}
    if any(item.rstrip(".,;").lower() not in evidence_urls for item in URL_RE.findall(answer)):
        return False
    evidence_text = normalize_text(evidence)
    answer_parts = [normalize_text(item) for item in ANSWER_PART_RE.findall(answer)]
    answer_parts = [item for item in answer_parts if item]
    if not answer_parts:
        return False
    return all(part in evidence_text for part in answer_parts)
