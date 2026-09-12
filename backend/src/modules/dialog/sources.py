import hashlib
import json
from functools import cache
from pathlib import Path


@cache
def _pdf_sources() -> dict[str, str]:
    path = Path(__file__).resolve().parents[3] / "data" / "pdf_sources.json"
    return json.loads(path.read_text(encoding="utf-8"))


def pdf_source_path(document: str, text: str) -> str | None:
    """Resolve only page locations verified against the shipped source PDFs."""
    digest = hashlib.sha256(text.encode()).hexdigest()
    return _pdf_sources().get(f"{document}:{digest}")
