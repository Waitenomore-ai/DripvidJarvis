#!/usr/bin/env bash
set -u

BASE="http://127.0.0.1:3342"
DATA="/opt/dripvid-jarvis/data"
LOG="$DATA/auto-verify.log"
STATE="$DATA/auto-verify.state"
RESULT="$DATA/auto-verify.result"
BRAIN="$DATA/brain.json"

MARKER="daily automated verification pass"
TODAY="$(date -u +%F)"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"
}

chat() {
  curl -sS --max-time 300 -X POST "$BASE/api/conversation" \
    -H "content-type: application/json" \
    -d "{\"conversation\":[{\"role\":\"user\",\"content\":\"$1\"}]}" \
  || echo '{"ok":false,"degraded":true}'
}

write_result() {
  local STATUS="$1" ATTEMPTS="$2" STEPS="$3"
  printf '{"status":"%s","attempts":%s,"steps":{%s},"updatedAt":"%s"}\n' \
    "$STATUS" "$ATTEMPTS" "$STEPS" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RESULT"
}

stamp_done() {
  echo "$TODAY $(date -u +%H:%M:%SZ)" > "$STATE"
}

notify() {
  local MSG="$1" PRIO="3" TAGS="white_check_mark"
  if printf '%s' "$MSG" | grep -q 'FAILED'; then
    PRIO="4"
    TAGS="warning"
  fi
  if [ -n "${JARVIS_VERIFY_WEBHOOK_URL:-}" ]; then
    if ! curl -sS --max-time 10 -X POST "$JARVIS_VERIFY_WEBHOOK_URL" \
      -H "Title: JARVIS auto-verify" \
      -H "Priority: $PRIO" \
      -H "Tags: $TAGS" \
      -d "$MSG" >/dev/null 2>&1; then
      log "notify webhook publish failed"
    fi
  fi
  if command -v pterm >/dev/null 2>&1; then
    pterm push "$MSG" >/dev/null 2>&1 || true
  else
    local PTERM_PATH
    PTERM_PATH="$(curl -sS --max-time 5 http://127.0.0.1:42000/pinokio/path/pterm 2>/dev/null \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("path",""))' 2>/dev/null || true)"
    if [ -n "$PTERM_PATH" ] && [ -x "$PTERM_PATH" ]; then
      "$PTERM_PATH" push "$MSG" >/dev/null 2>&1 || true
    fi
  fi
}

log "auto-verify started"

if [ -f "$STATE" ]; then
  DONE="$(cut -d' ' -f1 "$STATE" 2>/dev/null || true)"
  if [ "$DONE" = "$TODAY" ]; then
    log "already completed today; exiting"
    exit 0
  fi
fi

ATTEMPTS=0
DEGRADED="true"

while [ "$ATTEMPTS" -lt 240 ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  RESP="$(chat 'Say exactly OK')"
  if printf '%s' "$RESP" | grep -q '"degraded"[[:space:]]*:[[:space:]]*true'; then
    if [ $((ATTEMPTS % 20)) -eq 0 ]; then
      log "still degraded after $ATTEMPTS attempts"
    fi
    sleep 30
  else
    DEGRADED="false"
    log "real reply received on attempt $ATTEMPTS"
    echo "$RESP" >> "$LOG"
    break
  fi
done

if [ "$DEGRADED" = "true" ]; then
  log "STILL DEGRADED after $ATTEMPTS attempts; aborting"
  stamp_done
  write_result "failed" "$ATTEMPTS" "\"chat\":false"
  notify "JARVIS auto-verify FAILED: still degraded after $ATTEMPTS attempts"
  exit 1
fi

TOOL_RESP="$(chat 'Show disk usage')"
echo "$TOOL_RESP" >> "$LOG"
TOOL_OK="false"
if printf '%s' "$TOOL_RESP" | grep -q 'disk_status'; then
  TOOL_OK="true"
  log "tool-call leg passed (mcp.disk_status present)"
else
  log "tool-call leg failed (no disk_status in reply)"
fi

TEACH_OK="skipped"
if [ -f "$BRAIN" ] && grep -q "$MARKER" "$BRAIN"; then
  TEACH_OK="skipped"
  log "brain teach skipped (marker already stored)"
else
  TEACH_RESP="$(chat "Remember a new fact in your brain. The fact is: the operator runs a $MARKER.")"
  echo "$TEACH_RESP" >> "$LOG"
  if [ -f "$BRAIN" ] && grep -q "$MARKER" "$BRAIN"; then
    TEACH_OK="true"
    log "brain teach leg passed (marker stored)"
  else
    TEACH_OK="false"
    log "brain teach leg incomplete (marker not found in brain.json)"
  fi
fi

RECALL_RESP="$(chat 'Recall anything you remember about a daily automated verification pass.')"
echo "$RECALL_RESP" >> "$LOG"
RECALL_OK="false"
if printf '%s' "$RECALL_RESP" | grep -q '"degraded"[[:space:]]*:[[:space:]]*true'; then
  log "recall leg degraded"
  write_result "failed" "$ATTEMPTS" "\"chat\":true,\"tool\":$TOOL_OK,\"teach\":\"$TEACH_OK\",\"recall\":false"
  notify "JARVIS auto-verify FAILED: recall leg degraded"
  stamp_done
  exit 1
fi
RECALL_OK="true"
log "recall leg returned non-degraded reply"

stamp_done
write_result "ok" "$ATTEMPTS" "\"chat\":true,\"tool\":$TOOL_OK,\"teach\":\"$TEACH_OK\",\"recall\":true"
log "auto-verify completed successfully"
notify "JARVIS auto-verify OK: tool=$TOOL_OK teach=$TEACH_OK recall=true attempts=$ATTEMPTS"