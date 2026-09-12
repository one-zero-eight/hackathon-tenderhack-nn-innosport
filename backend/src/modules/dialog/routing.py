from __future__ import annotations

import re

from src.modules.dialog.normalize import normalize_text

L2_PHRASES = (
    "уже не помогло",
    "так и не помогло",
    "не помогло",
    "все равно не работает",
    "всё равно не работает",
    "по прежнему не",
    "по-прежнему",
    "не сработало",
    "это исключение",
    "особый случай",
    "индивидуальн",
    "персональн",
)

L2_INCIDENT = (
    "инцидент",
    "авария",
    "аварийн",
    "массовый сбой",
    "когда почините",
    "почините",
    "упал портал",
    "портал недоступен",
    "система лежит",
)

NUMBERED_ENTITY_RE = re.compile(
    r"(?:закупк[аиеу]|извещен\w*|договор\w*|контракт\w*|лот\w*)\s*(?:№|n|number)?\s*[:№]?\s*\d{5,}",
    re.IGNORECASE,
)
INN_RE = re.compile(r"\bинн\s*:?\s*\d{10,12}\b", re.IGNORECASE)
LONG_ID_RE = re.compile(r"\b\d{8,}\b")
ENTITY_HINT_RE = re.compile(r"\b(закупк|договор|контракт|извещен)", re.IGNORECASE)


def is_l2_request(text: str) -> bool:
    normalized = normalize_text(text)
    if any(phrase in normalized for phrase in L2_PHRASES):
        return True
    if any(phrase in normalized for phrase in L2_INCIDENT):
        return True
    if NUMBERED_ENTITY_RE.search(text) or INN_RE.search(text):
        return True
    return bool(ENTITY_HINT_RE.search(text) and LONG_ID_RE.search(text))
