"""Index physical PDF pages independently of knowledge storage and chunk boundaries.

Run from backend/: uv run python scripts/build_pdf_sources.py
Reads the PDFs served from staticfiles/. No PDF parsing is done at request time.
"""

import json
import sys
from pathlib import Path

from pypdf import PdfReader

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))

from src.modules.dialog.sources import document_key, pdf_words  # noqa: E402


def main() -> None:
    sources = {}
    for source in sorted((BACKEND_DIR / "staticfiles").glob("*.pdf")):
        key = document_key(source.name)
        if key in sources:
            raise ValueError(f"Duplicate PDF document name: {source.name}")
        pages = [pdf_words(page.extract_text()) for page in PdfReader(source).pages]
        sources[key] = {"filename": source.name, "pages": pages}
    if not sources:
        raise RuntimeError("No PDFs found in staticfiles/")
    (BACKEND_DIR / "data" / "pdf_sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Indexed {len(sources)} PDFs, {sum(len(source['pages']) for source in sources.values())} physical pages")


if __name__ == "__main__":
    main()
