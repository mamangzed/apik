#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/backend/.env"

read_env_port() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    return 1
  fi

  local value
  value="$(grep -E '^PORT=' "${ENV_FILE}" | tail -n 1 | cut -d'=' -f2- | tr -d '[:space:]')"
  if [[ -z "${value}" ]]; then
    return 1
  fi

  printf '%s' "${value}"
  return 0
}

default_port="2611"
if detected_port="$(read_env_port 2>/dev/null)"; then
  default_port="${detected_port}"
fi

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${default_port}}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
MONITOR_KEY="${INTERCEPT_MONITOR_KEY:-}"

endpoint="${API_BASE_URL%/}/api/intercept/monitor"
health_endpoint="${API_BASE_URL%/}/health"

if [[ -n "${MONITOR_KEY}" ]]; then
  endpoint="${endpoint}?key=${MONITOR_KEY}"
fi

echo "[proxy-monitor] backend_env=${ENV_FILE}"
echo "[proxy-monitor] endpoint=${endpoint}"
echo "[proxy-monitor] health=${health_endpoint}"
echo "[proxy-monitor] interval=${INTERVAL_SECONDS}s"

total_seen=0

while true; do
  now="$(date '+%Y-%m-%d %H:%M:%S')"

  monitor_code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "${endpoint}" || echo 000)"

  if [[ "${monitor_code}" != "200" ]]; then
    health_code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "${health_endpoint}" || echo 000)"

    if [[ "${health_code}" == "200" && "${monitor_code}" == "404" ]]; then
      echo "${now} | ERROR | monitor route 404 (backend hidup, tapi endpoint /api/intercept/monitor belum ada). Rebuild + restart backend."
    elif [[ "${health_code}" == "200" ]]; then
      echo "${now} | ERROR | monitor endpoint status=${monitor_code} (backend hidup)."
    else
      echo "${now} | ERROR | backend tidak terjangkau (health=${health_code}, monitor=${monitor_code})."
    fi

    sleep "${INTERVAL_SECONDS}"
    continue
  fi

  response="$(curl -sS --max-time 8 "${endpoint}" || true)"
  if [[ -z "${response}" ]]; then
    echo "${now} | ERROR | empty monitor payload"
    sleep "${INTERVAL_SECONDS}"
    continue
  fi

  parsed="$(printf '%s' "${response}" | node -e "
let data = '';
process.stdin.on('data', (chunk) => data += chunk);
process.stdin.on('end', () => {
  try {
    const json = JSON.parse(data);
    const stats = json.stats || {};
    const fields = [
      json.status || 'unknown',
      json.ok ? '1' : '0',
      String(json.host || '-'),
      String(json.port || '-'),
      String(json.latencyMs || 0),
      String(stats.captureRequests || 0),
      String(stats.captureResponses || 0),
      String(stats.authFailures || 0),
      stats.lastRequestAt ? new Date(stats.lastRequestAt).toISOString() : '-',
      stats.lastResponseAt ? new Date(stats.lastResponseAt).toISOString() : '-',
    ];
    process.stdout.write(fields.join('|'));
  } catch {
    process.exit(2);
  }
});
" 2>/dev/null || true)"

  if [[ -z "${parsed}" ]]; then
    echo "${now} | ERROR | invalid monitor payload"
    sleep "${INTERVAL_SECONDS}"
    continue
  fi

  IFS='|' read -r status ok host port latency captured responses auth_fail last_req last_res <<< "${parsed}"

  alert=""
  if [[ "${ok}" != "1" ]]; then
    alert=" | ALERT: proxy unreachable"
  fi

  if [[ "${captured}" -gt "${total_seen}" ]]; then
    delta=$((captured - total_seen))
    alert="${alert} | INCOMING: +${delta} request"
  fi

  total_seen="${captured}"

  echo "${now} | ${status} | ${host}:${port} | ${latency}ms | req=${captured} res=${responses} authFail=${auth_fail} | lastReq=${last_req} lastRes=${last_res}${alert}"

  sleep "${INTERVAL_SECONDS}"
done