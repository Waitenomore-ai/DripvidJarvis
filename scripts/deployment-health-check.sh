#!/usr/bin/env bash
# Post-deployment health check for JARVIS.
#
# Critical checks:
#   * the JARVIS HTTP service responds
#   * Workforce HQ responds
#   * at least one model provider is online (required to execute workforce work)
#
# MCP is reported as a warning because the HQ can run without it.
set -u

HEALTH_URL="${JARVIS_HEALTH_URL:-}"
WORKFORCE_URL="${JARVIS_WORKFORCE_URL:-}"
RETRIES="${JARVIS_HEALTH_RETRIES:-12}"
DELAY="${JARVIS_HEALTH_DELAY_SECONDS:-5}"

if [ -z "$HEALTH_URL" ]; then
  echo "[FAIL] JARVIS_HEALTH_URL is not configured."
  exit 1
fi

if [ -z "$WORKFORCE_URL" ]; then
  echo "[FAIL] JARVIS_WORKFORCE_URL is not configured."
  exit 1
fi

fetch_health() {
  curl -fsS --max-time 10 "$HEALTH_URL" 2>&1
}

check_service() {
  local body status model_status model_name model_error mcp_status mcp_error
  body="$(fetch_health)" || {
    echo "[FAIL] JARVIS health request failed: $HEALTH_URL"
    echo "       $body"
    return 1
  }

  status="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"

  case "$status" in
    online|degraded)
      echo "[ok] JARVIS HTTP service is running (status=$status)"
      ;;
    *)
      echo "[FAIL] JARVIS returned unexpected status='$status': $HEALTH_URL"
      echo "       $body"
      return 1
      ;;
  esac

  model_status="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("dependencies",{}).get("model",{}).get("status",""))' 2>/dev/null || true)"
  model_name="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("dependencies",{}).get("model",{}).get("model",""))' 2>/dev/null || true)"
  model_error="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("dependencies",{}).get("model",{}).get("error",""))' 2>/dev/null || true)"

  if [ "$model_status" = "online" ]; then
    echo "[ok] Workforce model provider is online: $model_name"
  else
    echo "[FAIL] Workforce model provider is offline: $model_name"
    [ -n "$model_error" ] && echo "       $model_error"
    return 1
  fi

  mcp_status="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("dependencies",{}).get("mcp",{}).get("status",""))' 2>/dev/null || true)"
  mcp_error="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("dependencies",{}).get("mcp",{}).get("error",""))' 2>/dev/null || true)"
  if [ "$mcp_status" = "online" ]; then
    echo "[ok] MCP is online"
  else
    echo "[warn] MCP is offline; MCP-backed tools may be unavailable"
    [ -n "$mcp_error" ] && echo "       $mcp_error"
  fi

  return 0
}

check_workforce() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$WORKFORCE_URL" 2>&1)" || {
    echo "[FAIL] Workforce HQ request failed: $WORKFORCE_URL"
    echo "       $code"
    return 1
  }

  case "$code" in
    2*) echo "[ok] Workforce HQ responded with HTTP $code: $WORKFORCE_URL"; return 0 ;;
    3*) echo "[warn] Workforce HQ redirected with HTTP $code: $WORKFORCE_URL"; return 0 ;;
    *) echo "[FAIL] Workforce HQ returned HTTP $code: $WORKFORCE_URL"; return 1 ;;
  esac
}

echo "=== JARVIS Workforce deployment health check ==="
echo "Health endpoint:    $HEALTH_URL"
echo "Workforce endpoint: $WORKFORCE_URL"
echo "Retries:            $RETRIES"
echo ""

for attempt in $(seq 1 "$RETRIES"); do
  echo "[*] Attempt $attempt/$RETRIES"
  service_ok=0
  workforce_ok=0

  check_service && service_ok=1 || true
  check_workforce && workforce_ok=1 || true

  if [ "$service_ok" -eq 1 ] && [ "$workforce_ok" -eq 1 ]; then
    echo ""
    echo "RESULT: PASS"
    echo "JARVIS Workforce HQ is responding and has a usable model provider."
    exit 0
  fi

  if [ "$attempt" -lt "$RETRIES" ]; then
    echo "[*] Deployment not healthy yet; waiting ${DELAY}s before retry."
    sleep "$DELAY"
  fi
done

echo ""
echo "RESULT: FAIL"
echo "JARVIS Workforce HQ deployment health check failed."
echo "Check systemd logs and the model/MCP services before treating this deployment as healthy."
exit 1
