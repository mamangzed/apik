#!/usr/bin/env bash
set -euo pipefail

# Full auto deploy for Ubuntu/Debian VPS with Cloudflare Origin Certificate.
# It will:
# - auto-select backend port if not provided
# - generate backend/.env and frontend/.env
# - configure systemd background service
# - configure Nginx HTTPS + WebSocket reverse proxy
# - generate/install Cloudflare Origin cert + key via Cloudflare API

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
DOMAIN="${DOMAIN:-}"                       # example: api.example.com
PROXY_SUBDOMAIN="${PROXY_SUBDOMAIN:-proxy}" # example: proxy or proxy.example.com
CF_API_TOKEN="${CF_API_TOKEN:-}"           # Cloudflare API token
CF_ZONE_ID="${CF_ZONE_ID:-}"               # Cloudflare Zone ID
CF_DNS_AUTOMATION="${CF_DNS_AUTOMATION:-true}"
SHOW_SECRET_INPUTS="${SHOW_SECRET_INPUTS:-true}"

CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-}"
CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

BACKEND_PORT="${BACKEND_PORT:-}"           # auto-picked when empty
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
INTERCEPT_PROXY_PORT_RANGE="${INTERCEPT_PROXY_PORT_RANGE:-}"
WIREGUARD_ENABLE="${WIREGUARD_ENABLE:-true}"
WIREGUARD_PORT="${WIREGUARD_PORT:-443}"
WIREGUARD_FALLBACK_PORT="${WIREGUARD_FALLBACK_PORT:-51820}"
WIREGUARD_INTERFACE="${WIREGUARD_INTERFACE:-wg0}"
WIREGUARD_SUBNET_CIDR="${WIREGUARD_SUBNET_CIDR:-10.66.66.0/24}"
WIREGUARD_SERVER_IP_CIDR="${WIREGUARD_SERVER_IP_CIDR:-10.66.66.1/24}"
WIREGUARD_USERS="${WIREGUARD_USERS:-${WIREGUARD_CLIENT_NAME:-mobile1}}" # comma-separated users, e.g. alice,bob,qa-iphone
WIREGUARD_TRANSPARENT_INTERCEPT="${WIREGUARD_TRANSPARENT_INTERCEPT:-false}"
WIREGUARD_TRANSPARENT_PORT="${WIREGUARD_TRANSPARENT_PORT:-18080}"
APT_LOCK_WAIT_SECONDS="${APT_LOCK_WAIT_SECONDS:-300}"
SERVICE_NAME="apik-backend"
CF_ORIGIN_CERT_DIR="/etc/ssl/cloudflare-origin"
CF_ZONE_NAME=""
PROXY_HOST=""
EFFECTIVE_PROXY_HOST=""
WIREGUARD_EFFECTIVE_PORT=""

cloudflare_api() {
  local method="$1"
  local endpoint="$2"
  local payload="${3:-}"

  if [ -n "$payload" ]; then
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4${endpoint}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload"
  else
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4${endpoint}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

ensure_cloudflare_success() {
  local json="$1"
  local context="$2"
  local ok
  ok="$(echo "$json" | jq -r '.success // false')"
  if [ "$ok" != "true" ]; then
    echo "Cloudflare API failed during: $context"
    echo "$json" | jq -r '.errors // []'
    exit 1
  fi
}

cloudflare_success() {
  local json="$1"
  local ok
  ok="$(echo "$json" | jq -r '.success // false')"
  [ "$ok" = "true" ]
}

print_cloudflare_errors() {
  local json="$1"
  echo "$json" | jq -r '.errors // []'
}

verify_cloudflare_token() {
  local verify_response
  verify_response="$(cloudflare_api GET "/user/tokens/verify")"
  if cloudflare_success "$verify_response"; then
    return
  fi

  echo "Cloudflare /user/tokens/verify failed, checking token against target zone access..."
  print_cloudflare_errors "$verify_response"

  # Some token types may not validate through /user/tokens/verify even though
  # they are valid for zone-scoped API calls. Deploy needs zone-level access.
  local zone_check
  zone_check="$(cloudflare_api GET "/zones/${CF_ZONE_ID}")"
  if cloudflare_success "$zone_check"; then
    echo "Cloudflare token accepted for zone ${CF_ZONE_ID}. Proceeding."
    return
  fi

  echo "Cloudflare token verification failed for both user and zone checks."
  print_cloudflare_errors "$zone_check"
  echo "Required scopes: Zone:Read, DNS:Edit, Zone Settings:Edit, SSL and Certificates:Edit"
  exit 1
}

trim() {
  local value="$1"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  return 1
}

print_port_owners() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null || true
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN || true
  fi
}

stop_service_if_exists() {
  local service="$1"
  if systemctl list-unit-files | awk '{print $1}' | grep -qx "${service}.service"; then
    systemctl stop "$service" 2>/dev/null || true
    systemctl disable "$service" 2>/dev/null || true
  fi
}

