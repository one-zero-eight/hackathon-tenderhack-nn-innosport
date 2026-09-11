# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "polars>=1.36,<2",
#     "fastexcel>=0.18,<1",
#     "pydantic>=2.12,<3",
# ]
# ///

import argparse
from pathlib import Path

import polars as pl
from pydantic import TypeAdapter

from src.modules.dataset.repository import DEFAULT_DATASET_PATH
from src.modules.dataset.schemas import Impact, SupportRecord, TopicRecord

DEFAULT_INPUT = Path(__file__).parent.parent.parent / "data" / "Выгрузка СТП за 2026.xlsx"
DEFAULT_TOPICS_INPUT = Path(__file__).parent.parent.parent / "data" / "Темы_подтемы_обращений.xlsx"
DEFAULT_OUTPUT = DEFAULT_DATASET_PATH
SOURCE_COLUMNS = ["Тема", "Описание", "Решение", "Влияние"]
SUBTOPIC_PREFIX = r"(?i)^\s*Подтема запроса:\s*([^/]*)/\s*"


def convert_topics(source: Path, destination: Path) -> pl.DataFrame:
    """Read the reference header on row 3 and expand merged topic cells."""
    columns = ["Тема обращений", "Подтема обращений:"]
    data = pl.read_excel(
        source,
        engine="calamine",
        sheet_id=1,
        read_options={"header_row": 2},
        columns=columns,
        schema_overrides={column: pl.String for column in columns},
    )
    result = data.select(
        pl.col("Тема обращений").str.strip_chars().replace("", None).forward_fill().alias("topic"),
        pl.col("Подтема обращений:").str.strip_chars().alias("subtopic"),
    )
    TypeAdapter(list[TopicRecord]).validate_python(result.to_dicts())
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.write_parquet(destination, compression="zstd")
    return result


def convert(source: Path, destination: Path) -> pl.DataFrame:
    """Extract support records, validate them, and write exactly five columns."""
    data = pl.read_excel(
        source,
        engine="calamine",
        sheet_id=1,
        columns=SOURCE_COLUMNS,
        schema_overrides={column: pl.String for column in SOURCE_COLUMNS},
    )
    description = pl.col("Описание")
    result = data.select(
        pl.col("Тема").str.strip_chars().alias("topic"),
        description.str.extract(SUBTOPIC_PREFIX, 1).str.strip_chars().replace("", None).alias("subtopic"),
        description.str.replace(SUBTOPIC_PREFIX, "").str.strip_chars().alias("question"),
        pl.col("Решение").str.strip_chars().alias("answer"),
        pl.col("Влияние").str.strip_chars().cast(pl.Enum([impact.value for impact in Impact])).alias("impact"),
    )
    # Validation errors include the zero-based record index and field name.
    # Missing subtopics are allowed; nulls in other fields are not.
    TypeAdapter(list[SupportRecord]).validate_python(result.to_dicts())
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.write_parquet(destination, compression="zstd")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert support XLSX records to a validated Parquet dataset.")
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output path (default: input path with .parquet extension).",
        default=DEFAULT_OUTPUT,
    )
    parser.add_argument("--topics-input", type=Path, default=DEFAULT_TOPICS_INPUT)
    parser.add_argument(
        "--topics-output",
        type=Path,
        help="Reference output path (default: topics input with .parquet extension).",
    )
    args = parser.parse_args()
    destination = args.output if args.output is not None else args.input.with_suffix(".parquet")
    topics_destination = (
        args.topics_output if args.topics_output is not None else args.topics_input.with_suffix(".parquet")
    )
    inputs = {args.input.resolve(), args.topics_input.resolve()}
    outputs = {destination.resolve(), topics_destination.resolve()}
    if inputs & outputs or len(outputs) != 2:
        parser.error("Output paths must differ from each other and from input paths.")
    topics = convert_topics(args.topics_input, topics_destination)
    print(f"Saved {topics.height} topic/subtopic pairs ({topics['topic'].n_unique()} topics) to {topics_destination}")
    result = convert(args.input, destination)
    print(f"Saved {result.height} records to {destination}")
    print(f"Records without subtopic: {result['subtopic'].null_count()}")


if __name__ == "__main__":
    main()
