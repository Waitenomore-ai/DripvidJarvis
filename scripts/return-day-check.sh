#!/usr/bin/env bash
# Return-day verification for the DripVid JARVIS Workforce stack.
set -u

BASE="${BASE:-http://127.0.0.1:3342}"
TIMEOUT="${JARVIS_PROVIDER_TEST_TIMEOUT_SECONDS:-180}"

echo "=== DRIPVID JARVIS RETURN-DAY CHECK ==="
echo "Base: $BASE"
echo

fail=0
check_service() {
  local name="$1"
  if systemctl is-active --quiet "$name"; then
    echo "[ok] $name active"
  else
    echo "[FAIL] $name is not active"
    fail=1
  fi
}

check_service ollama.service
check_service dripvid-jarvis-mcp.service
check_service dripvid-jarvis.service

echo
echo "=== CORE HTTP CHECKS ==="
if curl -fsS --max-time 10 "$BASE/api/health" >/tmp/jarvis-return-health.json; then
  echo "[ok] /api/health"
else
  echo "[FAIL] /api/health"
  fail=1
fi

if code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/workforce")" && [ "${code:0:1}" = "2" ]; then
  echo "[ok] /workforce HTTP $code"
else
  echo "[FAIL] /workforce HTTP ${code:-unknown}"
  fail=1
fi

echo
echo "=== DEPENDENCY SUMMARY ==="
python3 - <<'PY'
import json
with open('/tmp/jarvis-return-health.json', encoding='utf-8') as fh:
    d=json.load(fh)
deps=d.get('dependencies', {})
for key in ('dripvid','mcp','brain','model','vault','tts'):
    item=deps.get(key,{})
    print(f"{key:8} {item.get('status','unknown'):8} {item.get('model') or item.get('provider') or ''}")
PY

echo
echo "=== REAL JARVIS MODEL REQUEST ==="
if result="$(curl -sS --max-time "$TIMEOUT" -X POST "$BASE/api/provider/test" -H 'content-type: application/json' -d '{}')"; then
  printf '%s\n' "$result" | python3 -m json.tool || true
  if printf '%s' "$result" | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("ok") is True else 1)'; then
    echo "[ok] real model request succeeded"
  else
    echo "[FAIL] real model request failed"
    fail=1
  fi
else
  echo "[FAIL] provider test request failed or timed out"
  fail=1
fi

echo
echo "=== FINAL RESULT ==="
if [ "$fail" -eq 0 ]; then
  echo "RESULT: PASS"
  exit 0
fi
echo "RESULT: FAIL"
exit 1