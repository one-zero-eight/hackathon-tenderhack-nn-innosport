import json
from pathlib import Path

from src.modules.dialog.models import KnowledgeBase, Topic

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[3] / "data"


def load_knowledge(data_dir: Path | None = None) -> KnowledgeBase:
    directory = data_dir or DEFAULT_DATA_DIR
    topics_path = directory / "topic_catalog.json"
    topics_raw = json.loads(topics_path.read_text(encoding="utf-8"))
    return KnowledgeBase(topics=[Topic.model_validate(item) for item in topics_raw])
