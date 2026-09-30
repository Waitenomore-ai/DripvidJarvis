#!/usr/bin/env bash
# Post-deployment health check for the live JARVIS Workforce HQ service.
#
# Usage:
#   JARVIS_HEALTH_URL=http://127.0.0.1:3342/api/health \
#   JARVIS_WORKFORCE_URL=http://127.0.0.1:3342/workforce \
#   scripts/deployment-health-check.sh
#
# The check retries for a short startup window so a normal service restart does
# not immediately fail the deployment. Failures include the target URL and the
# HTTP/error detail so GitHub Actions logs are actionable.
set -u

HEALTH_URL="${JARVIS_HEALTH_URL:-}"
WORKFORCE_URL="${JARVIS_WORKFORCE_URL:-}"
RETRIES="${JARVIS_HEALTH_RETRIES:-12}"
DELAY="${JARVIS_HEALTH_DELAY_SECONDS:-5}"

if [ -z "$HEALTH_URL" ]; then
  echo "[FAIL] JARVIS_HEALTH_URL is not configured. Set it to the deployed /api/health endpoint."
  exit 1
fi

if [ -z "$WORKFORCE_URL" ]; then
  echo "[FAIL] JARVIS_WORKFORCE_URL is not configured. Set it to the deployed /workforce endpoint."
  exit 1
fi

check_health() {
  local body status
  body="$(curl -fsS --max-time 10 "$HEALTH_URL" 2>&1)" || {
    echo "[FAIL] health request failed: $HEALTH_URL"
    echo "       $body"
    return 1
  }

  status="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  if [ "$status" != "online" ]; then
    echo "[FAIL] JARVIS health status is '$status' (expected 'online'): $HEALTH_URL"
    echo "       $body"
    return 1
  fi

  echo "[ok] JARVIS health is online: $HEALTH_URL"
  return 0
}

check_workforce() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$WORKFORCE_URL" 2>&1)" || {
    echo "[FAIL] workforce request failed: $WORKFORCE_URL"
    echo "       $code"
    return 1
  }

  case "$code" in
    2*|3*) echo "[ok] Workforce HQ responded with HTTP $code: $WORKFORCE_URL"; return 0 ;;
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
  health_ok=0
  workforce_ok=0
  check_health && health_ok=1 || true
  check_workforce && workforce_ok=1 || true

  if [ "$health_ok" -eq 1 ] && [ "$workforce_ok" -eq 1 ]; then
    echo ""
    echo "RESULT: PASS"
    echo "JARVIS Workforce HQ is responding after deployment."
    exit 0
  fi

  if [ "$attempt" -lt "$RETRIES" ]; then
    echo "[*] Service is not ready yet; waiting ${DELAY}s before retry."
    sleep "$DELAY"
  fi
done

echo ""
echo "RESULT: FAIL"
echo "JARVIS Workforce HQ did not become healthy after deployment."
echo "Check the JARVIS service logs and deployment runner before treating this deployment as successful."
exit 1
