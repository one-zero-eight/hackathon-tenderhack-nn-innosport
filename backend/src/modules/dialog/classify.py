import re

from src.modules.dialog.normalize import tokenize

CAPABILITY_PATTERNS = (
    re.compile(r"\b(?:что|чем)\s+(?:ты|вы)?\s*(?:можешь|можете)\s+(?:мне\s+|нам\s+)?помочь\b"),
    re.compile(r"\b(?:что|чем)\s+(?:ты|вы)?\s*(?:умеешь|умеете)\b"),
    re.compile(r"\b(?:какие|с какими)\s+(?:вопросы|вопросами|темы|темами)\b"),
    re.compile(r"\bкак(?:ую|ие)\s+помощь\s+(?:ты|вы)?\s*(?:можешь|можете)\b"),
    re.compile(r"\bwhat\s+can\s+you\s+(?:do|help)\b"),
)

GREETING_TOKENS = frozenset(
    {
        "hi",
        "hello",
        "привет",
        "здравствуй",
        "здравствуйте",
        "добрый",
        "день",
        "вечер",
        "утро",
        "салам",
    }
)


def is_capability_question(text: str) -> bool:
    normalized = " ".join(tokenize(text))
    return any(pattern.search(normalized) for pattern in CAPABILITY_PATTERNS)


def is_thanks(text: str) -> bool:
    normalized = " ".join(tokenize(text))
    return bool(
        re.fullmatch(
            r"(?:(?:большое|огромное) )?(?:спасибо|благодарю)(?: (?:вам|большое|все понятно|понятно|помогло))?",
            normalized,
        )
    )


def is_greeting(text: str) -> bool:
    tokens = tokenize(text)
    return bool(tokens) and len(tokens) <= 3 and all(token in GREETING_TOKENS for token in tokens)


UI_DEFECT_RE = re.compile(
    r"нет\s+кнопк|кнопк\w*.{0,80}нет|пропал\w*\s+кнопк|страниц\w*\s+пад|форма\s+пад|"
    r"исправьте\s+форм",
    re.IGNORECASE | re.DOTALL,
)


def reports_ui_defect(text: str) -> bool:
    return bool(UI_DEFECT_RE.search(text))
