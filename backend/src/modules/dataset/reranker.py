from typing import Optional

from flashrank import Ranker, RerankRequest


class RerankerRepository:
    def __init__(self):
        self.ranker: Ranker | None = None

    def init(self):
        self.ranker = Ranker(model_name="ms-marco-MultiBERT-L-12", cache_dir="../models")

    def rerank(self, request: RerankRequest):
        return self.ranker.rerank(request)


reranker_repository = RerankerRepository()
