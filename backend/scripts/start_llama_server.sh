#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="${LLAMA_MODEL:-$ROOT/models/qwen2.5-3b-instruct-q4_k_m.gguf}"
HOST="${LLAMA_HOST:-127.0.0.1}"
PORT="${LLAMA_PORT:-8081}"

if [[ ! -f "$MODEL" ]]; then
  echo "Model not found: $MODEL" >&2
  exit 1
fi

if [[ "$(uname -m)" == "arm64" ]]; then
  NATIVE="$(find "$ROOT/.tools/llama.cpp" -type f -name llama-server -print -quit 2>/dev/null || true)"
  if [[ -n "$NATIVE" ]]; then
    SERVER="$NATIVE"
  else
    SERVER="$(command -v llama-server)"
  fi
else
  SERVER="$(command -v llama-server)"
fi

if [[ -z "${SERVER:-}" || ! -x "$SERVER" ]]; then
  echo "llama-server not found. On Apple Silicon download macos-arm64 from" >&2
  echo "https://github.com/ggml-org/llama.cpp/releases into backend/.tools/llama.cpp" >&2
  exit 1
fi

echo "Using $SERVER"
file "$SERVER"
exec "$SERVER" --host "$HOST" --port "$PORT" -m "$MODEL" \
  --ctx-size 2048 --parallel 1 --threads 8 --threads-batch 8 \
  --gpu-layers 99 --flash-attn on --temp 0
