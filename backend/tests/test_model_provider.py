import json

import httpx

from src.config_schema import Settings
from src.modules.dialog.factory import build_llama_client_from_settings
from src.modules.dialog.llama import LlamaCppClient, NullLlamaClient, TOOLS


def _settings(**overrides) -> Settings:
    payload = {"database_uri": "mongodb://mongoadmin:secret@127.0.0.1:27017/db"}
    payload.update(overrides)
    return Settings.model_validate(payload)


def test_llama_cpp_disabled_returns_null_client():
    client = build_llama_client_from_settings(_settings(llama_cpp={"enabled": False}))
    assert isinstance(client, NullLlamaClient)


def test_mlx_provider_uses_mlx_settings_without_llama_endpoints():
    client = build_llama_client_from_settings(
        _settings(
            model_provider="mlx",
            mlx={"base_url": "http://mlx.local:8083", "model": "gemma-4-e2b-it-4bit"},
        )
    )
    assert isinstance(client, LlamaCppClient)
    assert client.base_url == "http://mlx.local:8083"
    assert client.model == "gemma-4-e2b-it-4bit"
    assert client.llama_extensions is False


def test_llama_cpp_provider_keeps_llama_endpoints():
    client = build_llama_client_from_settings(
        _settings(
            model_provider="llama_cpp",
            llama_cpp={"enabled": True, "base_url": "http://llama.local:8081", "model": "qwen3.5-4b"},
        )
    )
    assert isinstance(client, LlamaCppClient)
    assert client.base_url == "http://llama.local:8081"
    assert client.llama_extensions is True


async def test_mlx_completion_skips_llama_cpp_routes():
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content)
        assert "chat_template_kwargs" not in payload
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {
                                    "name": "respond",
                                    "arguments": {
                                        "kind": "clarify",
                                        "text": "Уточните вопрос",
                                        "citation_ids": [],
                                    },
                                },
                                ensure_ascii=False,
                            )
                        },
                    }
                ]
            },
        )

    client = LlamaCppClient(base_url="http://mlx.local:8083", model="gemma", llama_extensions=False)
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    message = await client._complete(
        [{"role": "system", "content": "x"}, {"role": "user", "content": "y"}],
        TOOLS,
    )
    await client.aclose()
    assert requested == ["/v1/chat/completions"]
    assert message is not None
    assert message["tool_calls"][0]["function"]["name"] == "respond"
