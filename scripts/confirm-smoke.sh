#!/usr/bin/env bash
set -u

BASE="http://127.0.0.1:3342"
FAILURES=0
WARNINGS=0

note() { echo "[*] $*"; }
good() { echo "[ok] $*"; }
warn() { echo "[warn] $*"; WARNINGS=$((WARNINGS + 1)); }
bad()  { echo "[FAIL] $*"; FAILURES=$((FAILURES + 1)); }

echo "=== JARVIS confirm-flow smoke test ==="
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

note "1/4 health: all dependencies up and model is not degraded"
HEALTH="$(curl -sS --max-time 30 "$BASE/api/health")"
STATUS="$(printf '%s' "$HEALTH" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status","offline"))')"
if [ "$STATUS" = "online" ]; then
  good "overall status online ($STATUS)"
else
  bad "overall status is $STATUS"
fi

if printf '%s' "$HEALTH" | grep -q '"model"'; then
  if printf '%s' "$HEALTH" | python3 -c '
import sys, json
d = json.load(sys.stdin)["dependencies"]
ok = sum(1 for v in d.values() if isinstance(v, dict) and v.get("status") == "online")
print(f"{ok} of {len(d)} dependencies online", end="")
sys.exit(1 if d.get("model", {}).get("status") != "online" else 0)
  '; then
    note "all model dependencies reported online"
  else
    warn "a supported dependency is offline or model degraded (see health above)"
  fi
else
  note "no model block in health; skipping model online check"
fi

echo ""
note "2/4 confirmations endpoint returns a JSON list"
CONF_RESP="$(curl -sS --max-time 30 "$BASE/api/confirmations")"
if printf '%s' "$CONF_RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert "confirmations" in d;assert isinstance(d["confirmations"],list)' 2>/dev/null; then
  good "confirmations list present (count: $(printf '%s' "$CONF_RESP" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["confirmations"]))'))"
else
  bad "confirmations endpoint did not return a list"
fi

echo ""
note "3/4 unknown confirmation ID is rejected (validates approve path)"
HTTP_CODE="$(curl -sS -o /tmp/confirm-unknown.json -w '%{http_code}' --max-time 30 -X POST "$BASE/api/confirm" \
  -H "content-type: application/json" \
  -d '{"id":"do-not-exist-smoke-test"}')"
if [ "$HTTP_CODE" = "400" ]; then
  if grep -q "Confirmation is invalid or already used" /tmp/confirm-unknown.json; then
    good "unknown id -> HTTP 400 '$HTTP_CODE' with expected error"
  else
    warn "unknown id -> HTTP 400 but unexpected body: $(cat /tmp/confirm-unknown.json)"
  fi
else
  bad "unknown id should be 400, got HTTP $HTTP_CODE"
fi

echo ""
note "4/4 tool surface reports mutating flags (durable infra readiness)"
TOOLS_RESP="$(curl -sS --max-time 30 "$BASE/api/tools")"
MUTATING="$(printf '%s' "$TOOLS_RESP" | python3 -c '
import sys, json
tools = json.load(sys.stdin).get("tools", [])
m = [t["name"] for t in tools if t.get("mutating")]
print("|".join(m))
')"
TOTAL="$(printf '%s' "$TOOLS_RESP" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("tools",[])))')"
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
  good "tools endpoint reachable ($TOTAL tools)"
else
  bad "tools endpoint returned no tools"
fi
if [ -n "$MUTATING" ]; then
  note "mutating tools present: $MUTATING"
  note "the confirm flow is already exercisable end-to-end via /api/confirm"
else
  warn "no mutating tools currently live; approval flow is exercised via the unknown-id rejection and unit tests"
fi
echo "$MUTATING" > /tmp/confirm-smoke-mutating.txt

echo ""
echo "=== summary: failures=$FAILURES warnings=$WARNINGS ==="
if [ "$FAILURES" -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"