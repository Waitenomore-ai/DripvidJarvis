#!/usr/bin/env bash
# Diagnose qwen3.5:4b on the JARVIS host without changing the production service.
set -u

GPU_URL="${OLLAMA_GPU_URL:-http://127.0.0.1:11434}"
CPU_URL="${OLLAMA_CPU_URL:-http://127.0.0.1:11435}"
GPU_TIMEOUT="${OLLAMA_GPU_TEST_TIMEOUT_SECONDS:-180}"
CPU_TIMEOUT="${OLLAMA_CPU_TEST_TIMEOUT_SECONDS:-300}"
PID=""

cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  pkill -f "OLLAMA_HOST=127.0.0.1:11435.*ollama serve" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== JARVIS QWEN3.5 GPU / CPU ISOLATION ==="
echo

echo "=== 1. GPU-BACKED TEST (CURRENT PRODUCTION OLLAMA) ==="
GPU_START=$(date +%s)
GPU_RESULT="$(curl -sS --max-time "$GPU_TIMEOUT" "$GPU_URL/api/chat" \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3.5:4b","messages":[{"role":"user","content":"Reply with exactly: QWEN_GPU_OK"}],"stream":false}' 2>&1)"
GPU_RC=$?
GPU_END=$(date +%s)
echo "elapsed=$((GPU_END-GPU_START))s rc=$GPU_RC"
printf '%s\n' "$GPU_RESULT" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$GPU_RESULT"

echo
echo "=== 2. START TEMPORARY CPU-ONLY OLLAMA ==="
nohup env OLLAMA_HOST=127.0.0.1:11435 OLLAMA_VULKAN=0 OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_CONTEXT_LENGTH=4096 ollama serve >/tmp/ollama-cpu-isolation.log 2>&1 &
PID=$!

for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "$CPU_URL/api/version" >/dev/null 2>&1; then
    echo "[ok] CPU-only Ollama is ready."
    break
  fi
  echo "[*] Waiting for CPU-only Ollama... ($i/30)"
  sleep 1
done

echo
echo "=== 3. CPU-ONLY QWEN3.5 TEST ==="
CPU_START=$(date +%s)
CPU_RESULT="$(curl -sS --max-time "$CPU_TIMEOUT" "$CPU_URL/api/chat" \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3.5:4b","messages":[{"role":"user","content":"Reply with exactly: QWEN_CPU_OK"}],"stream":false,"options":{"num_ctx":4096,"num_predict":8}' 2>&1)"
CPU_RC=$?
CPU_END=$(date +%s)
echo "elapsed=$((CPU_END-CPU_START))s rc=$CPU_RC"
printf '%s\n' "$CPU_RESULT" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$CPU_RESULT"

echo
echo "=== 4. CPU TEST LOG ==="
tail -n 80 /tmp/ollama-cpu-isolation.log || true

echo
echo "=== 5. INTERPRETATION ==="
if [ "$CPU_RC" -eq 0 ] && printf '%s' "$CPU_RESULT" | grep -q 'QWEN_CPU_OK'; then
  echo "CPU_OK=1"
else
  echo "CPU_OK=0"
fi
if [ "$GPU_RC" -eq 0 ] && printf '%s' "$GPU_RESULT" | grep -q 'QWEN_GPU_OK'; then
  echo "GPU_OK=1"
else
  echo "GPU_OK=0"
fi

echo
echo "=== 6. FINAL OLLAMA SERVICE ==="
sudo systemctl is-enabled ollama.service || true
sudo systemctl is-active ollama.service || true
echo
echo "Diagnostic complete."