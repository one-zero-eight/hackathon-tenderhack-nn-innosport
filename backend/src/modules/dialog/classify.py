import re

from src.modules.dialog.models import KnowledgeBase, Topic
from src.modules.dialog.normalize import significant_roots, significant_stems, stem_ru, tokenize
from src.pydantic_base import BaseSchema

CLEAR_SCORE = 7.5
MARGIN = 1.8
MIN_OPTION_SCORE = 1.0


class TopicScore(BaseSchema):
    topic: Topic
    score: float


GENERIC_KEYS = frozenset(
    {
        "портал",
        "поставщик",
        "поставщика",
        "поставщиков",
        "заказчик",
        "компания",
        "заявка",
        "ошибка",
        "данные",
        "профиль",
        "пользователь",
        "кабинет",
        "работа",
        "вопрос",
        "система",
        "документ",
        "личный",
    }
)


def _phrase_present(tokens: list[str], phrase: str) -> bool:
    parts = tokenize(phrase)
    if not parts:
        return False
    size = len(parts)
    for index in range(len(tokens) - size + 1):
        if tokens[index : index + size] == parts:
            return True
    return False


def score_topic(text: str, topic: Topic) -> float:
    tokens = tokenize(text)
    normalized = " ".join(tokens)
    query_stems = set(significant_stems(text))
    score = 0.0
    title = topic.title.lower().replace("ё", "е")
    parent = topic.parent_title.lower().replace("ё", "е")
    if title and title in normalized:
        score += 12.0
    if parent and parent in normalized:
        score += 3.0
    title_stems = set(significant_stems(topic.title))
    parent_stems = set(significant_stems(topic.parent_title))
    query_roots = significant_roots(text)
    title_roots = significant_roots(topic.title)
    if title_stems and title_stems <= query_stems:
        score += 8.0
    if title_roots and title_roots <= query_roots:
        score += 6.0
    score += 2.4 * len(title_stems & query_stems)
    score += 2.8 * len(title_roots & query_roots)
    score += 0.4 * len(parent_stems & query_stems)
    for key in topic.keys:
        key_norm = key.lower().replace("ё", "е")
        if key_norm in GENERIC_KEYS or len(key_norm) < 4:
            continue
        if _phrase_present(tokens, key):
            score += 3.2 if " " in key_norm or len(key_norm) >= 6 else 1.8
            if len(key_norm) >= 10:
                score += 4.0
        key_stems = set(significant_stems(key)) - {stem_ru(item) for item in GENERIC_KEYS}
        if key_stems and key_stems <= query_stems:
            score += 1.2
    query_tokens = set(tokens)
    keys_joined = " ".join(topic.keys).lower()
    for token in query_tokens:
        if token in {"эп", "эцп", "сте", "yml", "упд", "еис", "мчд", "рнп"} and token in keys_joined:
            score += 2.5
    return score


def rank_topics(text: str, knowledge: KnowledgeBase) -> list[TopicScore]:
    ranked = [TopicScore(topic=topic, score=score_topic(text, topic)) for topic in knowledge.topics]
    ranked.sort(key=lambda item: item.score, reverse=True)
    return ranked


def _title_fit(text: str, topic: Topic) -> tuple[float, int]:
    title_roots = significant_roots(topic.title)
    if not title_roots:
        return (0.0, 0)
    overlap = len(title_roots & significant_roots(text))
    return (overlap / len(title_roots), overlap)


def lock_topic(ranked: list[TopicScore], text: str) -> Topic | None:
    if not ranked or ranked[0].score < CLEAR_SCORE:
        return None
    contenders = [item for item in ranked if item.score >= ranked[0].score - MARGIN and item.score >= CLEAR_SCORE]
    if len(contenders) == 1:
        return contenders[0].topic
    scored = [(item, _title_fit(text, item.topic)) for item in contenders]
    best_fit = max(item[1] for item in scored)
    winners = [item[0] for item in scored if item[1] == best_fit and item[1][0] > 0]
    if len(winners) == 1:
        return winners[0].topic
    return None


def clarification_options(ranked: list[TopicScore], knowledge: KnowledgeBase, limit: int = 4) -> list[Topic]:
    picked: list[Topic] = []
    seen_parents: set[str] = set()
    for item in ranked:
        if item.score < MIN_OPTION_SCORE:
            break
        if item.topic.parent_title in seen_parents and len(picked) >= 2:
            continue
        picked.append(item.topic)
        seen_parents.add(item.topic.parent_title)
        if len(picked) >= limit:
            return picked
    if picked:
        return picked
    # Diverse catalog fallback: first subtopic of several parents.
    fallback: list[Topic] = []
    parents: set[str] = set()
    for topic in knowledge.topics:
        if topic.parent_title in parents:
            continue
        fallback.append(topic)
        parents.add(topic.parent_title)
        if len(fallback) >= limit:
            break
    return fallback


OPTION_INDEX_RE = re.compile(r"^\s*(?:вариант\s*)?(\d{1,2})\s*[.)]?\s*$", re.IGNORECASE)


def match_pending_option(text: str, pending: list[Topic]) -> Topic | None:
    stripped = text.strip()
    index_match = OPTION_INDEX_RE.fullmatch(stripped)
    if index_match:
        index = int(index_match.group(1)) - 1
        if 0 <= index < len(pending):
            return pending[index]
    normalized = " ".join(tokenize(text))
    for topic in pending:
        title = topic.title.lower().replace("ё", "е")
        if title and title in normalized:
            return topic
        if topic.id.lower() in normalized:
            return topic
    return None
