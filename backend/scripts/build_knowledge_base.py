# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "polars>=1.36,<2",
#     "fastexcel>=0.18,<1",
#     "pydantic>=2.12,<3",
#     "pypdf>=5.1.0",
# ]
# ///

"""Build topic catalog and short extractive chunks from /docs."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import polars as pl
from pypdf import PdfReader

sys.path.append(str(Path(__file__).resolve().parents[1]))

from src.modules.dialog.normalize import collapse_pdf_text, significant_stems, tokenize

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCS_DIR = REPO_ROOT / "docs"
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "data"

HEADING_RE = re.compile(
    r"^(?P<num>\d+(?:\.\d+){0,4})(?:\.)?\s+(?P<title>[А-ЯA-ZЁ][^.\n]{2,160})$",
    re.MULTILINE,
)
TOC_LINE_RE = re.compile(
    r"^(?P<num>\d+(?:\.\d+){0,4})\s+(?P<title>.+?)\s+\d+\s*$",
    re.MULTILINE,
)
SUBTOPIC_PREFIX = re.compile(r"(?i)^\s*Подтема запроса:\s*([^/]*)/\s*")
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
SKIP_LINE_RE = re.compile(r"^(рисунок|таблица|стр\.?|страница)\b", re.IGNORECASE)

PARENT_DOC_HINTS: dict[str, tuple[str, ...]] = {
    "Личный кабинет пользователя": (
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        "Инструкция_по_работе_с_Порталом_для_заказчика.pdf",
        "Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf",
    ),
    "Закупочные процедуры": (
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        "Инструкция_по_работе_с_Порталом_для_заказчика.pdf",
        "Инструкция_по_созданию_оферты_и_СТЕ.pdf",
    ),
    "Карточка поставщика": (
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        "Инструкция_по_работе_с_Порталом_для_заказчика.pdf",
    ),
    "Работа с контрактами": (
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        "Инструкция_по_работе_с_Порталом_для_заказчика.pdf",
        "Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf",
    ),
    "Работа с СТЕ": (
        "Инструкция_по_созданию_оферты_и_СТЕ.pdf",
        "Инструкция по формированию YML.pdf",
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        "Инструкция_по_электронному_актированию.pdf",
    ),
    "Уполномоченный орган (Региональный заказчик)": (
        "Инструкция_по_работе_с_Порталом_для_заказчика.pdf",
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
    ),
    "Электронное исполнение (малый объем)": ("Инструкция_по_электронному_актированию.pdf",),
    "Электронное исполнение (ЕИС)": ("Инструкция_по_электронному_актированию.pdf",),
    "Блокировка личного кабинета": (
        "Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        "Инструкция_по_работе_с_Порталом_для_заказчика.pdf",
    ),
}

# Extra query phrases taken from real instruction headings, not invented topics.
SUBTOPIC_QUERIES: dict[str, tuple[str, ...]] = {
    "Регистрация": ("регистрация поставщика", "регистрация заказчика"),
    "Полномочия": ("категории и права пользователей", "машиночитаем"),
    "Авторизация": ("авторизация пользователя",),
    "Восстановление доступа": ("восстановлен", "парол"),
    "Сертификат ЭП": ("подключение электронной подписи", "электронной подписи"),
    "Изменение ЭП": ("электронной подписи", "сертификат"),
    "Изменение электронной почты": ("электронной почты", "профиль пользователя"),
    "Настройка уведомлений": ("настройка получения уведомлений", "уведомления"),
    "Получение уведомлений": ("уведомления", "оповещения"),
    "Изменение данных пользователя": ("профиль пользователя", "изменение данных"),
    "Сквозная авторизация": ("авторизация", "внешними системами"),
    "Архивация ЛК (ликвидация и иные причины)": ("ликвидац", "архив"),
    "Изменение типа компании": ("тип компании", "профиль компании"),
    "Создание Котировочной сессии": ("котировочн", "создание"),
    "Отображение Котировочной сессии": ("котировочн",),
    "Участие в Котировочной сессии": ("участие в закупках", "котировочн"),
    "Создание оферты по Котировочной сессии": ("создание оферт по результатам котировочных", "котировочн"),
    "Отображение Потребности": ("закупки по потребностям", "потребност"),
    "Обмен закупками с Региональными информационными системами (РИС)": ("региональн", "рис"),
    "Создание Потребности": ("закупки по потребностям",),
    "Участие в Потребности": ("закупки по потребностям", "участие"),
    "Поиск Закупок": ("единый реестр закупок", "фильтры единого реестра закупок", "поиск закупок"),
    "Отображение Закупок": ("карточки закупок", "единый реестр закупок"),
    "Снятие КС": ("котировочн",),
    "Снятие блокировки с поставщика": ("автоматическая блокировка", "снятие"),
    "Прямая закупка": ("прямые закупки", "прямая закупка"),
    "Статус закупки": ("карточки закупок", "статус"),
    "Участие в Котировочной сессии по 46-ФЗ": ("котировочн", "46"),
    "Заполнение заявки": ("регистрация поставщика", "профиль компании"),
    "Объединение профилей": ("профиль компании", "филиалы"),
    "Отправка заявка на изменение данных компании": ("профиль компании", "изменение"),
    "Отображение данных": ("профиль компании", "публичный профиль"),
    "Статус заявки": ("регистрация", "заявк"),
    "Создание контракта": ("мои контракты", "создание контракта"),
    "Дата заключения": ("мои контракты", "дата"),
    "Документ контракта": ("документ контракта", "мои контракты"),
    "Отображение контрактов": ("реестр контрактов", "мои контракты"),
    "Отправка контракта": ("отправка контракта", "мои контракты"),
    "Подписание контракта": ("подписание контракта", "мои контракты"),
    "Протокол разногласий": ("протокол разногласий",),
    "Обмен контрактами с Региональными информационными системами (РИС)": ("обмен контрактами", "рис"),
    "Расторжение контракта": ("расторжение",),
    "Статус контракта": ("статус контракта", "мои контракты"),
    "Исполнение контракта (неэлектронное исполнение)": ("бумажное исполнение", "неэлектрон"),
    "Контракты по 46-ФЗ": ("46-фз", "46"),
    "Добавление категории СТЕ": ("создание предложения и сте", "категор"),
    "Изменение справочника СТЕ": ("версионность сте", "справочник"),
    "Массовая загрузка YML": (
        "массовый импорт прайс-листа",
        "подготовка yml",
        "загрузка прайс-листа",
        "загрузка файлов в форматах yml",
    ),
    "Ошибка заполнения заявки": ("создание предложения и сте", "заполн"),
    "Ошибка отображения СТЕ": ("публичная страница карточки сте", "отображен"),
    "Массовое подписание оферт": ("редактирование оферт", "подписан"),
    "Подписание оферты": ("редактирование оферт", "подписан"),
    "Отображение оферт в личном кабинете": ("оферты", "личный кабинет"),
    "Заполнение оферты": ("подача ценового предложения", "создание предложения и сте"),
    "Создание заявки СТЕ": ("создание предложения и сте", "массовое создание сте"),
    "Статус СТЕ": ("версионность сте", "статус"),
    "Необходимы комментарии модератора": ("модерац", "комментар"),
    "Формирование СТЕ для электронного исполнения": ("создание сте для упд", "сте"),
    "Создание профиля компании (УО)": ("регистрация заказчика", "профиль компании"),
    "Утверждение заявки (УО)": ("регистрация заказчика", "заявк"),
    "Статистика региона": ("интерактивная карта регионов", "статистика"),
    "Полномочия УО": ("категории и права пользователей", "полномоч"),
    "Заполнение спецификации исполнения": ("заполнение данными исполнения", "спецификац"),
    "Установка связи с заказчиком": ("установка связи с заказчиком",),
    "Подписание и отправка УПД": ("подписание документа", "отправка документа"),
    "Статус исполнения": ("список доступных поставщику действий", "статус исполнения"),
    "Регистрация в ЭДО": ("для исполнений через", "диадок", "калуга астрал"),
    "Создание исполнения (заполнение основных полей)": ("создание нового исполнения",),
    "Создание исполнения": ("создание нового исполнения", "создание и отправка исполнения"),
    "Заполнение данных": ("заполнение данными исполнения",),
    "Формирование УПД (вопросы по ошибкам РДИК)": ("ошибка при отправке", "рдик"),
    "Отправка УПД и статус исполнения (ошибки интеграции)": ("ошибка при отправке документа", "статус исполнения"),
    "Установка связи с ЭДО ЕИС": ("для исполнения через еис", "эдо еис"),
    "Формирование УПД (46-ФЗ)": ("46-фз", "упд"),
    "Исполнение по 46- ФЗ": ("46-фз", "исполнение"),
    "Причины блокировки": ("сроки и основания для автоматической блокировки", "автоматическая блокировка"),
    "Снятие блокировки": ("автоматическая блокировка", "снятие"),
    "Компания включена в РНП": ("реестре недобросовестных поставщиков", "рнп"),
    "Компания исключена из РНП": ("реестре недобросовестных поставщиков", "рнп"),
    "Разблокировка пользователя": ("автоматическая блокировка", "разблок"),
    "Срок блокировки": ("сроки и основания для автоматической блокировки",),
}

ABBREV_KEYS = (
    "эп",
    "эцп",
    "сте",
    "yml",
    "упд",
    "укд",
    "еис",
    "эдо",
    "мчд",
    "рнп",
    "кс",
    "лк",
    "рис",
    "уо",
)


@dataclass
class RawTopic:
    number: int
    parent: str
    title: str


@dataclass
class PdfSection:
    document: str
    path: str
    number: str
    title: str
    text: str


def find_topics_xlsx(docs_dir: Path) -> Path:
    matches = sorted(docs_dir.glob("Темы_подтемы_*.xlsx"))
    if not matches:
        raise FileNotFoundError(f"Topics workbook not found in {docs_dir}")
    return matches[0]


def load_topics(path: Path) -> list[RawTopic]:
    data = pl.read_excel(
        path,
        engine="calamine",
        sheet_id=1,
        read_options={"header_row": 2},
        columns=["№", "Тема обращений", "Подтема обращений:"],
        schema_overrides={
            "№": pl.Int64,
            "Тема обращений": pl.String,
            "Подтема обращений:": pl.String,
        },
    )
    rows = data.select(
        pl.col("№").alias("number"),
        pl.col("Тема обращений").str.strip_chars().replace("", None).forward_fill().alias("parent"),
        pl.col("Подтема обращений:").str.strip_chars().alias("title"),
    )
    topics: list[RawTopic] = []
    for row in rows.iter_rows(named=True):
        title = str(row["title"]).strip()
        parent = str(row["parent"]).strip()
        if not title or not parent:
            continue
        topics.append(RawTopic(number=int(row["number"]), parent=parent, title=title))
    if not topics:
        raise RuntimeError(f"No topics parsed from {path}")
    return topics


def extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return collapse_pdf_text("\n".join(pages))


def _clean_heading(title: str) -> str:
    title = re.sub(r"\s+", " ", title).strip(" .\t")
    title = re.sub(r"\s+\d+$", "", title)
    return title


def split_pdf_sections(path: Path, text: str) -> list[PdfSection]:
    rel_path = f"docs/{path.name}"
    headings: list[tuple[int, str, str]] = []
    for match in HEADING_RE.finditer(text):
        title = _clean_heading(match.group("title"))
        if len(title) < 4 or len(title) > 90 or SKIP_LINE_RE.match(title):
            continue
        words = title.split()
        if len(words) > 8:
            continue
        first = words[0].lower()
        if first in {"на", "для", "при", "также", "если", "после", "перед"}:
            continue
        headings.append((match.start(), match.group("num"), title))
    if len(headings) < 3:
        for match in TOC_LINE_RE.finditer(text):
            title = _clean_heading(match.group("title"))
            if len(title) < 4:
                continue
            headings.append((match.start(), match.group("num"), title))
        headings.sort(key=lambda item: item[0])

    sections: list[PdfSection] = []
    if not headings:
        sections.append(PdfSection(document=path.name, path=rel_path, number="", title=path.stem, text=text[:4000]))
        return sections

    for index, (start, number, title) in enumerate(headings):
        end = headings[index + 1][0] if index + 1 < len(headings) else len(text)
        body = text[start:end].strip()
        if len(body) < 80:
            continue
        sections.append(PdfSection(document=path.name, path=rel_path, number=number, title=title, text=body))
    return sections


def section_label(section: PdfSection) -> str:
    if section.number:
        return f"{section.number} {section.title}"
    return section.title


def score_section(topic: RawTopic, section: PdfSection) -> float:
    heading_stems = set(significant_stems(f"{section.number} {section.title}"))
    body_stems = set(significant_stems(section.text[:2500]))
    title_stems = set(significant_stems(topic.title))
    parent_stems = set(significant_stems(topic.parent))
    extra = " ".join(SUBTOPIC_QUERIES.get(topic.title, ()))
    extra_stems = set(significant_stems(extra))
    query_stems = title_stems | extra_stems
    if not query_stems:
        return 0.0
    heading_hits = query_stems & heading_stems
    body_hits = query_stems & body_stems
    parent_hits = parent_stems & heading_stems
    score = 5.0 * len(heading_hits) + 1.6 * len(body_hits) + 0.4 * len(parent_hits)
    preferred = PARENT_DOC_HINTS.get(topic.parent, ())
    if section.document in preferred:
        score += 1.5
    if title_stems and title_stems <= heading_stems:
        score += 4.0
    if extra_stems and extra_stems & heading_stems:
        score += 2.0
    heading_l = section.title.lower()
    parent_l = topic.parent.lower()
    supplier_doc = "Инструкция_по_работе_с_Порталом_для_поставщика.pdf"
    customer_doc = "Инструкция_по_работе_с_Порталом_для_заказчика.pdf"
    if "уполномочен" in parent_l or "заказчик" in topic.title.lower():
        if section.document == customer_doc:
            score += 2.0
    elif section.document == supplier_doc:
        score += 2.0
    if "поставщик" in heading_l and "заказчик" not in parent_l:
        score += 1.5
    if "пример" in heading_l or "рисунок" in heading_l:
        score -= 8.0
    if "yml" in topic.title.lower() and "пример" in heading_l:
        return 0.0
    if topic.title.strip().lower() == "консультация" and "консультац" not in heading_l:
        return 0.0
    return score


def sentences(text: str) -> list[str]:
    parts = [re.sub(r"\s+", " ", part).strip() for part in SENTENCE_RE.split(text)]
    return [part for part in parts if len(part) >= 40 and not SKIP_LINE_RE.match(part)]


def extract_description(section: PdfSection, topic: RawTopic) -> str:
    body = section.text
    # Drop the heading line itself.
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if lines:
        lines = lines[1:]
    joined = " ".join(lines)
    picked = [part for part in sentences(joined) if not SKIP_LINE_RE.match(part)]
    if picked:
        description = " ".join(picked[:2])
    else:
        description = joined[:400]
    description = description.strip()
    if len(description) < 40:
        return f"Подтема «{topic.title}» темы «{topic.parent}» по инструкции «{section.document}», раздел {section_label(section)}."
    return description[:600].rstrip()


def extract_chunk_text(section: PdfSection, topic: RawTopic, limit: int = 1100) -> str:
    query = set(significant_stems(f"{topic.parent} {topic.title} " + " ".join(SUBTOPIC_QUERIES.get(topic.title, ()))))
    lines = []
    for raw_line in section.text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or SKIP_LINE_RE.match(line) or line.isdigit():
            continue
        if re.fullmatch(r"\d+(\.\d+)*", line):
            continue
        lines.append(line)
    if lines:
        lines = lines[1:]
    paragraphs: list[str] = []
    buf: list[str] = []
    for line in lines:
        buf.append(line)
        if line.endswith((".", ":", ";")) or len(" ".join(buf)) > 280:
            paragraphs.append(" ".join(buf))
            buf = []
    if buf:
        paragraphs.append(" ".join(buf))
    ranked: list[tuple[float, int, str]] = []
    for index, paragraph in enumerate(paragraphs):
        stems = set(significant_stems(paragraph))
        overlap = len(query & stems)
        if len(paragraph) < 60:
            continue
        ranked.append((float(overlap), -index, paragraph))
    ranked.sort(reverse=True)
    chosen = [item[2] for item in ranked[:4]]
    if not chosen:
        chosen = paragraphs[:3]
    # Restore original order.
    order = {paragraph: index for index, paragraph in enumerate(paragraphs)}
    chosen.sort(key=lambda paragraph: order.get(paragraph, 0))
    text = " ".join(chosen)
    return text[:limit].rstrip()


def derived_keys(topic: RawTopic, section: PdfSection | None, extra: list[str]) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        item = re.sub(r"\s+", " ", value).strip(" .,:;")
        if len(item) < 3:
            return
        lowered = item.lower().replace("ё", "е")
        if lowered in seen:
            return
        seen.add(lowered)
        keys.append(item)

    GENERIC_EXTRA = {
        "портал",
        "поставщик",
        "поставщика",
        "заказчик",
        "компания",
        "заявка",
        "ошибк",
        "данн",
        "профил",
        "пройти",
        "прош",
        "необходимо",
        "нужно",
        "работа",
        "вопрос",
        "перед",
    }

    add(topic.title)
    add(topic.parent)
    for token in tokenize(f"{topic.parent} {topic.title}"):
        if token not in {"и", "с", "по", "для", "на", "в"} and len(token) >= 3:
            add(token)
    if section is not None:
        add(section.title)
        if len(section.title.split()) <= 6:
            for token in tokenize(section.title):
                if len(token) >= 4:
                    add(token)
    for phrase in SUBTOPIC_QUERIES.get(topic.title, ()):
        add(phrase)
    for token in extra:
        if token.lower() in GENERIC_EXTRA:
            continue
        add(token)
    title_lower = topic.title.lower()
    parent_lower = topic.parent.lower()
    if "эп" in title_lower or "подпис" in title_lower:
        add("эп")
        add("эцп")
        add("электронная подпись")
        add("сертификат")
    if "yml" in title_lower or "yml" in parent_lower:
        add("yml")
        add("прайс-лист")
    if "сте" in title_lower or "сте" in parent_lower:
        add("сте")
        add("оферта")
    if "упд" in title_lower or "исполнен" in parent_lower:
        add("упд")
        add("электронное исполнение")
    if "мчд" in title_lower or "полномоч" in title_lower:
        add("мчд")
        add("машиночитаемая доверенность")
    if "рнп" in title_lower or "блок" in parent_lower:
        add("рнп")
        add("блокировка")
    if "котировоч" in title_lower:
        add("кс")
        add("котировочная сессия")
    return keys[:24]


def load_support_keys(path: Path, topics: list[RawTopic]) -> dict[tuple[str, str], list[str]]:
    if not path.exists():
        return {}
    titles = {topic.title.lower().replace("ё", "е"): topic for topic in topics}
    data = pl.read_excel(
        path,
        engine="calamine",
        sheet_id=1,
        columns=["Тема", "Описание"],
        schema_overrides={"Тема": pl.String, "Описание": pl.String},
    )
    counters: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for row in data.iter_rows(named=True):
        description = str(row["Описание"] or "")
        match = SUBTOPIC_PREFIX.search(description)
        if not match:
            continue
        subtopic = match.group(1).strip().lower().replace("ё", "е")
        topic = titles.get(subtopic)
        if topic is None:
            continue
        question = SUBTOPIC_PREFIX.sub("", description)
        for stem in significant_stems(question):
            if len(stem) < 4 or stem in ABBREV_KEYS:
                continue
            counters[(topic.parent, topic.title)][stem] += 1
    result: dict[tuple[str, str], list[str]] = {}
    for key, counter in counters.items():
        result[key] = [stem for stem, _count in counter.most_common(8)]
    return result


def best_sections(topic: RawTopic, sections: list[PdfSection], limit: int = 2) -> list[tuple[float, PdfSection]]:
    ranked = [(score_section(topic, section), section) for section in sections]
    ranked.sort(key=lambda item: item[0], reverse=True)
    picked: list[tuple[float, PdfSection]] = []
    for score, section in ranked:
        if score < 2.6:
            break
        picked.append((score, section))
        if len(picked) >= limit:
            break
    return picked


def build(docs_dir: Path, output_dir: Path, *, skip_stp: bool = False) -> None:
    topics_path = find_topics_xlsx(docs_dir)
    topics = load_topics(topics_path)
    pdf_paths = sorted([*docs_dir.glob("Инструкция*.pdf"), *docs_dir.glob("*YML*.pdf")])
    pdf_paths = list(dict.fromkeys(pdf_paths))
    sections: list[PdfSection] = []
    for pdf_path in pdf_paths:
        print(f"Extracting {pdf_path.name}...")
        text = extract_pdf_text(pdf_path)
        parsed = split_pdf_sections(pdf_path, text)
        print(f"  {len(parsed)} sections, {len(text)} chars")
        sections.extend(parsed)

    support_keys: dict[tuple[str, str], list[str]] = {}
    stp_path = docs_dir / "Выгрузка СТП за 2026.xlsx"
    if not skip_stp:
        print(f"Collecting frequent phrasings from {stp_path.name}...")
        support_keys = load_support_keys(stp_path, topics)

    catalog: list[dict] = []
    with_chunks = 0
    for topic in topics:
        topic_id = f"t-{topic.number:03d}"
        matched = best_sections(topic, sections)
        section = matched[0][1] if matched else None
        description = (
            extract_description(section, topic)
            if section is not None
            else f"Подтема «{topic.title}» темы «{topic.parent}» из классификатора обращений."
        )
        extra_keys = support_keys.get((topic.parent, topic.title), [])
        catalog.append(
            {
                "id": topic_id,
                "title": topic.title,
                "parent_title": topic.parent,
                "description": description,
                "keys": derived_keys(topic, section, extra_keys),
                "document": section.document if section else "",
                "section": section_label(section) if section else "",
                "path": section.path if section else "",
            }
        )
        if not matched:
            continue
        with_chunks += 1

    output_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = output_dir / "topic_catalog.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Topics: {len(catalog)}; mapped to docs: {with_chunks}")
    print(f"Wrote {catalog_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build dialog knowledge catalog from /docs.")
    parser.add_argument("--docs-dir", type=Path, default=DOCS_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--skip-stp", action="store_true")
    args = parser.parse_args()
    build(args.docs_dir, args.output_dir, skip_stp=args.skip_stp)


if __name__ == "__main__":
    main()
