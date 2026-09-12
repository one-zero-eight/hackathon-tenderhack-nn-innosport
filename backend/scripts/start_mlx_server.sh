#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${MLX_MODEL:-$ROOT/models/mlx/gemma-4-e2b-it-4bit}"
MODEL_ID="${MLX_MODEL_ID:-$(basename "$MODEL_DIR")}"
HOST="${MLX_HOST:-0.0.0.0}"
PORT="${MLX_PORT:-8083}"

if [[ ! -d "$MODEL_DIR" ]]; then
  echo "MLX model not found: $MODEL_DIR" >&2
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
# Serve the folder name as the OpenAI id so clients can send gemma-4-e2b-it-4bit.
# mlx-vlm resolves a local directory relative to cwd and skips Hugging Face.
echo "Using $MLX_UVX → mlx_vlm.server --model $MODEL_ID --host $HOST --port $PORT (from $(dirname "$MODEL_DIR"))"
cd "$(dirname "$MODEL_DIR")"
exec "$MLX_UVX" --from mlx-vlm mlx_vlm.server --model "$MODEL_ID" --host "$HOST" --port "$PORT"
