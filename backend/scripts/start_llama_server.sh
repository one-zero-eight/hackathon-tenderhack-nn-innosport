#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="${LLAMA_MODELS_PRESET:-$ROOT/models/models.ini}"
HOST="${LLAMA_HOST:-127.0.0.1}"
PORT="${LLAMA_PORT:-8081}"
MODELS_MAX="${LLAMA_MODELS_MAX:-2}"

if [[ ! -f "$PRESET" ]]; then
  echo "Models preset not found: $PRESET" >&2
  exit 1
fi

# Prefer the repo macos-arm64 build. `uname -m` can be x86_64 under Rosetta.
NATIVE="$(find "$ROOT/.tools/llama.cpp" -type f -name llama-server -print -quit 2>/dev/null || true)"
if [[ -n "$NATIVE" ]]; then
  SERVER="$NATIVE"
else
  SERVER="$(command -v llama-server || true)"
fi

if [[ -z "${SERVER:-}" || ! -x "$SERVER" ]]; then
  echo "llama-server not found. On Apple Silicon download macos-arm64 from" >&2
  echo "https://github.com/ggml-org/llama.cpp/releases into backend/.tools/llama.cpp" >&2
  exit 1
fi

echo "Using $SERVER"
file "$SERVER"
cd "$ROOT"
exec "$SERVER" --host "$HOST" --port "$PORT" \
  --models-preset "$PRESET" --models-max "$MODELS_MAX" --models-autoload
