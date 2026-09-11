#!/usr/bin/env bash
set -u

BASE="http://127.0.0.1:3342"
DATA="/opt/dripvid-jarvis/data"
LOG="$DATA/auto-verify.log"
STATE="$DATA/auto-verify.state"
BRAIN="$DATA/brain.json"

MARKER="daily automated verification pass"
TODAY="$(date -u +%F)"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"
}

chat() {
  curl -sS --max-time 120 -X POST "$BASE/api/conversation" \
    -H "content-type: application/json" \
    -d "{\"prompt\":\"$1\"}" \
  || echo '{"ok":false,"degraded":true}'
}

stamp_done() {
  echo "$TODAY $(date -u +%H:%M:%SZ)" > "$STATE"
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
  exit 1
fi

TOOL_RESP="$(chat 'Show disk usage')"
echo "$TOOL_RESP" >> "$LOG"
if printf '%s' "$TOOL_RESP" | grep -q 'disk_status'; then
  log "tool-call leg passed (mcp.disk_status present)"
else
  log "tool-call leg failed (no disk_status in reply)"
  stamp_done
  exit 1
fi

if [ -f "$BRAIN" ] && grep -q "$MARKER" "$BRAIN"; then
  log "brain teach skipped (marker already stored)"
else
  TEACH_RESP="$(chat "Remember a new fact in your brain. The fact is: the operator runs a $MARKER.")"
  echo "$TEACH_RESP" >> "$LOG"
  if [ -f "$BRAIN" ] && grep -q "$MARKER" "$BRAIN"; then
    log "brain teach leg passed (marker stored)"
  else
    log "brain teach leg incomplete (marker not found in brain.json)"
  fi
fi

RECALL_RESP="$(chat 'Recall anything you remember about a daily automated verification pass.')"
echo "$RECALL_RESP" >> "$LOG"
if printf '%s' "$RECALL_RESP" | grep -q '"degraded"[[:space:]]*:[[:space:]]*true'; then
  log "recall leg degraded"
  stamp_done
  exit 1
fi
log "recall leg returned non-degraded reply"

stamp_done
log "auto-verify completed successfully"