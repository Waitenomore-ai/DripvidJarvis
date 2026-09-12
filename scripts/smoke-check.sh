#!/usr/bin/env bash
# Operator smoke check: proves the live HUD/API surface answers health,
# tools, vault search, confirmations, and (optionally) brain recall.
#
# Usage:
#   BASE=http://127.0.0.1:42071 scripts/smoke-check.sh
#   scripts/smoke-check.sh --dry-run          # uses test/fixtures/smoke mocks
#
# SMOKE_MOCK_DIR can also be set to a directory of JSON fixtures (health.json,
# metrics.json, tools.json, vault.json, vault-search.json, confirmations.json,
# conversation.json). --dry-run defaults to test/fixtures/smoke relative to the
# script location.
#
# SMOKE_SKIP_CONVERSATION=1 skips the conversation recall check.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BASE="${BASE:-http://127.0.0.1:3342}"
MOCK_DIR="${SMOKE_MOCK_DIR:-}"

if [ "${1:-}" = "--dry-run" ] && [ -z "$MOCK_DIR" ]; then
  MOCK_DIR="$SCRIPT_DIR/../test/fixtures/smoke"
fi

FAILURES=0
WARNINGS=0
DRY=0
[ -n "$MOCK_DIR" ] && DRY=1

note() { echo "[*] $*"; }
good() { echo "[ok] $*"; }
warn() { echo "[warn] $*"; WARNINGS=$((WARNINGS + 1)); }
bad()  { echo "[FAIL] $*"; FAILURES=$((FAILURES + 1)); }

echo "=== JARVIS operator smoke check ==="
if [ "$DRY" -gt 0 ]; then
  echo "Mode: dry-run (mock dir: $MOCK_DIR)"
else
  echo "Target: $BASE"
fi
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

jq_path() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null
}

api_fetch() {
  local key="$1" url="$2"
  if [ -n "$MOCK_DIR" ] && [ -f "$MOCK_DIR/$key.json" ]; then
    cat "$MOCK_DIR/$key.json"
  else
    curl -fsS --max-time 30 "$url"
  fi
}

# ── 1/6 health ───────────────────────────────────────────────────────
note "1/6 health: core deps online, engine detail visible"
HEALTH="$(api_fetch health "$BASE/api/health")"
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

printf '%s' "$HEALTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)
deps=d.get("dependencies",{})
m=deps.get("model",{})
t=deps.get("tts",{})
print("  model provider=" + str(m.get("provider")) + " model=" + str(m.get("model")) + " latencyMs=" + str(m.get("latencyMs")))
print("  voice   mode=" + str(t.get("mode")) + " provider=" + str(t.get("provider")) + " error=" + repr(t.get("error")))
' || warn "could not print engine detail"

# ── 2/6 metrics ──────────────────────────────────────────────────────
note "2/6 metrics: cpu/memory/storage/usn endpoints present"
METRICS="$(api_fetch metrics "$BASE/api/metrics")"
printf '%s' "$METRICS" | python3 -c 'import sys,json;d=json.load(sys.stdin);sys.exit(0 if d else 1)' \
  && good "metrics endpoint returns JSON" || bad "metrics endpoint failed"

# ── 3/6 tools flight check ───────────────────────────────────────────
note "3/6 tools: inventory + flight-check (required tools present, names unique)"
TOOLS="$(api_fetch tools "$BASE/api/tools")"
TOTAL="$(printf '%s' "$TOOLS" | jq_path "len(d.get('tools',[]))")"
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
  good "tools endpoint reachable ($TOTAL tools)"
else
  bad "tools endpoint returned no tools"
fi

printf '%s' "$TOOLS" | python3 -c '
import sys,json
tools=json.load(sys.stdin).get("tools",[])
names=[t.get("name","") for t in tools]
missing_required=[n for n in ("brain.recall","vault.search","dripvid.health") if n not in names]
dupes=[n for n in set(names) if names.count(n)>1]
mut=[t["name"] for t in tools if t.get("mutating")]
ro=[t["name"] for t in tools if not t.get("mutating")]
if missing_required:
    print("FAIL required missing: " + "|".join(missing_required))
    sys.exit(1)
if dupes:
    print("FAIL duplicate names: " + "|".join(dupes))
    sys.exit(1)
print("mutating(" + str(len(mut)) + "): " + ("|".join(mut) if mut else "(none)"))
print("read-only(" + str(len(ro)) + "): " + ("|".join(ro) if ro else "(none)"))
' && good "tools flight check passed" || bad "tools flight check failed"

# ── 4/6 vault ────────────────────────────────────────────────────────
note "4/6 vault: stats and seeded-knowledge search"
VAULT="$(api_fetch vault "$BASE/api/vault")"
COUNT="$(printf '%s' "$VAULT" | jq_path "d.get('noteCount',0)")"
if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ]; then
  good "vault indexed ($COUNT notes)"
else
  bad "vault noteCount is 0 or missing"
fi
SEARCH="$(api_fetch vault-search "$BASE/api/vault/search?q=deploy")"
SEARCH_HITS="$(printf '%s' "$SEARCH" | jq_path "len(d.get('notes',[]))")"
if [ -n "$SEARCH_HITS" ] && [ "$SEARCH_HITS" -gt 0 ]; then
  good "vault search non-empty ($SEARCH_HITS hit(s) for 'deploy')"
else
  warn "vault search returned no notes for 'deploy'"
fi

# ── 5/6 confirmations ────────────────────────────────────────────────
note "5/6 confirmations: list endpoint is reachable"
CONF="$(api_fetch confirmations "$BASE/api/confirmations")"
printf '%s' "$CONF" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert "confirmations" in d and isinstance(d["confirmations"],list)' \
  && good "confirmations list present" || bad "confirmations endpoint failed"

# ── 6/6 conversation recall (optional) ───────────────────────────────
note "6/6 conversation recall (optional): prompt asks for remembered context"
if [ "${SMOKE_SKIP_CONVERSATION:-0}" = "1" ] || [ "$DRY" -gt 0 ]; then
  note "conversation check skipped (SMOKE_SKIP_CONVERSATION=1 or dry-run)"
else
  REPLY="$(api_fetch conversation "$BASE/api/conversation")"
  MEMORIES="$(printf '%s' "$REPLY" | jq_path "len(d.get('context',{}).get('memories',[]))" 2>/dev/null)"
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
