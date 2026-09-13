from typing import Optional

from flashrank import Ranker, RerankRequest
from sentence_transformers import CrossEncoder


class RerankerRepository:
    def __init__(self):
        self.ranker: CrossEncoder | None = None

    def init(self):
        self.ranker = CrossEncoder("DiTy/cross-encoder-russian-msmarco", max_length=512)

    def rerank(self, query: str, documents: list[str]):
        return self.ranker.rank(query, documents)


reranker_repository = RerankerRepository()
