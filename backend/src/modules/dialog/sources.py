import json
import re
from collections import Counter, defaultdict
from functools import cache, lru_cache
from html import unescape
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlsplit


def document_key(name: str) -> str:
    filename = PurePosixPath(unquote(urlsplit(name).path)).name
    return filename.casefold().removesuffix(".pdf").replace("_", " ").strip()


def pdf_words(text: str) -> str:
    text = unescape(text).casefold().replace("ё", "е").replace("\u00ad", "")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    return " ".join(re.findall(r"[а-яa-z0-9]+", text.replace("-", "")))


def shingles(text: str) -> set[str]:
    words = pdf_words(text).split()
    return {" ".join(words[index : index + 3]) for index in range(len(words) - 2)}


@cache
def _pdf_sources() -> dict[str, dict]:
    path = Path(__file__).resolve().parents[3] / "data" / "pdf_sources.json"
    return json.loads(path.read_text(encoding="utf-8"))


@cache
def _page_index(document: str) -> dict[str, set[int]]:
    index = defaultdict(set)
    for number, text in enumerate(_pdf_sources()[document]["pages"], start=1):
        for shingle in shingles(text):
            index[shingle].add(number)
    return dict(index)


@lru_cache(maxsize=2048)
def pdf_source_path(document: str, text: str = "") -> str | None:
    """Resolve a shipped PDF and only add a physical page verified by chunk text."""
    key = document_key(document)
    source = _pdf_sources().get(key)
    if source is None:
        return None
    path = f"/staticfiles/{quote(source['filename'])}"
    fragments = shingles(text)
    if not fragments:
        return path
    index = _page_index(key)
    scores = Counter(page for fragment in fragments for page in index.get(fragment, ()))
    if not scores:
        return path
    page = max(scores, key=lambda number: (scores[number], -number))
    score = scores[page]
    # Short or ambiguous matches must not pretend to identify a source page.
    if score < 3 or score / len(fragments) < 0.12:
        return path
    if sum(value == score for value in scores.values()) > 1:
        return path
    return f"{path}#page={page}"