free_http_ports_for_nginx() {
  local ports=(80 443)
  local common_services=(apache2 httpd caddy lighttpd nginx)
  local port service

  echo "Preflight: freeing HTTP ports for Nginx..."
  for service in "${common_services[@]}"; do
    stop_service_if_exists "$service"
  done

  sleep 1

  for port in "${ports[@]}"; do
    if port_in_use "$port"; then
      echo "Port ${port} is still in use before Nginx setup. Current owner:"
      print_port_owners "$port"
      echo "Please stop the process above or change its port, then rerun deploy."
      exit 1
    fi
  done
}

wait_for_apt_locks() {
  local timeout_seconds="$APT_LOCK_WAIT_SECONDS"
  local started_at now elapsed locked
  started_at="$(date +%s)"

  while true; do
    locked=false

    if command -v fuser >/dev/null 2>&1; then
      fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && locked=true || true
      fuser /var/lib/dpkg/lock >/dev/null 2>&1 && locked=true || true
      fuser /var/lib/apt/lists/lock >/dev/null 2>&1 && locked=true || true
      fuser /var/cache/apt/archives/lock >/dev/null 2>&1 && locked=true || true
    elif command -v lsof >/dev/null 2>&1; then
      lsof /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && locked=true || true
      lsof /var/lib/dpkg/lock >/dev/null 2>&1 && locked=true || true
      lsof /var/lib/apt/lists/lock >/dev/null 2>&1 && locked=true || true
      lsof /var/cache/apt/archives/lock >/dev/null 2>&1 && locked=true || true
    fi

    if [ "$locked" = false ]; then
      return
    fi

    now="$(date +%s)"
    elapsed=$((now - started_at))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out waiting for apt/dpkg lock after ${timeout_seconds}s."
      echo "Inspect: systemctl status unattended-upgrades"
      exit 1
    fi

    echo "Waiting for apt/dpkg lock (${elapsed}s/${timeout_seconds}s)..."
    sleep 5
  done
}

normalize_proxy_host() {
  local input="$1"
  local zone_name="$2"
  local normalized

  normalized="$(trim "$input")"
  normalized="${normalized%.}"

  if [ -z "$normalized" ]; then
    echo ""
    return
  fi

  if [[ "$normalized" == *.* ]]; then
    printf '%s' "$normalized"
    return
  fi

  printf '%s.%s' "$normalized" "$zone_name"
}

ensure_proxy_host_in_zone() {
  local proxy_host="$1"
  local zone_name="$2"

  if [ "$proxy_host" = "$zone_name" ]; then
    echo "Proxy host must use a separate subdomain, not the zone apex: $proxy_host"
    exit 1
  fi

  case "$proxy_host" in
    *."$zone_name")
      ;;
    *)
      echo "Proxy host must be inside Cloudflare zone $zone_name: $proxy_host"
      exit 1
      ;;
  esac
}

ensure_dns_only_a_record() {
  local fqdn="$1"
  local ip="$2"

  local list_response
  list_response="$(cloudflare_api GET "/zones/${CF_ZONE_ID}/dns_records?type=A&name=${fqdn}")"
  if ! cloudflare_success "$list_response"; then
    echo "Cloudflare API failed during: lookup DNS record ${fqdn}"
    print_cloudflare_errors "$list_response"
    return 1
  fi

  local record_id
  record_id="$(echo "$list_response" | jq -r '.result[0].id // empty')"

  local payload
  payload="$(jq -nc --arg type "A" --arg name "$fqdn" --arg content "$ip" '{type:$type,name:$name,content:$content,ttl:1,proxied:false}')"

  if [ -n "$record_id" ]; then
    local update_response
    update_response="$(cloudflare_api PUT "/zones/${CF_ZONE_ID}/dns_records/${record_id}" "$payload")"
    if ! cloudflare_success "$update_response"; then
      echo "Cloudflare API failed during: update DNS record ${fqdn}"
      print_cloudflare_errors "$update_response"
      return 1
    fi
    echo "DNS record updated: ${fqdn} -> ${ip} (DNS only)"
    return
  fi

  local create_response
  create_response="$(cloudflare_api POST "/zones/${CF_ZONE_ID}/dns_records" "$payload")"
  if ! cloudflare_success "$create_response"; then
    echo "Cloudflare API failed during: create DNS record ${fqdn}"
    print_cloudflare_errors "$create_response"
    return 1
  fi
  echo "DNS record created: ${fqdn} -> ${ip} (DNS only)"
}

verify_dns_only_a_record() {
  local fqdn="$1"
  local expected_ip="$2"

  local response
  response="$(cloudflare_api GET "/zones/${CF_ZONE_ID}/dns_records?type=A&name=${fqdn}")"
  if ! cloudflare_success "$response"; then
    echo "Cloudflare API failed during: verify DNS record ${fqdn}"
    print_cloudflare_errors "$response"
    return 1
  fi

  local actual_ip
  local proxied
  actual_ip="$(echo "$response" | jq -r '.result[0].content // empty')"
  proxied="$(echo "$response" | jq -r '.result[0].proxied // false')"

  if [ "$actual_ip" != "$expected_ip" ]; then
    echo "WARNING: DNS record ${fqdn} points to ${actual_ip:-<empty>}, expected ${expected_ip}"
  fi

  if [ "$proxied" != "false" ]; then
    echo "WARNING: DNS record ${fqdn} is proxied by Cloudflare. Mobile proxy requires DNS only."
    return 1
  fi

  echo "DNS verification OK: ${fqdn} -> ${actual_ip} (DNS only)"
}

