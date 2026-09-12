import re
import unicodedata

LATIN_TO_CYRILLIC = str.maketrans(
    {
        "a": "а",
        "@": "а",
        "e": "е",
        "o": "о",
        "p": "р",
        "c": "с",
        "x": "х",
        "y": "у",
        "k": "к",
        "h": "н",
        "m": "м",
        "t": "т",
        "b": "в",
        "n": "п",
    }
)

TOKEN_RE = re.compile(r"[а-яa-z0-9]+", re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
HYPHEN_BREAK_RE = re.compile(r"(\w)-\n(\w)")

RU_SUFFIXES = (
    "ами",
    "ями",
    "ого",
    "ему",
    "ому",
    "ыми",
    "ими",
    "ая",
    "яя",
    "ое",
    "ее",
    "ые",
    "ие",
    "ых",
    "их",
    "ов",
    "ев",
    "ей",
    "ий",
    "ый",
    "ой",
    "ом",
    "ем",
    "ах",
    "ях",
    "ам",
    "ям",
    "ую",
    "юю",
    "ию",
    "ью",
    "ть",
    "ти",
    "ла",
    "ло",
    "ли",
    "а",
    "я",
    "у",
    "ю",
    "е",
    "о",
    "и",
    "ы",
    "ь",
)

STOPWORDS = frozenset(
    {
        "и",
        "в",
        "во",
        "на",
        "с",
        "со",
        "по",
        "для",
        "не",
        "ни",
        "но",
        "что",
        "как",
        "это",
        "или",
        "а",
        "от",
        "до",
        "из",
        "к",
        "ко",
        "о",
        "об",
        "обо",
        "при",
        "же",
        "бы",
        "то",
        "за",
        "у",
        "я",
        "мы",
        "вы",
        "они",
        "он",
        "она",
        "оно",
        "мне",
        "меня",
        "нас",
        "вас",
        "их",
        "его",
        "ее",
        "быть",
        "есть",
        "был",
        "была",
        "были",
        "будет",
        "можно",
        "нужно",
        "надо",
        "также",
        "если",
        "чем",
        "так",
        "уже",
        "еще",
        "ещё",
        "ли",
        "да",
        "нет",
        "этот",
        "эта",
        "эти",
        "тот",
        "та",
        "те",
        "мой",
        "моя",
        "мои",
        "ваш",
        "ваша",
        "наши",
        "очень",
        "просто",
        "подскажите",
        "скажите",
        "пожалуйста",
        "здравствуйте",
        "добрый",
        "день",
        "вопрос",
        "проблема",
        "почему",
        "когда",
        "где",
        "какой",
        "какая",
        "какие",
        "который",
        "через",
        "после",
        "перед",
        "между",
        "только",
        "там",
        "тут",
        "здесь",
        "все",
        "всё",
        "всех",
        "всего",
        "приложения",
        "рисунок",
        "таблица",
        "стр",
    }
)


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def normalize_text(text: str, *, map_latin: bool = False) -> str:
    text = nfc(text).lower().replace("ё", "е")
    if map_latin:
        text = text.translate(LATIN_TO_CYRILLIC)
    return WHITESPACE_RE.sub(" ", text).strip()


def collapse_pdf_text(text: str) -> str:
    text = nfc(text)
    text = HYPHEN_BREAK_RE.sub(r"\1\2", text)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[·•]+", " ", text)
    text = re.sub(r"\.{4,}", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def tokenize(text: str, *, map_latin: bool = False) -> list[str]:
    return TOKEN_RE.findall(normalize_text(text, map_latin=map_latin))


PREFIXES_FOR_ROOT = (
    "за",
    "про",
    "под",
    "пере",
    "вы",
)


def stem_ru(token: str) -> str:
    token = token.lower().replace("ё", "е")
    if len(token) <= 4:
        return token
    for suffix in RU_SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def root_ru(token: str) -> str:
    stemmed = stem_ru(token)
    for prefix in PREFIXES_FOR_ROOT:
        if stemmed.startswith(prefix) and len(stemmed) - len(prefix) >= 5:
            stemmed = stemmed[len(prefix) :]
            break
    return stemmed[:6] if len(stemmed) >= 6 else stemmed


def significant_stems(text: str) -> list[str]:
    stems: list[str] = []
    for token in tokenize(text):
        if token.isdigit() or token in STOPWORDS:
            continue
        stems.append(stem_ru(token))
    return stems


ABBREVIATIONS = frozenset(
    {
        "эп",
        "эцп",
        "сте",
        "yml",
        "упд",
        "укд",
        "еис",
        "эдо",
        "мчд",
        "рнп",
        "кс",
        "лк",
        "рис",
        "уо",
    }
)


def significant_roots(text: str) -> set[str]:
    roots: set[str] = set()
    for token in tokenize(text):
        if token in STOPWORDS or token.isdigit():
            continue
        if token in ABBREVIATIONS:
            roots.add(token)
        elif len(token) >= 4:
            roots.add(root_ru(token))
    return roots


def unique_stems(text: str) -> set[str]:
    return set(significant_stems(text))
