"""In-memory lexical autocomplete over the offline, PDF-grounded query corpus."""

import math
from collections import defaultdict
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from src.modules.dialog.normalize import STOPWORDS, stem_ru, tokenize

SAMPLE_QUERIES_PATH = Path(__file__).resolve().parents[3] / "data" / "sample_queries.txt"
router = APIRouter(prefix="/queries", tags=["Queries"])


class AutocompleteResponse(BaseModel):
    suggestions: list[str]


class QueryAutocomplete:
    def __init__(self, path: Path = SAMPLE_QUERIES_PATH):
        self.queries = tuple(
            dict.fromkeys(line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
        )
        if not self.queries:
            raise ValueError("The autocomplete query corpus is empty")
        self.normalized = tuple(" ".join(tokenize(query)) for query in self.queries)
        self.words = tuple(frozenset(tokenize(query)) - STOPWORDS for query in self.queries)
        self.stems = tuple(frozenset(stem_ru(word) for word in words) for words in self.words)
        self.prefix_index: dict[str, set[int]] = defaultdict(set)
        self.stem_index: dict[str, set[int]] = defaultdict(set)
        for index, words in enumerate(self.words):
            for word in words:
                for length in range(2, len(word) + 1):
                    self.prefix_index[word[:length]].add(index)
                self.stem_index[stem_ru(word)].add(index)

    def suggest(self, query: str, limit: int = 5) -> list[str]:
        normalized = " ".join(tokenize(query))
        if len(normalized) < 2:
            return []
        words = tuple(dict.fromkeys(word for word in tokenize(query) if word not in STOPWORDS and len(word) >= 2))
        if not words:
            return []
        matches = [self.prefix_index.get(word, set()) | self.stem_index.get(stem_ru(word), set()) for word in words]
        candidates = set.intersection(*matches)
        weights = {
            word: math.log1p(len(self.queries) / len(ids)) for word, ids in zip(words, matches, strict=True) if ids
        }

        def rank(index: int) -> tuple[float, int, int]:
            text = self.normalized[index]
            score = 12 * text.startswith(normalized) + 6 * (normalized in text)
            for word in words:
                score += weights[word] * (2 if word in self.words[index] else 1)
            return -score, len(self.queries[index]), index

        selected: list[int] = []
        for index in sorted(candidates, key=rank):
            if self.normalized[index] == normalized:
                continue
            # Do not fill the dropdown with near-identical paraphrases of one question.
            if any(
                len(self.stems[index] & self.stems[other]) / max(min(len(self.stems[index]), len(self.stems[other])), 1)
                >= 0.9
                for other in selected
            ):
                continue
            selected.append(index)
            if len(selected) == limit:
                break
        return [self.queries[index] for index in selected]


@router.get("/autocomplete")
def autocomplete(
    request: Request,
    q: Annotated[str, Query(max_length=300)] = "",
    limit: Annotated[int, Query(ge=1, le=10)] = 5,
) -> AutocompleteResponse:
    return AutocompleteResponse(suggestions=request.app.state.query_autocomplete.suggest(q, limit))