require_or_prompt() {
  local var_name="$1"
  local label="$2"
  local secret="${3:-false}"
  local current="${!var_name:-}"
  current="$(trim "$current")"
  if [ -n "$current" ]; then
    export "$var_name=$current"
    return
  fi

  if [ "$secret" = "true" ] && [ "$SHOW_SECRET_INPUTS" != "true" ]; then
    read -r -s -p "$label: " current
    echo
  else
    read -r -p "$label: " current
  fi

  current="$(trim "$current")"

  if [ -z "$current" ]; then
    echo "Required value missing: $var_name"
    exit 1
  fi
  export "$var_name=$current"
}

is_port_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ! ss -ltn "sport = :$port" | grep -q ":$port"
  else
    ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  fi
}

pick_free_port() {
  local start="${1:-3001}"
  local port="$start"
  while [ "$port" -le 65535 ]; do
    if is_port_free "$port"; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
  echo "No free port found in range 3001-65535" >&2
  exit 1
}

count_free_ports_in_range() {
  local start="$1"
  local end="$2"
  local count=0
  local port

  for ((port = start; port <= end; port++)); do
    if is_port_free "$port"; then
      count=$((count + 1))
    fi
  done

  echo "$count"
}

pick_free_proxy_port_range() {
  local size="$1"
  local scan_start="${2:-12000}"
  local scan_end="${3:-60999}"
  local start
  local end
  local p
  local ok

  for ((start = scan_start; start <= scan_end; start++)); do
    end=$((start + size - 1))
    if [ "$end" -gt "$scan_end" ]; then
      break
    fi

    ok=true
    for ((p = start; p <= end; p++)); do
      if ! is_port_free "$p"; then
        ok=false
        start="$p"
        break
      fi
    done

    if [ "$ok" = true ]; then
      echo "${start}-${end}"
      return
    fi
  done

  return 1
}

is_udp_port_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ! ss -lun "sport = :$port" | grep -q ":$port"
  else
    ! lsof -iUDP:"$port" >/dev/null 2>&1
  fi
}

pick_free_udp_port() {
  local start="${1:-51820}"
  local end="${2:-65535}"
  local port="$start"
  while [ "$port" -le "$end" ]; do
    if is_udp_port_free "$port"; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
  echo "No free UDP port found in range ${start}-${end}" >&2
  exit 1
}

pick_wireguard_port() {
  local preferred="$1"
  local fallback="$2"

  if is_udp_port_free "$preferred"; then
    echo "$preferred"
    return
  fi

  if [ "$preferred" = "443" ]; then
    echo "WireGuard requested UDP 443, but UDP 443 is already in use. Falling back automatically..." >&2
  else
    echo "WireGuard requested UDP ${preferred}, but that port is already in use. Falling back automatically..." >&2
  fi

  if is_udp_port_free "$fallback"; then
    echo "$fallback"
    return
  fi

  pick_free_udp_port 51820 65535
}

cleanup_stale_apik_backend_processes() {
  local backend_port="$1"
  local proxy_start="$2"
  local proxy_end="$3"

  echo "  Stopping previous APIK backend processes..."

  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true

  local patterns=(
    "${APP_DIR}/backend/dist/index.js"
    "${APP_DIR}/backend/src/index.ts"
    "${APP_DIR}/backend/node_modules/.bin/tsx"
  )

  local pattern
  for pattern in "${patterns[@]}"; do
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      pkill -TERM -f "$pattern" 2>/dev/null || true
    fi
  done

  sleep 2

  for pattern in "${patterns[@]}"; do
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      echo "  Found stubborn APIK backend process for pattern: $pattern. Forcing kill..."
      pkill -KILL -f "$pattern" 2>/dev/null || true
    fi
  done

  sleep 1

  free_tcp_port_range "$backend_port" "$backend_port"
  free_tcp_port_range "$proxy_start" "$proxy_end"
}

list_listening_pids_for_tcp_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
  fi
}

free_tcp_port_range() {
  local start="$1"
  local end="$2"
  local port
  local pids
  local pid

  for ((port = start; port <= end; port++)); do
    if is_port_free "$port"; then
      continue
    fi

    pids="$(list_listening_pids_for_tcp_port "$port" || true)"
    if [ -z "$pids" ]; then
      continue
    fi

    echo "  Reclaiming TCP port $port from stale listener(s): $(echo "$pids" | tr '\n' ' ' | xargs)"
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      kill -TERM "$pid" 2>/dev/null || true
    done <<< "$pids"

    sleep 1

    if ! is_port_free "$port"; then
      while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        kill -KILL "$pid" 2>/dev/null || true
      done <<< "$pids"
    fi
  done
}

