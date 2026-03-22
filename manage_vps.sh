#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-apik-backend}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env"
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO_CMD=""
else
  SUDO_CMD="sudo -n"
fi

run_privileged() {
  if [ -n "$SUDO_CMD" ]; then
    # Fail fast if sudo password is required to avoid silent hangs.
    if ! sudo -n true >/dev/null 2>&1; then
      echo "sudo requires password. Run with sudo or login as root on VPS."
      exit 1
    fi
    $SUDO_CMD "$@"
    return
  fi

  "$@"
}

read_env_value() {
  local key="$1"
  local default_value="$2"
  if [ ! -f "$ENV_FILE" ]; then
    printf '%s' "$default_value"
    return
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    printf '%s' "$default_value"
    return
  fi
  printf '%s' "${line#*=}"
}

collect_listener_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      timeout 2 lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
    else
      lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
    fi
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      timeout 2 ss -ltnp "sport = :$port" 2>/dev/null \
        | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
        | sort -u || true
    else
      ss -ltnp "sport = :$port" 2>/dev/null \
        | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
        | sort -u || true
    fi
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      timeout 2 fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true
    else
      fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true
    fi
  fi
}

cleanup_stale_backend_listeners() {
  local backend_port transparent_port proxy_range
  backend_port="$(read_env_value PORT 2611)"
  transparent_port="$(read_env_value INTERCEPT_WIREGUARD_TRANSPARENT_PORT 18080)"
  proxy_range="$(read_env_value INTERCEPT_PROXY_PORT_RANGE '')"

  local ports=()
  ports+=("$backend_port")
  if [[ "$transparent_port" =~ ^[0-9]{1,5}$ ]]; then
    ports+=("$transparent_port")
  fi

  if [[ "$proxy_range" =~ ^([0-9]{2,5})-([0-9]{2,5})$ ]]; then
    local start="${BASH_REMATCH[1]}"
    local end="${BASH_REMATCH[2]}"
    local p
    for (( p=start; p<=end; p++ )); do
      ports+=("$p")
    done
  else
    local single_proxy
    single_proxy="$(read_env_value INTERCEPT_PROXY_PORT 8080)"
    if [[ "$single_proxy" =~ ^[0-9]{1,5}$ ]]; then
      ports+=("$single_proxy")
    fi
  fi

  local all_pids=()
  local port pid
  for port in "${ports[@]}"; do
    while IFS= read -r pid; do
      [ -n "$pid" ] && all_pids+=("$pid")
    done < <(collect_listener_pids "$port")
  done

  if [ "${#all_pids[@]}" -eq 0 ]; then
    echo "No stale listeners detected on backend/proxy ports."
    return
  fi

  mapfile -t unique_pids < <(printf '%s\n' "${all_pids[@]}" | sort -u)
  echo "Stopping stale listener PIDs: ${unique_pids[*]}"
  kill -TERM "${unique_pids[@]}" 2>/dev/null || true
  sleep 1

  local still_alive=()
  for pid in "${unique_pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      still_alive+=("$pid")
    fi
  done

  if [ "${#still_alive[@]}" -gt 0 ]; then
    echo "Force killing stubborn PIDs: ${still_alive[*]}"
    kill -KILL "${still_alive[@]}" 2>/dev/null || true
  fi
}

usage() {
  echo "Usage: ./manage_vps.sh {start|stop|restart|status|logs}"
}

cmd="${1:-status}"

case "$cmd" in
  start)
    echo "[1/3] Cleaning stale listeners..."
    cleanup_stale_backend_listeners
    echo "[2/3] Starting ${SERVICE_NAME}..."
    run_privileged systemctl start "$SERVICE_NAME"
    echo "[3/3] Starting nginx..."
    run_privileged systemctl start nginx
    echo "Done."
    ;;
  stop)
    run_privileged systemctl stop "$SERVICE_NAME"
    ;;
  restart)
    echo "[1/4] Cleaning stale listeners..."
    cleanup_stale_backend_listeners
    echo "[2/4] Restarting ${SERVICE_NAME}..."
    run_privileged systemctl restart "$SERVICE_NAME"
    echo "[3/4] Restarting nginx..."
    run_privileged systemctl restart nginx
    echo "[4/4] Showing short status..."
    run_privileged systemctl --no-pager -l status "$SERVICE_NAME" || true
    ;;
  status)
    run_privileged systemctl status "$SERVICE_NAME" --no-pager || true
    echo
    run_privileged systemctl status nginx --no-pager || true
    ;;
  logs)
    run_privileged journalctl -u "$SERVICE_NAME" -f
    ;;
  *)
    usage
    exit 1
    ;;
esac
