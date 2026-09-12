"""Rebuild root data/sample_queries.txt offline; requires Poppler's pdftotext."""

import argparse
import hashlib
import re
import statistics
import subprocess  # noqa: S404
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF_DIR = ROOT / "backend/staticfiles"
SEEDS = Path(__file__).with_name("sample_query_seeds.txt")
OUTPUT = ROOT / "data/sample_queries.txt"
TARGET = 10_000

# Complete infinitives avoid noun-case agreement and incompatible topic/action products.
# These vary intent (procedure, navigation, prerequisites, failure, verification),
# rather than merely adding greetings, punctuation, IDs or numeric suffixes.
ACTION_FORMS = (
    "Как {text}?",
    "Что нужно сделать, чтобы {text}?",
    "Где на портале можно {text}?",
    "Не получается {text}. Что проверить?",
    "Мне нужно {text}. С чего начать?",
    "В каком порядке действовать, чтобы {text}?",
    "Хочу {text}, но не знаю, какой раздел открыть. Подскажите путь.",
    "Какие условия нужно выполнить, чтобы {text}?",
    "Можно ли {text} самостоятельно?",
    "Какие права нужны, чтобы {text}?",
    "Как проверить, что удалось {text}?",
    "Где найти инструкцию о том, как {text}?",
    "К кому обратиться, если не удается {text}?",
    "Что потребуется от меня, чтобы {text}?",
    "Пытаюсь {text}, но не понимаю последовательность действий. Как продолжить?",
    "Смогу ли я {text} в личном кабинете?",
)


def normalized(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.casefold().replace("ё", "е")).strip()


def read_sources() -> dict[str, list[str]]:
    sources = {}
    for path in sorted(PDF_DIR.glob("*.pdf")):
        # All pages are extracted during generation, never by the application at runtime.
        text = subprocess.run(  # noqa: S603
            ["pdftotext", "-layout", str(path), "-"],  # noqa: S607
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout
        pages = text.split("\f")
        if not pages[-1].strip():
            pages.pop()
        if not pages or not any(page.strip() for page in pages):
            raise ValueError(f"No extracted text: {path.name}")
        sources[path.name] = pages
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        print(f"{path.name}: pages={len(pages)}, chars={len(text)}, text_sha256={digest}")
    if not sources:
        raise ValueError("No source PDFs found")
    return sources


def read_intents(sources: dict[str, list[str]]) -> list[tuple[str, str, str]]:
    intents = []
    seen = set()
    source = None
    for number, line in enumerate(SEEDS.read_text(encoding="utf-8").splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        if line.startswith("[source|"):
            _, source, page_range = line[1:-1].split("|")
            first, last = map(int, page_range.split("-"))
            if source not in sources or not 1 <= first <= last <= len(sources[source]):
                raise ValueError(f"Invalid source range at seed line {number}")
            if not "".join(sources[source][first - 1 : last]).strip():
                raise ValueError(f"Empty source range at seed line {number}")
            continue
        kind, text = line.split("|", 1)
        if source is None or kind not in {"A", "Q"} or text != text.strip():
            raise ValueError(f"Invalid intent at seed line {number}")
        key = normalized(text)
        if key in seen:
            raise ValueError(f"Repeated intent at seed line {number}: {text}")
        seen.add(key)
        intents.append((source, kind, text))
    if {source for source, _, _ in intents} != set(sources):
        raise ValueError("Every PDF must have curated intents")
    return intents


def variants(source: str, kind: str, intent: str) -> list[str]:
    if kind == "A":
        forms = list(ACTION_FORMS)
        # File preparation and regulatory requirements are not portal UI operations.
        if source in {
            "Инструкция по формированию YML.pdf",
            "Регламент_информационного_взаимодействия.pdf",
        }:
            forms[2] = "Где в предоставленных материалах объясняется, как {text}?"
            forms[6] = "Хочу {text}. Какие требования из материалов нужно учесть?"
            forms[9] = "Что нужно предварительно подготовить, чтобы {text}?"
            forms[15] = "Какие ограничения следует учитывать, если нужно {text}?"
        if intent.startswith(("проверить ", "посмотреть ", "найти ", "открыть ", "ознакомиться ")):
            forms[10] = "Мне нужно {text}. Какие сведения для этого потребуются?"
        return [form.format(text=intent) for form in forms]
    # Factual questions remain factual: no fabricated UI operations or failure states.
    question = intent[0].upper() + intent[1:] + "?"
    return [
        question,
        f"{question} Где это описано в предоставленных материалах?",
        f"{question} Нужен ответ со ссылкой на соответствующий раздел инструкции.",
        f"{question} Объясните правило на понятном примере.",
    ]


def build(sources: dict[str, list[str]]) -> None:
    intents = read_intents(sources)
    groups = [(source, variants(source, kind, text)) for source, kind, text in intents]
    queries = []
    seen = set()
    coverage = Counter()
    # Round-robin keeps every curated intent before adding another paraphrase.
    for variant_index in range(max(len(group) for _, group in groups)):
        for source, group in groups:
            if variant_index >= len(group):
                continue
            query = group[variant_index]
            key = normalized(query)
            if key in seen:
                continue
            seen.add(key)
            queries.append(query)
            coverage[source] += 1
            if len(queries) == TARGET:
                break
        if len(queries) == TARGET:
            break
    if len(queries) != TARGET:
        raise ValueError(f"Only {len(queries)} unique queries; curate more intents")
    if any(not 20 <= len(query) <= 300 or "\n" in query for query in queries):
        raise ValueError("Invalid query length or embedded newline")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = "\n".join(queries) + "\n"
    OUTPUT.write_text(payload, encoding="utf-8")
    written = OUTPUT.read_text(encoding="utf-8").splitlines()
    if len(written) != TARGET or len(set(written)) != TARGET:
        raise ValueError("Written corpus failed count/uniqueness validation")
    lengths = [len(query) for query in written]
    print(f"\nSeeds: {len(intents)}, kinds: {dict(Counter(kind for _, kind, _ in intents))}")
    print(f"Queries: {len(written)}; normalized unique: {len(seen)}")
    print(f"Length: min={min(lengths)}, median={statistics.median(lengths)}, max={max(lengths)}")
    print(f"UTF-8 bytes: {len(payload.encode('utf-8'))}")
    print(f"Corpus SHA256: {hashlib.sha256(payload.encode('utf-8')).hexdigest()}")
    print("PDF coverage (seed intents / generated queries):")
    seed_coverage = Counter(source for source, _, _ in intents)
    for source in sources:
        print(f"  {source}: {seed_coverage[source]} / {coverage[source]}")
    print("Representative queries (evenly spaced):")
    for index in range(0, TARGET, 317):
        print(written[index])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="Inspect extracted text from matching PDF filenames")
    parser.add_argument("--pages", default="1:999", help="Inclusive PDF page range for --source")
    parser.add_argument("--inspect", action="store_true", help="Inspect numbered source sections")
    args = parser.parse_args()
    sources = read_sources()
    if args.source:
        start, end = map(int, args.pages.split(":"))
        for name, pages in sources.items():
            if args.source in name:
                print(f"\n=== {name} ===")
                print("\n".join(pages[start - 1 : end]))
    elif args.inspect:
        for name, pages in sources.items():
            print(f"\n=== {name} ===")
            for raw_line in "\n".join(pages).splitlines():
                line = re.sub(r"\s+", " ", raw_line).strip()
                if re.match(r"^\d+(?:\.\d+)*[. ]\s*\S", line) and len(line) > 16:
                    print(line)
    else:
        build(sources)


if __name__ == "__main__":
    main()
