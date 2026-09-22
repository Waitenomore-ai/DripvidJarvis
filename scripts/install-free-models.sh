#!/usr/bin/env bash
set -euo pipefail

OLLAMA_BIN="${OLLAMA_BIN:-ollama}"
MODELS=(
  "qwen3.5:4b"
  "phi4-mini:3.8b"
  "qwen2.5-coder:3b"
  "llama3.2:3b"
)

command -v "$OLLAMA_BIN" >/dev/null 2>&1 || {
  echo "Ollama is not installed or is not on PATH: $OLLAMA_BIN" >&2
  exit 1
}

echo "JARVIS FREE MODEL POOL"
echo "Installing only local/open models; no paid API is used."
echo

for model in "${MODELS[@]}"; do
  echo "==> $model"
  "$OLLAMA_BIN" pull "$model"
done

echo
echo "Installed free model pool:"
"$OLLAMA_BIN" list
