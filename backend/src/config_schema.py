import datetime as dtm
from enum import StrEnum
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator, model_validator


class Environment(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"


class ModelProvider(StrEnum):
    LLAMA_CPP = "llama_cpp"
    MLX = "mlx"


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
    max_tool_rounds: int = Field(default=2, ge=1, le=8)
    "Maximum knowledge tool rounds before the agent must respond"
    answer_max_tokens: int = Field(default=1024, gt=0, le=8192)
    "Maximum output tokens for a natural-language support answer"
    context_tokens: int = Field(default=2048, ge=1024, le=131072)
    "Context budget per server slot; must not exceed llama.cpp --ctx-size / --parallel"
    temperature: float = Field(default=0.0, ge=0, le=2)
    enable_thinking: bool = False
    "Native thinking channel for answers/abuse. Leave false: Qwen 3.5 spends the token budget on thoughts and never finishes JSON."


class MlxSettings(SettingBaseModel):
    """Optional local MLX server (mlx-vlm) for grounded answers."""

    base_url: str = "http://127.0.0.1:8083"
    "OpenAI-compatible MLX server, e.g. http://127.0.0.1:8083 or http://host.docker.internal:8083"
    model: str = ""
    "Model name forwarded to /v1/chat/completions. Empty string lets the MLX server use its loaded model."
    max_tool_rounds: int = Field(default=2, ge=1, le=8)
    "Maximum knowledge tool rounds before the agent must respond"
    answer_max_tokens: int = Field(default=1024, gt=0, le=8192)
    "Maximum output tokens for a natural-language support answer"
    context_tokens: int = Field(default=2048, ge=1024, le=131072)
    "Approximate context budget used to compact the agent transcript"
    temperature: float = Field(default=0.0, ge=0, le=2)
    enable_thinking: bool = False
    "Native thinking channel for answers/abuse. Gemma ignores this; quality uses the in-schema reason field."


class AuditEmailSettings(SettingBaseModel):
    """SMTP delivery and daily schedule; credentials belong in local settings.yaml."""

    enabled: bool = False
    "Enable daily delivery; manual delivery only requires complete SMTP settings"
    host: str = ""
    port: int = Field(default=465, ge=1, le=65535)
    security: Literal["ssl", "starttls"] = "ssl"
    username: str = ""
    password: SecretStr = SecretStr("")
    sender: EmailStr | None = None
    recipient: EmailStr | None = None
    send_at: dtm.time = dtm.time(9, 0)
    "Daily wall-clock time in the configured timezone"
    timezone: str = "Europe/Moscow"

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value

    @field_validator("send_at")
    @classmethod
    def validate_send_at(cls, value: dtm.time) -> dtm.time:
        if value.tzinfo is not None:
            raise ValueError("send_at must be a local time without UTC offset; use timezone")
        return value

    @property
    def configured(self) -> bool:
        return bool(
            self.host.strip()
            and self.username.strip()
            and self.password.get_secret_value()
            and self.sender
            and self.recipient
        )

    @model_validator(mode="after")
    def validate_enabled(self) -> AuditEmailSettings:
        if self.enabled and not self.configured:
            raise ValueError("Daily audit email requires host, username, password, sender and recipient")
        return self


class AuditSettings(SettingBaseModel):
    """Administrative feedback analysis and email delivery."""

    max_tokens: int = Field(default=4096, ge=512, le=16384)
    "Maximum output tokens for an audit report; independent of short chat answers"
    email: AuditEmailSettings = Field(default_factory=AuditEmailSettings)


class KnowledgeSearchSettings(SettingBaseModel):
    """Semantic search settings for the MongoDB-backed knowledge base."""

    embedding_model: str = "mxbai-embed-large"
    "Ollama embedding model used when the knowledge_chunks vectors were created"
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
            "mongodb://127.0.0.1:27017/db?directConnection=true",
            "mongodb://database:27017/db?directConnection=true",
        ]
    )
    "MongoDB database settings"
    cors_allow_origin_regex: str = ".*"
    "Allowed origins for CORS: from which domains requests to the API are allowed. Specify as a regex: `https://.*.innohassle.ru`"
    knowledge_search: KnowledgeSearchSettings = Field(default_factory=KnowledgeSearchSettings)
    "Local semantic retrieval configuration"
    model_provider: ModelProvider = ModelProvider.LLAMA_CPP
    "Local answer generator: llama_cpp or mlx. The API never calls OpenAI/Gemini/Claude."
    llama_cpp: LlamaCppSettings = Field(default_factory=LlamaCppSettings)
    "llama.cpp server used when model_provider is llama_cpp. Disabled by default."
    audit: AuditSettings = Field(default_factory=AuditSettings)
    "Administrative audit report generation settings"
    mlx: MlxSettings = Field(default_factory=MlxSettings)
    "MLX server used when model_provider is mlx. Run scripts/start_mlx_server.sh on the Mac host."

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
