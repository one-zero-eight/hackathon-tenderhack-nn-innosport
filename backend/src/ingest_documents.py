import re
import subprocess
from pathlib import Path

from memvid_sdk import create

from shared import embedder

DOCS_DIR = Path(__file__).parent / "documents"
STORE_PATH = str(Path(__file__).parent / "knowledge.mv2")

HEADING_RE = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+(\S.*)$", re.MULTILINE)
# Table-of-contents lines look like real headings but trail off in dot leaders
# and a page number (e.g. "1.2 Профиль компании ....... 6") - skip those.
TOC_LINE_RE = re.compile(r"\.{3,}\s*\d+\s*$")
# Bare figure captions ("Рисунок 3 – ...") don't carry standalone meaning -
# they get folded into the paragraph they follow instead of chunked alone.
FIGURE_CAPTION_RE = re.compile(r"^Рисунок\s+\d+\s*[–-]")

# mxbai-embed-large's Ollama context window is 512 tokens; Cyrillic text runs
# well under 1 char/token, so keep chunks well short of that to avoid MV_HTTP 500s.
CHUNK_SIZE = 400


def extract_text(pdf_path: Path) -> str:
    # pypdf mangles this PDF's font encoding (injects spurious mid-word
    # spaces) and pymupdf can't even parse it ("invalid key in dict"); the
    # system's poppler (pdftotext) extracts it cleanly, so shell out to it.
    result = subprocess.run(
        ["pdftotext", str(pdf_path), "-"],
        capture_output=True,
        check=True,
    )
    return result.stdout.decode("utf-8")


def clean_text(text: str) -> str:
    text = text.replace("\x0c", "\n")  # page-break marker -> plain newline
    # Bullet lists use a custom font glyph that lands in the Private Use Area;
    # it always sits at the start of a bulleted line, so normalize it to "-".
    text = re.sub(r"(?m)^[-]\s*", "- ", text)
    text = re.sub(r"[-]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text


def split_into_units(body: str) -> list[str]:
    """Split a section body into paragraph/bullet units, never mid-sentence.

    Each block (blank-line-delimited) is further split so every "- " bullet
    becomes its own unit, instead of the whole bullet list being one giant
    unit that pack_units() would later have to hard-wrap mid-bullet."""
    blocks = [b for b in re.split(r"\n\s*\n", body) if b.strip()]
    units: list[str] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        segments: list[list[str]] = []
        for line in lines:
            if not segments or line.startswith("- "):
                segments.append([line])
            else:
                segments[-1].append(line)
        for segment in segments:
            joined = " ".join(segment)
            if units and FIGURE_CAPTION_RE.match(joined):
                units[-1] = f"{units[-1]} {joined}"
            else:
                units.append(joined)
    return units


def pack_units(units: list[str], max_chars: int = CHUNK_SIZE) -> list[str]:
    """Greedily pack whole units into chunks, carrying the last unit of a
    chunk forward into the next one for context continuity. Only a single
    unit that alone exceeds the budget gets hard-wrapped, and only on
    whitespace (never mid-word)."""
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    i = 0
    while i < len(units):
        unit = units[i]
        if len(unit) > max_chars:
            if current:
                chunks.append(" ".join(current))
                current, current_len = [], 0
            piece = ""
            for word in unit.split(" "):
                candidate = f"{piece} {word}".strip()
                if piece and len(candidate) > max_chars:
                    chunks.append(piece)
                    piece = word
                else:
                    piece = candidate
            if piece:
                chunks.append(piece)
            i += 1
            continue

        candidate_len = current_len + (1 if current else 0) + len(unit)
        if current and candidate_len > max_chars:
            chunks.append(" ".join(current))
            # Soft overlap: carry the last unit forward for continuity, but
            # only if it still leaves room for the unit we're about to add -
            # otherwise drop the overlap so we always make forward progress.
            overlap = current[-1:]
            if len(overlap[0]) + 1 + len(unit) <= max_chars:
                current, current_len = overlap, len(overlap[0])
            else:
                current, current_len = [], 0
            continue

        current.append(unit)
        current_len = candidate_len
        i += 1

    if current:
        chunks.append(" ".join(current))
    return chunks


def split_sections(text: str, source: str) -> list[dict]:
    headings = [
        m for m in HEADING_RE.finditer(text) if not TOC_LINE_RE.search(m.group(0))
    ]
    if not headings:
        return [
            {
                "title": f"{source} (chunk {i + 1})",
                "text": chunk,
                "label": "manual",
                "labels": ["manual"],
                "metadata": {"source": source, "chunk": i + 1},
            }
            for i, chunk in enumerate(pack_units(split_into_units(text)))
        ]

    items = []
    for i, match in enumerate(headings):
        section_number = match.group(1)
        heading_text = match.group(2).strip()
        body_start = match.end()
        body_end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        body = text[body_start:body_end].strip()
        if not body:
            continue
        sub_chunks = pack_units(split_into_units(body))
        for j, chunk in enumerate(sub_chunks):
            title = f"{section_number} {heading_text}"
            if len(sub_chunks) > 1:
                title = f"{title} (part {j + 1})"
            items.append(
                {
                    "title": title,
                    "text": chunk,
                    "label": "manual",
                    "labels": ["manual"],
                    "metadata": {
                        "source": source,
                        "section": section_number,
                        "section_title": heading_text,
                    },
                }
            )
    return items


def main():
    items = []
    for pdf_path in sorted(DOCS_DIR.glob("*.pdf")):
        text = clean_text(extract_text(pdf_path))
        items.extend(split_sections(text, source=pdf_path.name))

    if not items:
        print("No content extracted from documents/, nothing to ingest.")
        return

    embeddings = [
        [float(x) for x in vec]
        for vec in embedder.embed_documents([item["text"] for item in items])
    ]

    Path(STORE_PATH).unlink(missing_ok=True)
    mem = create(STORE_PATH, enable_lex=True, enable_vec=True)
    # put_many(embeddings=[...]) in memvid-sdk 2.0.160 only persists the vector
    # index correctly for the LAST item when given a multi-item batch (all
    # earlier items' vectors are silently dropped/overwritten). Calling it once
    # per item avoids this and keeps every frame's vector correctly indexed.
    for item, embedding in zip(items, embeddings):
        mem.put_many([item], embeddings=[embedding])

    print(f"Ingested {len(items)} chunks from {DOCS_DIR} into {STORE_PATH}")


if __name__ == "__main__":
    main()
