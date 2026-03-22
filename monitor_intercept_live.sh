#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/backend/.env"

INTERVAL_SECONDS="${INTERVAL_SECONDS:-3}"
WIREGUARD_INTERFACE="${WIREGUARD_INTERFACE:-}"

if ! [[ "${INTERVAL_SECONDS}" =~ ^[0-9]+$ ]] || [ "${INTERVAL_SECONDS}" -lt 1 ]; then
  echo "[live-monitor] ERROR: INTERVAL_SECONDS must be an integer >= 1"
  exit 1
fi

read_env() {
  local key="$1"
  local default_value="$2"
  if [ ! -f "${ENV_FILE}" ]; then
    printf '%s' "${default_value}"
    return
  fi

  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  if [ -z "${line}" ]; then
    printf '%s' "${default_value}"
    return
  fi

  printf '%s' "${line#*=}"
}

build_proxy_ports() {
  local range single
  range="$(read_env INTERCEPT_PROXY_PORT_RANGE '')"
  single="$(read_env INTERCEPT_PROXY_PORT 8080)"

  if [[ "${range}" =~ ^([0-9]{2,5})-([0-9]{2,5})$ ]]; then
    local start end p
    start="${BASH_REMATCH[1]}"
    end="${BASH_REMATCH[2]}"
    if [ "${start}" -ge 1 ] && [ "${end}" -le 65535 ] && [ "${start}" -le "${end}" ]; then
      for (( p=start; p<=end; p++ )); do
        PROXY_PORTS+=("${p}")
      done
      return
    fi
  fi

  if [[ "${single}" =~ ^[0-9]{1,5}$ ]] && [ "${single}" -ge 1 ] && [ "${single}" -le 65535 ]; then
    PROXY_PORTS+=("${single}")
    return
  fi

  PROXY_PORTS+=("8080")
}

proxy_established_for_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -Hnt state established "( sport = :${port} )" 2>/dev/null || true
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -nt 2>/dev/null | awk -v p=":${port}" '$4 ~ p && $6 == "ESTABLISHED" {print $0}' || true
  fi
}

collect_proxy_snapshot() {
  local port lines total
  total=0
  local all_lines=""

  for port in "${PROXY_PORTS[@]}"; do
    lines="$(proxy_established_for_port "${port}")"
    if [ -n "${lines}" ]; then
      total=$((total + $(printf '%s\n' "${lines}" | sed '/^$/d' | wc -l | tr -d ' ')))
      all_lines+=$'\n'"${lines}"
    fi
  done

  local top_peers="-"
  if [ -n "${all_lines}" ]; then
    top_peers="$(printf '%s\n' "${all_lines}" \
      | sed '/^$/d' \
      | awk '{print $5}' \
      | sed 's/\[//g; s/\]//g' \
      | awk -F: '{if (NF>1) {NF--; print $0} else {print $1}}' OFS=":" \
      | sed '/^$/d' \
      | sort \
      | uniq -c \
      | sort -nr \
      | head -n 3 \
      | awk '{print $2 "(" $1 ")"}' \
      | paste -sd, -)"
    if [ -z "${top_peers}" ]; then
      top_peers="-"
    fi
  fi

  printf '%s|%s' "${total}" "${top_peers}"
}

collect_wg_snapshot() {
  local iface="$1"
  if ! command -v wg >/dev/null 2>&1; then
    printf 'wg-missing|0|0|0'
    return
  fi

  if ! ip link show "${iface}" >/dev/null 2>&1; then
    printf 'iface-missing|0|0|0'
    return
  fi

  local dump
  dump="$(wg show "${iface}" dump 2>/dev/null || true)"
  if [ -z "${dump}" ]; then
    printf 'empty|0|0|0'
    return
  fi

  local parsed
  parsed="$(printf '%s\n' "${dump}" | awk '
NR==1 { next }
{
  hs=$5; rx=$6; tx=$7;
  total_rx += rx;
  total_tx += tx;
  if (hs > 0) {
    now=systime();
    age=now-hs;
    if (age <= 180) recent += 1;
  }
}
END {
  printf("ok|%d|%d|%d", recent+0, total_rx+0, total_tx+0);
}
')"
  printf '%s' "${parsed}"
}

if [ -z "${WIREGUARD_INTERFACE}" ]; then
  WIREGUARD_INTERFACE="$(read_env INTERCEPT_WIREGUARD_INTERFACE wg0)"
fi

PROXY_PORTS=()
build_proxy_ports

echo "[live-monitor] env=${ENV_FILE}"
echo "[live-monitor] proxy_ports=${PROXY_PORTS[*]}"
echo "[live-monitor] wireguard_interface=${WIREGUARD_INTERFACE}"
echo "[live-monitor] interval=${INTERVAL_SECONDS}s"
echo "[live-monitor] Press Ctrl+C to stop"

prev_proxy_total=0
prev_wg_rx=0
prev_wg_tx=0

while true; do
  now="$(date '+%Y-%m-%d %H:%M:%S')"

  proxy_snapshot="$(collect_proxy_snapshot)"
  IFS='|' read -r proxy_total proxy_top_peers <<< "${proxy_snapshot}"
  proxy_delta=$((proxy_total - prev_proxy_total))
  if [ "${proxy_delta}" -lt 0 ]; then
    proxy_delta=0
  fi
  prev_proxy_total="${proxy_total}"

  wg_snapshot="$(collect_wg_snapshot "${WIREGUARD_INTERFACE}")"
  IFS='|' read -r wg_state wg_recent wg_total_rx wg_total_tx <<< "${wg_snapshot}"
  wg_delta_rx=$((wg_total_rx - prev_wg_rx))
  wg_delta_tx=$((wg_total_tx - prev_wg_tx))
  if [ "${wg_delta_rx}" -lt 0 ]; then wg_delta_rx=0; fi
  if [ "${wg_delta_tx}" -lt 0 ]; then wg_delta_tx=0; fi
  prev_wg_rx="${wg_total_rx}"
  prev_wg_tx="${wg_total_tx}"

  echo "${now} | PROXY est=${proxy_total} (+${proxy_delta}) peers=${proxy_top_peers} | WG state=${wg_state} recent=${wg_recent} +rx=${wg_delta_rx}B +tx=${wg_delta_tx}B"

  sleep "${INTERVAL_SECONDS}"
done