configure_wireguard() {
  local endpoint_host="$1"
  local public_nic
  local server_private_key
  local server_public_key
  local users_csv
  local peers_block=""
  local first_client_conf=""
  local idx=2
  local output_dir="${APP_DIR}/wireguard"

  echo "[9/12] Installing and configuring WireGuard..."
  wait_for_apt_locks
  apt-get install -y wireguard wireguard-tools qrencode

  # Ensure the WireGuard kernel module is available in the CURRENTLY RUNNING kernel.
  # When a kernel upgrade is pending (new kernel installed but old one still running),
  # the wireguard module may only exist in the new kernel. We try to load it and, if
  # that fails, install linux-modules-extra for the running kernel as a fallback.
  if ! modprobe wireguard 2>/dev/null; then
    RUNNING_KERNEL="$(uname -r)"
    echo "WireGuard module not loaded in running kernel ${RUNNING_KERNEL}, trying linux-modules-extra..."
    wait_for_apt_locks
    apt-get install -y "linux-modules-extra-${RUNNING_KERNEL}" 2>/dev/null || true
    modprobe wireguard 2>/dev/null || true
  fi

  if [[ ! "$WIREGUARD_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$WIREGUARD_PORT" -lt 1 ] || [ "$WIREGUARD_PORT" -gt 65535 ]; then
    echo "Invalid WIREGUARD_PORT: ${WIREGUARD_PORT}"
    exit 1
  fi
  if [[ ! "$WIREGUARD_FALLBACK_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$WIREGUARD_FALLBACK_PORT" -lt 1 ] || [ "$WIREGUARD_FALLBACK_PORT" -gt 65535 ]; then
    echo "Invalid WIREGUARD_FALLBACK_PORT: ${WIREGUARD_FALLBACK_PORT}"
    exit 1
  fi

  # Web reverse proxy uses TCP/443. WireGuard uses UDP/443, so no protocol-level conflict.
  # We still check UDP/443 at runtime and fallback automatically if busy.
  WIREGUARD_EFFECTIVE_PORT="$(pick_wireguard_port "$WIREGUARD_PORT" "$WIREGUARD_FALLBACK_PORT")"
  WIREGUARD_EFFECTIVE_PORT="$(printf '%s' "$WIREGUARD_EFFECTIVE_PORT" | tr -d '[:space:]')"
  if [[ ! "$WIREGUARD_EFFECTIVE_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$WIREGUARD_EFFECTIVE_PORT" -lt 1 ] || [ "$WIREGUARD_EFFECTIVE_PORT" -gt 65535 ]; then
    echo "Invalid resolved WireGuard port: ${WIREGUARD_EFFECTIVE_PORT}"
    exit 1
  fi

  mkdir -p /etc/wireguard
  chmod 700 /etc/wireguard

  if [ ! -f /etc/wireguard/${WIREGUARD_INTERFACE}.server.key ]; then
    umask 077
    wg genkey > /etc/wireguard/${WIREGUARD_INTERFACE}.server.key
  fi
  server_private_key="$(cat /etc/wireguard/${WIREGUARD_INTERFACE}.server.key)"
  server_public_key="$(printf '%s' "$server_private_key" | wg pubkey)"

  public_nic="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  if [ -z "$public_nic" ]; then
    public_nic="$(ip route | awk '/default/ {print $5; exit}')"
  fi
  if [ -z "$public_nic" ]; then
    echo "Failed to detect public network interface for WireGuard NAT."
    exit 1
  fi

  cat >/etc/sysctl.d/99-apik-wireguard.conf <<EOF
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF
  sysctl --system >/dev/null

  mkdir -p "$output_dir"
  chmod 700 "$output_dir"

  users_csv="$(trim "$WIREGUARD_USERS")"
  if [ -z "$users_csv" ]; then
    users_csv="mobile1"
  fi

  IFS=',' read -r -a wg_users <<< "$users_csv"
  if [ "${#wg_users[@]}" -eq 0 ]; then
    echo "No WireGuard users provided. Set WIREGUARD_USERS (example: alice,bob)."
    exit 1
  fi

  for raw_user in "${wg_users[@]}"; do
    local client_name
    local client_key_file
    local client_private_key
    local client_public_key
    local psk_file
    local psk
    local client_ip
    local client_ip_cidr
    local client_conf_path

    client_name="$(trim "$raw_user")"
    if [ -z "$client_name" ]; then
      continue
    fi
    if [[ ! "$client_name" =~ ^[a-zA-Z0-9_.-]{2,40}$ ]]; then
      echo "Invalid WireGuard username: ${client_name}. Allowed: 2-40 chars [a-zA-Z0-9_.-]"
      exit 1
    fi
    if [ "$idx" -gt 254 ]; then
      echo "Too many WireGuard users for subnet ${WIREGUARD_SUBNET_CIDR}."
      exit 1
    fi

    client_ip="10.66.66.${idx}"
    client_ip_cidr="${client_ip}/32"
    idx=$((idx + 1))

    client_key_file="/etc/wireguard/${WIREGUARD_INTERFACE}.${client_name}.key"
    if [ ! -f "$client_key_file" ]; then
      umask 077
      wg genkey > "$client_key_file"
    fi
    client_private_key="$(cat "$client_key_file")"
    client_public_key="$(printf '%s' "$client_private_key" | wg pubkey)"

    psk_file="/etc/wireguard/${WIREGUARD_INTERFACE}.${client_name}.psk"
    if [ ! -f "$psk_file" ]; then
      umask 077
      wg genpsk > "$psk_file"
    fi
    psk="$(cat "$psk_file")"

    peers_block+="$(printf '\n[Peer]\nPublicKey = %s\nPresharedKey = %s\nAllowedIPs = %s\n' \
      "${client_public_key}" "${psk}" "${client_ip_cidr}")"

    client_conf_path="${output_dir}/${client_name}.conf"
    cat >"$client_conf_path" <<EOF
[Interface]
PrivateKey = ${client_private_key}
Address = ${client_ip_cidr}
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${server_public_key}
PresharedKey = ${psk}
Endpoint = ${endpoint_host}:${WIREGUARD_EFFECTIVE_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF
    chmod 600 "$client_conf_path"

    if [ -z "$first_client_conf" ]; then
      first_client_conf="$client_conf_path"
    fi
  done

  cat >/etc/wireguard/${WIREGUARD_INTERFACE}.conf <<EOF
[Interface]
Address = ${WIREGUARD_SERVER_IP_CIDR}
ListenPort = ${WIREGUARD_EFFECTIVE_PORT}
PrivateKey = ${server_private_key}
SaveConfig = false
PostUp = iptables -A FORWARD -i ${WIREGUARD_INTERFACE} -j ACCEPT; iptables -A FORWARD -o ${WIREGUARD_INTERFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${public_nic} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WIREGUARD_INTERFACE} -j ACCEPT; iptables -D FORWARD -o ${WIREGUARD_INTERFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o ${public_nic} -j MASQUERADE
${peers_block}
EOF
  chmod 600 /etc/wireguard/${WIREGUARD_INTERFACE}.conf

  systemctl enable wg-quick@${WIREGUARD_INTERFACE}
  WG_START_OK=true
  systemctl restart wg-quick@${WIREGUARD_INTERFACE} || WG_START_OK=false

  if [ "$WG_START_OK" = true ]; then
    echo "WireGuard configured on UDP ${WIREGUARD_EFFECTIVE_PORT} (interface ${WIREGUARD_INTERFACE})."
  else
    echo ""
    echo "WARNING: WireGuard service failed to start on this boot."
    echo "  Running kernel : $(uname -r)"
    echo "  Likely cause  : A kernel upgrade is pending but the VPS has not been rebooted yet."
    echo "  The wireguard kernel module is available in the new kernel but not the current one."
    echo ""
    echo "  Recent wg-quick logs:"
    journalctl -u wg-quick@${WIREGUARD_INTERFACE} -n 20 --no-pager || true
    echo ""
    echo "  ACTION REQUIRED: reboot the VPS, then re-run the deploy command."
    echo "    reboot"
    echo ""
    echo "  All WireGuard config files have been generated and will work after reboot."
  fi
  echo "Per-user WireGuard client configs generated in: ${output_dir}"
  ls -1 "${output_dir}"/*.conf 2>/dev/null | sed 's/^/- /' || true
  if [ -n "$first_client_conf" ] && [ -f "$first_client_conf" ]; then
    echo "WireGuard mobile QR for first user ($(basename "$first_client_conf" .conf)):"
    qrencode -t ansiutf8 < "$first_client_conf" || true
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root: sudo bash deploy_cloudflare_vps.sh"
  exit 1
fi

echo "APIK full auto deploy"
echo "- App dir: $APP_DIR"
echo "- Secret prompt visibility: ${SHOW_SECRET_INPUTS}"
echo ""

require_or_prompt DOMAIN "Domain (example: api.example.com)"
require_or_prompt PROXY_SUBDOMAIN "Proxy subdomain (example: proxy or proxy.example.com)"
require_or_prompt CF_API_TOKEN "Cloudflare API token (Zone:Read, DNS:Edit, Zone Settings:Edit, SSL and Certificates:Edit)" true
require_or_prompt CF_ZONE_ID "Cloudflare Zone ID"
require_or_prompt CLERK_SECRET_KEY "Clerk Secret Key" true
require_or_prompt CLERK_PUBLISHABLE_KEY "Clerk Publishable Key"
require_or_prompt SUPABASE_URL "Supabase URL"
require_or_prompt SUPABASE_SERVICE_ROLE_KEY "Supabase Service Role Key" true

if [ -z "$INTERCEPT_PROXY_PORT_RANGE" ]; then
  read -r -p "Intercept proxy port range (example: 8080-8110) [default: 8080-8110]: " INTERCEPT_PROXY_PORT_RANGE
  INTERCEPT_PROXY_PORT_RANGE="$(trim "$INTERCEPT_PROXY_PORT_RANGE")"
  if [ -z "$INTERCEPT_PROXY_PORT_RANGE" ]; then
    INTERCEPT_PROXY_PORT_RANGE="8080-8110"
  fi
fi

if [[ ! "$INTERCEPT_PROXY_PORT_RANGE" =~ ^([0-9]{2,5})-([0-9]{2,5})$ ]]; then
  echo "Invalid INTERCEPT_PROXY_PORT_RANGE format: $INTERCEPT_PROXY_PORT_RANGE"
  echo "Expected format: start-end (example: 8080-8110)"
  exit 1
fi

PROXY_PORT_START="${BASH_REMATCH[1]}"
PROXY_PORT_END="${BASH_REMATCH[2]}"
if [ "$PROXY_PORT_START" -lt 1 ] || [ "$PROXY_PORT_END" -gt 65535 ] || [ "$PROXY_PORT_START" -gt "$PROXY_PORT_END" ]; then
  echo "Invalid port range bounds: $INTERCEPT_PROXY_PORT_RANGE"
  exit 1
fi

cleanup_stale_apik_backend_processes "${BACKEND_PORT:-3001}" "$PROXY_PORT_START" "$PROXY_PORT_END"

if [ -n "$BACKEND_PORT" ] && ! is_port_free "$BACKEND_PORT"; then
  echo "Requested BACKEND_PORT ${BACKEND_PORT} is busy after cleanup, selecting a free port automatically..."
  BACKEND_PORT=""
fi

if [ -z "$BACKEND_PORT" ]; then
  BACKEND_PORT="$(pick_free_port 3001)"
fi

range_size=$((PROXY_PORT_END - PROXY_PORT_START + 1))
free_in_requested_range="$(count_free_ports_in_range "$PROXY_PORT_START" "$PROXY_PORT_END")"
min_required_free=50
if [ "$range_size" -lt "$min_required_free" ]; then
  min_required_free="$range_size"
fi

if [ "$free_in_requested_range" -lt "$min_required_free" ]; then
  echo "Requested proxy range ${INTERCEPT_PROXY_PORT_RANGE} has too few free ports (${free_in_requested_range}/${range_size})."

  fallback_size="$range_size"
  if [ "$fallback_size" -gt 200 ]; then
    fallback_size=200
  fi

  fallback_range="$(pick_free_proxy_port_range "$fallback_size" 12000 60999 || true)"
  if [ -z "$fallback_range" ]; then
    echo "Unable to find a free proxy port range automatically."
    echo "Please set INTERCEPT_PROXY_PORT_RANGE to an unused range and rerun deploy."
    exit 1
  fi

  INTERCEPT_PROXY_PORT_RANGE="$fallback_range"
  PROXY_PORT_START="${fallback_range%-*}"
  PROXY_PORT_END="${fallback_range#*-}"
  echo "Auto-switched INTERCEPT_PROXY_PORT_RANGE -> ${INTERCEPT_PROXY_PORT_RANGE}"
fi

echo "Using backend port: $BACKEND_PORT"
echo "Using intercept proxy port range: $INTERCEPT_PROXY_PORT_RANGE"

echo "Verifying Cloudflare API token..."
verify_cloudflare_token

echo "Resolving Cloudflare zone details..."
ZONE_RESPONSE="$(cloudflare_api GET "/zones/${CF_ZONE_ID}")"
ensure_cloudflare_success "$ZONE_RESPONSE" "fetch zone details"
CF_ZONE_NAME="$(echo "$ZONE_RESPONSE" | jq -r '.result.name // empty')"
if [ -z "$CF_ZONE_NAME" ]; then
  echo "Failed to resolve Cloudflare zone name from zone ID: ${CF_ZONE_ID}"
  exit 1
fi

PROXY_HOST="$(normalize_proxy_host "$PROXY_SUBDOMAIN" "$CF_ZONE_NAME")"
if [ -z "$PROXY_HOST" ]; then
  echo "Proxy subdomain is empty after normalization"
  exit 1
fi
ensure_proxy_host_in_zone "$PROXY_HOST" "$CF_ZONE_NAME"
echo "Proxy host: $PROXY_HOST"

# Detect public VPS IP for the mobile intercept proxy.
# The proxy host MUST be DNS-only (grey cloud) or raw IP because
# Cloudflare-proxied (orange cloud) domains terminate TCP at CF's edge,
# breaking the CONNECT method that mobile proxies rely on for HTTPS tunnelling.
echo "Detecting public IP..."
PUBLIC_IP="$(curl -sS4 ifconfig.me 2>/dev/null || curl -sS4 api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
if [ -z "$PUBLIC_IP" ]; then
  echo "WARNING: Could not detect public IP. Set INTERCEPT_PROXY_HOST manually in backend/.env if DNS automation fails"
  PUBLIC_IP=""
fi
if [ -n "$PUBLIC_IP" ]; then
  echo "Public IP (for mobile proxy): $PUBLIC_IP"

  if [ "${CF_DNS_AUTOMATION}" = "true" ]; then
    if ensure_dns_only_a_record "$PROXY_HOST" "$PUBLIC_IP" && verify_dns_only_a_record "$PROXY_HOST" "$PUBLIC_IP"; then
      EFFECTIVE_PROXY_HOST="$PROXY_HOST"
    else
      echo "WARNING: DNS automation failed for ${PROXY_HOST}."
      echo "You can fix token scopes (needs DNS:Edit) and re-run installer, or create the DNS record manually."
      echo "Falling back INTERCEPT_PROXY_HOST to public IP for now: ${PUBLIC_IP}"
      EFFECTIVE_PROXY_HOST="$PUBLIC_IP"
    fi
  else
    echo "CF_DNS_AUTOMATION=false -> skipping DNS create/update"
    EFFECTIVE_PROXY_HOST="$PROXY_HOST"
  fi
else
  echo "Skipping DNS automation because public IP could not be detected."
  EFFECTIVE_PROXY_HOST="$PROXY_HOST"
fi

echo "[1/12] Installing system dependencies..."
free_http_ports_for_nginx
wait_for_apt_locks
apt-get update -y
wait_for_apt_locks
apt-get install -y curl ca-certificates gnupg nginx jq openssl

if ! command -v node >/dev/null 2>&1; then
  echo "[2/12] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  wait_for_apt_locks
  apt-get install -y nodejs
else
  echo "[2/12] Node.js already installed ($(node -v))."
fi

echo "[3/12] Generating backend/frontend env files..."
cat >"$APP_DIR/backend/.env" <<EOF
HOST=${BACKEND_HOST}
PORT=${BACKEND_PORT}
CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
INTERCEPT_PROXY_HOST=${EFFECTIVE_PROXY_HOST}
INTERCEPT_PROXY_PORT=${PROXY_PORT_START}
INTERCEPT_PROXY_PORT_RANGE=${INTERCEPT_PROXY_PORT_RANGE}
INTERCEPT_PROXY_HTTPS_MITM_ENABLE=false
INTERCEPT_CA_DOWNLOAD_URL=https://${DOMAIN}/downloads/apik-ca.crt
INTERCEPT_CA_COMMON_NAME=APIK Intercept CA
INTERCEPT_WIREGUARD_ENABLE=${WIREGUARD_ENABLE}
INTERCEPT_WIREGUARD_INTERFACE=${WIREGUARD_INTERFACE}
INTERCEPT_WIREGUARD_SUBNET=${WIREGUARD_SUBNET_CIDR}
INTERCEPT_WIREGUARD_TRANSPARENT_ENABLE=${WIREGUARD_TRANSPARENT_INTERCEPT}
INTERCEPT_WIREGUARD_TRANSPARENT_PORT=${WIREGUARD_TRANSPARENT_PORT}
EOF

cat >"$APP_DIR/frontend/.env" <<EOF
VITE_CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}
VITE_APP_BASE_URL=https://${DOMAIN}
VITE_API_BASE_URL=https://${DOMAIN}
VITE_WS_BASE_URL=wss://${DOMAIN}
EOF

echo "[4/12] Installing app dependencies and building..."
npm --prefix "$APP_DIR/backend" install
npm --prefix "$APP_DIR/frontend" install
npm --prefix "$APP_DIR" run build

echo "[5/12] Creating systemd service for backend..."
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=APIK Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${BACKEND_PORT}
Environment=HOST=${BACKEND_HOST}
EnvironmentFile=${APP_DIR}/backend/.env
ExecStart=/usr/bin/node ${APP_DIR}/backend/dist/index.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

echo "[6/12] Waiting for backend to generate intercept CA certificate..."
CA_CERT="$APP_DIR/backend/data/intercept-ca/ca.crt"
# Backend generates CA on first boot via caManager.ts. Wait up to 15 s.
for i in $(seq 1 15); do
  if [ -f "$CA_CERT" ]; then
    echo "  CA certificate ready: $CA_CERT"
    break
  fi
  sleep 1
done
if [ ! -f "$CA_CERT" ]; then
  echo "  WARNING: CA certificate not yet found at $CA_CERT — backend may still be starting."
fi

echo "[7/12] Generating Cloudflare Origin Certificate..."
install -m 700 -d "${CF_ORIGIN_CERT_DIR}"

# Generate RSA private key locally on the server
openssl genrsa -out "${CF_ORIGIN_CERT_DIR}/${DOMAIN}.key" 2048
chmod 600 "${CF_ORIGIN_CERT_DIR}/${DOMAIN}.key"

# Generate CSR from that key (Cloudflare Origin CA API requires a CSR)
CSR="$(openssl req -new \
  -key "${CF_ORIGIN_CERT_DIR}/${DOMAIN}.key" \
  -subj "/CN=${DOMAIN}" 2>/dev/null)"

# Encode CSR newlines as literal \n for JSON embedding
CSR_JSON="$(printf '%s' "$CSR" | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')"

# Submit CSR to Cloudflare Origin CA API
CERT_RESPONSE="$(cloudflare_api POST "/certificates" \
  "{\"csr\":\"${CSR_JSON}\",\"hostnames\":[\"${DOMAIN}\",\"*.${DOMAIN}\"],\"requested_validity\":5475,\"request_type\":\"origin-rsa\"}")"
ensure_cloudflare_success "$CERT_RESPONSE" "origin certificate creation"

ORIGIN_CERT="$(echo "$CERT_RESPONSE" | jq -r '.result.certificate // empty')"

if [ -z "$ORIGIN_CERT" ]; then
  echo "Cloudflare API response did not include certificate"
  exit 1
fi

printf '%s\n' "$ORIGIN_CERT" >"${CF_ORIGIN_CERT_DIR}/${DOMAIN}.crt"
chmod 644 "${CF_ORIGIN_CERT_DIR}/${DOMAIN}.crt"
echo "[8/12] Setting Cloudflare SSL mode to strict..."
SSL_RESPONSE="$(cloudflare_api PATCH "/zones/${CF_ZONE_ID}/settings/ssl" '{"value":"strict"}')"
ensure_cloudflare_success "$SSL_RESPONSE" "set SSL mode strict"

echo "[9b/12] Configuring Nginx reverse proxy for HTTPS + WebSocket..."
free_http_ports_for_nginx
cat >/etc/nginx/sites-available/apik <<EOF
server {
  listen 80;
  server_name ${DOMAIN};
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${DOMAIN};

  ssl_certificate ${CF_ORIGIN_CERT_DIR}/${DOMAIN}.crt;
  ssl_certificate_key ${CF_ORIGIN_CERT_DIR}/${DOMAIN}.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 50m;

  location /ws/ {
    proxy_pass http://127.0.0.1:${BACKEND_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 600s;
  }

  location / {
    proxy_pass http://127.0.0.1:${BACKEND_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }
}
EOF

ln -sf /etc/nginx/sites-available/apik /etc/nginx/sites-enabled/apik
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

if [ "${WIREGUARD_ENABLE}" = "true" ]; then
  WG_ENDPOINT_HOST="${EFFECTIVE_PROXY_HOST:-${PUBLIC_IP:-$DOMAIN}}"
  configure_wireguard "$WG_ENDPOINT_HOST"
else
  echo "[9/12] Skipping WireGuard install (WIREGUARD_ENABLE=${WIREGUARD_ENABLE})"
fi

echo "[10/12] Validating Cloudflare SSL mode..."
cloudflare_api GET "/zones/${CF_ZONE_ID}/settings/ssl" | jq -r '.result.value // "unknown"' | xargs -I{} echo "Cloudflare SSL mode: {}"

echo "[11/12] Verifying services and opening firewall ports..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  # Intercept proxy range: direct TCP, must NOT go through CF proxy.
  ufw allow ${PROXY_PORT_START}:${PROXY_PORT_END}/tcp || true
  if [ "${WIREGUARD_ENABLE}" = "true" ] && [ -n "${WIREGUARD_EFFECTIVE_PORT}" ]; then
    ufw allow ${WIREGUARD_EFFECTIVE_PORT}/udp || true
  fi
fi

systemctl is-active --quiet ${SERVICE_NAME} && echo "Backend service: running"
systemctl is-active --quiet nginx && echo "Nginx: running"
if [ "${WIREGUARD_ENABLE}" = "true" ]; then
  systemctl is-active --quiet wg-quick@${WIREGUARD_INTERFACE} && echo "WireGuard: running"
fi

echo "[12/12] Final summary..."

echo ""
echo "Deployment complete"
echo "App URL:        https://${DOMAIN}"
echo "WS URL:         wss://${DOMAIN}/ws/intercept"
echo "CA download:    https://${DOMAIN}/downloads/apik-ca.crt"
echo "Proxy host req: ${PROXY_HOST}"
echo "Proxy host use: ${EFFECTIVE_PROXY_HOST}"
echo ""
echo "Mobile proxy settings (use the DNS-only proxy subdomain below):"
echo "  Host:     ${EFFECTIVE_PROXY_HOST}"
echo "  Port:     assigned per user from range ${INTERCEPT_PROXY_PORT_RANGE}"
echo "  Auth:     enabled (credentials shown in the app Intercept panel)"
echo "  DNS:      Cloudflare A record -> ${PUBLIC_IP:-<not detected>} (proxied=false)"
echo "  Note:     Proxy host must stay DNS only / grey cloud. Orange cloud will break CONNECT on port 8080."
if [ "${WIREGUARD_ENABLE}" = "true" ]; then
  echo ""
  echo "WireGuard VPN (private tunnel for proxy transport):"
  echo "  Endpoint: ${EFFECTIVE_PROXY_HOST:-${PUBLIC_IP:-$DOMAIN}}:${WIREGUARD_EFFECTIVE_PORT}/udp"
  echo "  Port check: TCP/443 (web) is separate from UDP/${WIREGUARD_EFFECTIVE_PORT} (WireGuard)"
  if [ "${WIREGUARD_EFFECTIVE_PORT}" != "443" ]; then
    echo "  Port note: UDP 443 was busy, auto-fallback used: ${WIREGUARD_EFFECTIVE_PORT}"
  fi
  echo "  Per-user conf files: ${APP_DIR}/wireguard/*.conf"
  echo "  Users seeded at deploy: ${WIREGUARD_USERS}"
  echo "  Runtime auto-user: backend will auto-create WireGuard profile per authenticated user."
  echo "  Important: each user must use their own .conf profile (do not share)."
  echo "  Install (iOS/Android): WireGuard app -> Add tunnel -> Create from file or archive/QR"
  echo "  Important: WireGuard does not replace Manual Proxy in APIK. After the tunnel is up, still set the device proxy to the assigned per-user port."
fi
echo ""
echo "Generated env files:"
echo "- $APP_DIR/backend/.env"
echo "- $APP_DIR/frontend/.env"
echo ""
echo "Manage services:"
echo "- systemctl status ${SERVICE_NAME}"
echo "- systemctl status nginx"
echo "- journalctl -u ${SERVICE_NAME} -f"
