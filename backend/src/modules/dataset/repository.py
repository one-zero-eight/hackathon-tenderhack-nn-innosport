__all__ = ["DEFAULT_DATASET_PATH", "DatasetRepository"]

from pathlib import Path

import polars as pl
from pydantic import TypeAdapter

from src.modules.dataset.schemas import Impact, SupportRecord

DEFAULT_DATASET_PATH = Path(__file__).resolve().parents[3] / "dataset_requests.parquet"
DATASET_SCHEMA = pl.Schema(
    {
        "topic": pl.String,
        "subtopic": pl.String,
        "question": pl.String,
        "answer": pl.String,
        "impact": pl.Enum([impact.value for impact in Impact]),
    }
)


class DatasetRepository:
    def __init__(self, path: Path = DEFAULT_DATASET_PATH) -> None:
        self.path = path

    def load(self) -> pl.DataFrame:
        """Load and validate the dataset without changing its stored schema."""
        dataframe = pl.read_parquet(self.path)
        if dataframe.schema != DATASET_SCHEMA:
            raise ValueError(
                f"Invalid dataset schema in {self.path}: expected {DATASET_SCHEMA}, got {dataframe.schema}"
            )
        TypeAdapter(list[SupportRecord]).validate_python(dataframe.to_dicts())
        return dataframe
