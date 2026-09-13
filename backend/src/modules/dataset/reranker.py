from pathlib import Path

from huggingface_hub import snapshot_download
from sentence_transformers import CrossEncoder

from src.logging_ import logger

MODEL_ID = "DiTy/cross-encoder-russian-msmarco"
MODEL_DIR = Path(__file__).resolve().parents[3] / "models" / "cross-encoder-russian-msmarco"


class RerankerRepository:
    def __init__(self) -> None:
        self.ranker: CrossEncoder | None = None

    def init(self) -> None:
        if (MODEL_DIR / "config.json").is_file():
            path = str(MODEL_DIR)
            logger.info("Loading reranker from %s", path)
        else:
            MODEL_DIR.mkdir(parents=True, exist_ok=True)
            logger.info("Downloading reranker %s into %s", MODEL_ID, MODEL_DIR)
            path = snapshot_download(MODEL_ID, local_dir=str(MODEL_DIR))
        self.ranker = CrossEncoder(path, max_length=512, device="cpu")
        logger.info("Reranker loaded from %s", path)

    def rerank(self, query: str, documents: list[str]):
        if self.ranker is None or not documents:
            return []
        return self.ranker.rank(query, documents)


reranker_repository = RerankerRepository()
