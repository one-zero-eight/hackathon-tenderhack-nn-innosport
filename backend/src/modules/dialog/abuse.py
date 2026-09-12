from functools import lru_cache
from pathlib import Path

from src.modules.dialog.normalize import stem_ru, tokenize

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
    if token_stem in stems:
        return True
    for stem in stems:
        longer, shorter = (stem, token_stem) if len(stem) >= len(token_stem) else (token_stem, stem)
        if longer.startswith(shorter) and len(longer) - len(shorter) <= 2:
            return True
    return False


def is_abuse(text: str, *, lexicon_path: Path | None = None) -> bool:
    words, stems = load_lexicon(lexicon_path)
    for token in tokenize(text, map_latin=True):
        if len(token) < 3:
            continue
        if token in words or _stem_hits(stem_ru(token), stems):
            return True
        for prefix in PREFIXES:
            if not token.startswith(prefix):
                continue
            rest = token[len(prefix) :]
            if len(rest) >= 3 and rest in words:
                return True
    return False
