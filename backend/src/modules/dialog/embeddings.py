"""Local Ollama embedding client.

Vendored from memvid_sdk.embeddings.OllamaEmbeddings (memvid_sdk is being removed
along with the rest of the memvid-backed knowledge store) so callers keep the
same embed_documents/embed_query interface without depending on that package.
"""

import urllib.error
import urllib.request
from json import dumps, loads

MODEL_DIMENSIONS = {
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "all-minilm": 384,
    "bge-m3": 1024,
}


class OllamaEmbeddings:
    def __init__(self, model: str = "mxbai-embed-large", base_url: str = "http://127.0.0.1:11434") -> None:
        self._base_url = base_url.strip().rstrip("/") or "http://127.0.0.1:11434"
        self._model = model
        self._dimension: int | None = None

    @property
    def dimension(self) -> int:
        if self._dimension:
            return self._dimension
        return MODEL_DIMENSIONS.get(self._model, 768)

    @property
    def model_name(self) -> str:
        return self._model

    def _post(self, payload: dict) -> dict:
        url = f"{self._base_url}/api/embeddings"
        body = dumps(payload).encode("utf-8")
        req = urllib.request.Request(  # noqa: S310 - base_url is trusted local config, not user input
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                data = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Ollama API error: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Ollama API error: {exc}. Is Ollama running at {self._base_url}?") from exc
        return loads(data.decode("utf-8", errors="replace"))

    def _embed_one(self, text: str) -> list[float]:
        data = self._post({"model": self._model, "prompt": text})
        embedding = data.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            raise RuntimeError("Ollama API error: empty embedding returned")
        if self._dimension is None:
            self._dimension = len(embedding)
        return embedding

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        # Ollama's /api/embeddings endpoint embeds one text at a time.
        return [self._embed_one(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed_one(text)
