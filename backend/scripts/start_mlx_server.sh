#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="${MLX_MODEL:-$ROOT/models/mlx/gemma-4-e2b-it-4bit}"
HOST="${MLX_HOST:-0.0.0.0}"
PORT="${MLX_PORT:-8083}"

if [[ ! -d "$MODEL" ]]; then
  echo "MLX model not found: $MODEL" >&2
  exit 1
fi

# mlx has no macos x86_64 wheels. Prefer Homebrew arm64 uvx over Rosetta /usr/local.
if [[ -z "${MLX_UVX:-}" ]]; then
  if [[ -x /opt/homebrew/bin/uvx ]]; then
    MLX_UVX=/opt/homebrew/bin/uvx
  else
    MLX_UVX="$(command -v uvx || true)"
  fi
fi

if [[ -z "${MLX_UVX}" ]]; then
  echo "uvx not found. Install uv for Apple Silicon (brew install uv)." >&2
  exit 1
fi

export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-180}"
echo "Using $MLX_UVX → mlx_vlm.server --model $MODEL --host $HOST --port $PORT"
exec "$MLX_UVX" --from mlx-vlm mlx_vlm.server --model "$MODEL" --host "$HOST" --port "$PORT"
