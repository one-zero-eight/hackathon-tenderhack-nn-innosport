from enum import StrEnum
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr


class Environment(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"


class SettingBaseModel(BaseModel):
    model_config = ConfigDict(use_attribute_docstrings=True, extra="forbid")


class LlamaCppSettings(SettingBaseModel):
    """Optional local llama.cpp server for grounded answers."""

    enabled: bool = False
    "If false, answers are extracted directly from retrieved sources"
    base_url: str = "http://127.0.0.1:8080"
    "OpenAI-compatible llama.cpp server, e.g. http://127.0.0.1:8080 or http://192.168.1.10:8080"
    model: str = ""
    "Model name forwarded to /v1/chat/completions. Empty string lets llama.cpp use its loaded model."
    timeout_seconds: float = Field(default=8.0, gt=0, le=120)
    "HTTP timeout; on timeout the API extracts an answer from retrieved sources"
    answer_max_tokens: int = Field(default=192, gt=0, le=8192)
    "Maximum output tokens for a grounded answer"
    temperature: float = Field(default=0.0, ge=0, le=2)


class KnowledgeSearchSettings(SettingBaseModel):
    """Local semantic search settings for the Memvid knowledge base."""

    embedding_model: str = "mxbai-embed-large"
    "Ollama embedding model used when the Memvid vectors were created"
    ollama_base_url: str = "http://127.0.0.1:11434"
    "Local Ollama API used to embed search queries"


class Settings(SettingBaseModel):
    """Settings for the application."""

    schema_: str | None = Field(None, alias="$schema")
    environment: Environment = Environment.DEVELOPMENT
    "App environment flag"
    app_root_path: str = ""
    'Prefix for the API path (e.g. "/api/v0")'
    database_uri: SecretStr = Field(
        examples=[
            "mongodb://mongoadmin:secret@127.0.0.1:27017/db?authSource=admin",
            "mongodb://mongoadmin:secret@db:27017/db?authSource=admin",
        ]
    )
    "MongoDB database settings"
    cors_allow_origin_regex: str = ".*"
    "Allowed origins for CORS: from which domains requests to the API are allowed. Specify as a regex: `https://.*.innohassle.ru`"
    knowledge_memvid_path: str = "data/knowledge.mv2"
    "Path to the teammate-produced vector Memvid knowledge base"
    knowledge_search: KnowledgeSearchSettings = Field(default_factory=KnowledgeSearchSettings)
    "Local semantic retrieval configuration"
    llama_cpp: LlamaCppSettings = Field(default_factory=LlamaCppSettings)
    "Local llama.cpp answer generator. Disabled by default; the API never calls OpenAI/Gemini/Claude."

    @classmethod
    def from_yaml(cls, path: Path) -> Settings:
        with open(path) as f:
            yaml_config = yaml.safe_load(f)

        return cls.model_validate(yaml_config)

    @classmethod
    def save_schema(cls, path: Path) -> None:
        with open(path, "w") as f:
            schema = {"$schema": "https://json-schema.org/draft-07/schema", **cls.model_json_schema()}
            yaml.dump(schema, f, sort_keys=False)
