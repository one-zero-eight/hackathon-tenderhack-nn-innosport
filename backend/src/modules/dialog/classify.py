import re

from src.modules.dialog.normalize import significant_stems, tokenize

CAPABILITY_PATTERNS = (
    re.compile(r"\b(?:что|чем)\s+(?:ты|вы)?\s*(?:можешь|можете)\s+(?:мне\s+|нам\s+)?помочь\b"),
    re.compile(r"\b(?:что|чем)\s+(?:ты|вы)?\s*(?:умеешь|умеете)\b"),
    re.compile(r"\b(?:какие|с какими)\s+(?:вопросы|вопросами|темы|темами)\b"),
    re.compile(r"\bкак(?:ую|ие)\s+помощь\s+(?:ты|вы)?\s*(?:можешь|можете)\b"),
    re.compile(r"\bwhat\s+can\s+you\s+(?:do|help)\b"),
)
OPEN_HELP_RE = re.compile(r"\b(?:помо[гж]\w*|help|помощ\w*|подскаж\w*)\b", re.IGNORECASE)
HELP_FILLER_RE = re.compile(
    r"\b(?:шо|що|ну|чё|че|что|ты|вы|мне|нас|пожалуйста|"
    r"помо[гж]\w*|help|нужн\w*|помощ\w*|подскаж\w*|"
    r"можешь|можете|сможешь|сможете|хочу|хотел\w*|давай|сюда)\b",
    re.IGNORECASE,
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


SMALLTALK_RE = re.compile(
    r"^(?:ну )?(?:как дела|как жизнь|как ты|как вы)(?: там)?$",
)


def is_smalltalk(text: str) -> bool:
    return bool(SMALLTALK_RE.fullmatch(" ".join(tokenize(text))))


UI_DEFECT_RE = re.compile(
    r"нет\s+кнопк|кнопк\w*.{0,80}нет|пропал\w*\s+кнопк|кнопк\w*.{0,80}пропал|"
    r"страниц\w*\s+пад|форма\s+пад|исправьте\s+форм",
    re.IGNORECASE | re.DOTALL,
)


def reports_ui_defect(text: str) -> bool:
    return bool(UI_DEFECT_RE.search(text))


LOOKUP_OPERATOR_RE = re.compile(
    r"\b(?:как|почему|зачем|где)\b|что\s+(?:такое|указать|писать|делать|нужно)",
    re.IGNORECASE,
)
OPERATOR_ASK_RE = re.compile(
    r"прошу\s+(?:решить|разобрать|вмешаться|принять|согласовать)|"
    r"решите\s+(?:данный\s+)?вопрос|разберитесь",
    re.IGNORECASE,
)
OPERATOR_STUCK_RE = re.compile(
    r"модератор|не\s+согласу|на\s+доработ|возвраща\w+\s+(?:ее|её|заявк)|все\s+никак\s+не",
    re.IGNORECASE,
)


def needs_operator(text: str) -> bool:
    """Moderator dispute / «прошу решить» — not a handbook how-to."""
    text = re.sub(r"\bни\s+как\b", "никак", text, flags=re.IGNORECASE)
    if LOOKUP_OPERATOR_RE.search(text):
        return False
    return bool(OPERATOR_ASK_RE.search(text) and OPERATOR_STUCK_RE.search(text))


def _is_help_stem(stem: str) -> bool:
    return stem.startswith(("помог", "помож", "помощ", "подскаж")) or stem == "help"


def is_open_help(text: str) -> bool:
    """«Помоги», «поможешь», «шо ты помоги мне» — no portal topic to search."""
    if reports_ui_defect(text):
        return False
    if is_capability_question(text):
        return True
    stems = significant_stems(text)
    if stems and all(_is_help_stem(stem) for stem in stems):
        return True
    if not OPEN_HELP_RE.search(text):
        return False
    leftover = HELP_FILLER_RE.sub(" ", text)
    leftover = re.sub(r"[^\w\s]+", " ", leftover, flags=re.UNICODE)
    leftover_stems = significant_stems(leftover)
    return not leftover_stems or all(_is_help_stem(stem) for stem in leftover_stems)
