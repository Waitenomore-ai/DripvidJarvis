#!/usr/bin/env bash
# Real model smoke test for JARVIS Workforce.
# Tests the configured JARVIS router through /api/provider/test.
# Kept separate from deployment health because model loading can be slow.
set -u

URL="${JARVIS_PROVIDER_TEST_URL:-http://127.0.0.1:3342/api/provider/test}"
TIMEOUT="${JARVIS_PROVIDER_TEST_TIMEOUT_SECONDS:-180}"

echo "=== JARVIS Workforce real model smoke test ==="
echo "Endpoint: $URL"
echo "Timeout:  ${TIMEOUT}s"
echo

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! curl -sS --max-time "$TIMEOUT" \
  -X POST "$URL" \
  -H 'content-type: application/json' \
  -d '{}' >"$tmp"
then
  echo "[FAIL] Could not complete the JARVIS provider test."
  exit 1
fi

cat "$tmp"
echo

ok="$(python3 - "$tmp" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    data = json.load(fh)
print("true" if data.get("ok") is True else "false")
PY
)"

if [ "$ok" = "true" ]; then
  echo
  echo "RESULT: PASS"
  echo "JARVIS completed a real model request."
  exit 0
fi

echo
echo "RESULT: FAIL"
echo "JARVIS health may still be green, but a real model request failed."
exit 1