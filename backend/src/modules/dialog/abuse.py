import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from src.modules.dialog.normalize import STOPWORDS, stem_ru, tokenize

LEXICON_PATH = Path(__file__).resolve().parents[3] / "data" / "abuse" / "ru_profane_words.txt"

PREFIXES = (
    "на",
    "по",
    "за",
    "про",
    "вы",
    "от",
    "у",
    "при",
    "пере",
    "до",
    "с",
    "со",
    "из",
    "ис",
    "об",
    "раз",
    "рас",
    "под",
    "над",
    "в",
    "во",
    "ни",
)

MIN_STEM_LEN = 4

# Direct insults the djantimat file omits. Used to keep a working request, not to close.
INSULTS = frozenset(
    {
        "идиот",
        "идиоты",
        "идиотка",
        "дурак",
        "дура",
        "дураки",
        "дебил",
        "дебилы",
        "тупой",
        "тупая",
        "тупые",
        "тупица",
        "кретин",
        "кретины",
        "мудак",
        "мудаки",
        "козел",
        "козлы",
        "урод",
        "уроды",
        "подонок",
        "чмо",
        "еблан",
        "ебланы",
        "пидор",
        "пидоры",
        "пидарас",
        "пидорас",
        "гнойный",
        "гнойная",
        "гнойные",
        "гнида",
        "гниды",
        "мразь",
        "мрази",
        "тварь",
        "твари",
        "долбоеб",
        "долбоебы",
    }
)
INSULT_STEMS = frozenset(stem_ru(item) for item in INSULTS if len(stem_ru(item)) >= MIN_STEM_LEN)

# Unambiguous obscene cores so inflections like «еблане» match «ебло»/«ебать».
PROFANE_ROOTS = frozenset(
    {
        "еба",
        "ебе",
        "ебл",
        "ебу",
        "еби",
        "хуй",
        "хуя",
        "хуе",
        "пизд",
        "пидор",
        "пидар",
        "бляд",
        "блят",
        "муда",
        "заеб",
        "хер",
        "гнойн",
        "гнид",
        "мраз",
        "твар",
    }
)
SWEAR_IDIOM_RE = re.compile(
    r"\bкакого\s+(?:хера|хуя|хрена|черта|беса)\b|"
    r"\bни\s+(?:хера|хуя|черта)\b|"
    r"\bчто\s+за\s+(?:хер|хуйня|хрень)\b",
    re.IGNORECASE,
)
REPEAT_RE = re.compile(r"(.)\1+")
ADDRESS_PREFIX = frozenset({"ты", "вы", "тебя", "тебе", "тобой", "твой", "твоя", "твое", "ваш", "ваша", "ваше"})


@dataclass(frozen=True, slots=True)
class AbuseScan:
    matched_terms: tuple[str, ...]

    @property
    def has_matches(self) -> bool:
        return bool(self.matched_terms)


@lru_cache(maxsize=1)
def load_lexicon(path: Path | None = None) -> tuple[frozenset[str], frozenset[str]]:
    lexicon_file = path or LEXICON_PATH
    words: set[str] = set()
    for raw in lexicon_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        word = line.lower().replace("ё", "е")
        if len(word) >= 2:
            words.add(word)
    stems = {stem_ru(word) for word in words if len(stem_ru(word)) >= MIN_STEM_LEN}
    return frozenset(words), frozenset(stems)


def _stem_hits(token_stem: str, stems: frozenset[str]) -> bool:
    if len(token_stem) < MIN_STEM_LEN:
        return False
    # Shared prefixes are not word matches: «минуту» must not match «мину».
    return token_stem in stems


def _fold_token(token: str) -> str:
    # «пидараас» / «ебееть» collapse to a matchable slur form.
    return REPEAT_RE.sub(r"\1", token.lower().replace("ё", "е"))


def _match_forms(token: str) -> tuple[str, ...]:
    folded = _fold_token(token)
    return tuple(dict.fromkeys((token, folded, stem_ru(token), stem_ru(folded))))


def _has_profane_root(token: str) -> bool:
    return any(form.startswith(root) for form in _match_forms(token) for root in PROFANE_ROOTS if len(form) >= len(root))


def _is_flagged_token(token: str, words: frozenset[str], stems: frozenset[str]) -> bool:
    forms = _match_forms(token)
    if any(form in INSULTS or stem_ru(form) in INSULT_STEMS for form in forms) or _has_profane_root(token):
        return True
    if any(form in words or _stem_hits(stem_ru(form), stems) for form in forms):
        return True
    for form in forms:
        for prefix in PREFIXES:
            if form.startswith(prefix):
                rest = form[len(prefix) :]
                if len(rest) >= 3 and rest in words:
                    return True
    return False


def working_remainder(text: str, *, lexicon_path: Path | None = None) -> str:
    words, stems = load_lexicon(lexicon_path)
    text = SWEAR_IDIOM_RE.sub(" ", text)
    kept = [token for token in tokenize(text, map_latin=True) if not _is_flagged_token(token, words, stems)]
    while kept and kept[0] in ADDRESS_PREFIX:
        kept = kept[1:]
    if not kept:
        return ""
    joined = " ".join(kept)
    return joined[0].upper() + joined[1:]


def has_working_request(text: str, *, lexicon_path: Path | None = None) -> bool:
    remainder = working_remainder(text, lexicon_path=lexicon_path)
    return any(token not in STOPWORDS and len(token) >= 2 for token in tokenize(remainder, map_latin=True))


def has_profanity_or_insult(text: str, *, lexicon_path: Path | None = None) -> bool:
    words, stems = load_lexicon(lexicon_path)
    return any(_is_flagged_token(token, words, stems) for token in tokenize(text, map_latin=True))


def usable_rephrase(text: str, *, lexicon_path: Path | None = None) -> str:
    remainder = working_remainder(text, lexicon_path=lexicon_path)
    if not remainder or has_profanity_or_insult(remainder, lexicon_path=lexicon_path):
        return ""
    return remainder


def preferred_rephrase(question: str, model_text: str = "", *, lexicon_path: Path | None = None) -> str:
    """Dictionary remainder is the rewrite. Keep a model phrasing only if it is a subset."""
    remainder = usable_rephrase(question, lexicon_path=lexicon_path)
    model = model_text.strip()
    if model and has_profanity_or_insult(model, lexicon_path=lexicon_path):
        model = ""
    if remainder and model:
        rem = set(tokenize(remainder, map_latin=True))
        extra = set(tokenize(model, map_latin=True)) - rem
        if extra:
            return remainder
        return model[0].upper() + model[1:]
    return remainder or model


def scan_abuse(text: str, *, lexicon_path: Path | None = None) -> AbuseScan:
    words, stems = load_lexicon(lexicon_path)
    matched: list[str] = []
    seen: set[str] = set()
    for token in tokenize(text, map_latin=True):
        if len(token) < 3 or not _is_flagged_token(token, words, stems) or token in seen:
            continue
        seen.add(token)
        matched.append(token)
    return AbuseScan(matched_terms=tuple(matched))


def is_abuse(text: str, *, lexicon_path: Path | None = None) -> bool:
    return scan_abuse(text, lexicon_path=lexicon_path).has_matches
