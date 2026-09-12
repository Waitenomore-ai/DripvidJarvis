#!/usr/bin/env bash
# Operator smoke check: proves the live HUD/API surface answers health,
# tools, vault search, confirmations, and (optionally) brain recall.
# Usage: BASE=http://127.0.0.1:42071 scripts/smoke-check.sh
set -u

BASE="${BASE:-http://127.0.0.1:3342}"
FAILURES=0
WARNINGS=0

note() { echo "[*] $*"; }
good() { echo "[ok] $*"; }
warn() { echo "[warn] $*"; WARNINGS=$((WARNINGS + 1)); }
bad()  { echo "[FAIL] $*"; FAILURES=$((FAILURES + 1)); }

echo "=== JARVIS operator smoke check ==="
echo "Target: $BASE"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

jq_path() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null
}

note "1/6 health: brain, model and vault online; dripvid/mcp are env-dependent"
HEALTH="$(curl -sS --max-time 30 "$BASE/api/health")"
STATUS="$(printf '%s' "$HEALTH" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status","offline"))')"
case "$STATUS" in
  online) good "overall status online" ;;
  degraded|offline)
    printf '%s' "$HEALTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)["dependencies"]
req=["brain","model","vault"]
missing=[k for k in req if d.get(k,{}).get("status")!="online"]
if not missing:
    print("OK core deps online")
else:
    print("MISSING:"+"|".join(missing)); sys.exit(1)
' && good "status $STATUS but core deps (brain/model/vault) online" || bad "core dep offline: overall=$STATUS"
    ;;
esac
printf '%s' "$HEALTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)["dependencies"]
print("core:", {k:d.get(k,{}).get("status") for k in ("dripvid","mcp","brain","model","vault","tts")})
'

echo ""
note "2/6 metrics: cpu/memory/storage/usn endpoints present"
METRICS="$(curl -sS --max-time 30 "$BASE/api/metrics")"
printf '%s' "$METRICS" | python3 -c 'import sys,json;d=json.load(sys.stdin);sys.exit(0 if d else 1)' \
  && good "metrics endpoint returns JSON" || bad "metrics endpoint failed"

echo ""
note "3/6 tools: read-only inventory surfaces mutating flags"
TOOLS="$(curl -sS --max-time 30 "$BASE/api/tools")"
TOTAL="$(printf '%s' "$TOOLS" | jq_path "len(d.get('tools',[]))")"
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
  good "tools endpoint reachable ($TOTAL tools)"
else
  bad "tools endpoint returned no tools"
fi
printf '%s' "$TOOLS" | python3 -c 'import sys,json;m=[t["name"] for t in json.load(sys.stdin).get("tools",[]) if t.get("mutating")];print("mutating:","|".join(m) if m else "(none)")'

echo ""
note "4/6 vault: stats and seeded-knowledge search"
VAULT="$(curl -sS --max-time 30 "$BASE/api/vault")"
COUNT="$(printf '%s' "$VAULT" | jq_path "d.get('noteCount',0)")"
if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ]; then
  good "vault indexed ($COUNT notes)"
else
  bad "vault noteCount is 0 or missing"
fi
SEARCH="$(curl -sS --max-time 30 "$BASE/api/vault/search?q=deploy")"
SEARCH_HITS="$(printf '%s' "$SEARCH" | jq_path "len(d.get('notes',[]))")"
if [ -n "$SEARCH_HITS" ] && [ "$SEARCH_HITS" -gt 0 ]; then
  good "vault search non-empty ($SEARCH_HITS hit(s) for 'deploy')"
else
  warn "vault search returned no notes for 'deploy'"
fi

echo ""
note "5/6 confirmations: list endpoint is reachable"
CONF="$(curl -sS --max-time 30 "$BASE/api/confirmations")"
printf '%s' "$CONF" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert "confirmations" in d and isinstance(d["confirmations"],list)' \
  && good "confirmations list present" || bad "confirmations endpoint failed"

echo ""
note "6/6 conversation recall (optional): prompt asks for remembered context"
if [ "${SMOKE_SKIP_CONVERSATION:-0}" = "1" ]; then
  note "conversation check skipped (SMOKE_SKIP_CONVERSATION=1)"
else
  REPLY="$(curl -sS --max-time 120 -X POST "$BASE/api/conversation" \
    -H "content-type: application/json" \
    -d '{"message":"What do you remember about DripVid deployment?"}' 2>/dev/null)"
  MEMORIES="$(printf '%s' "$REPLY" | jq_path "len(d.get('context',{}).get('memories',[]))")"
  if [ -n "$MEMORIES" ] && [ "$MEMORIES" -gt 0 ]; then
    good "conversation returned $MEMORIES memory/memories from the brain"
  else
    warn "conversation did not surface memories (model may be degraded or provider off)"
  fi
fi

echo ""
echo "=== summary: failures=$FAILURES warnings=$WARNINGS ==="
if [ "$FAILURES" -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"