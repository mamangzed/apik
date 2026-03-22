#!/usr/bin/env bash
set -euo pipefail

WIREGUARD_INTERFACE="${WIREGUARD_INTERFACE:-wg0}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"

if ! command -v wg >/dev/null 2>&1; then
  echo "[wg-monitor] ERROR: 'wg' command not found. Install wireguard-tools first."
  exit 1
fi

if ! [[ "${INTERVAL_SECONDS}" =~ ^[0-9]+$ ]] || [ "${INTERVAL_SECONDS}" -lt 1 ]; then
  echo "[wg-monitor] ERROR: INTERVAL_SECONDS must be an integer >= 1"
  exit 1
fi

if ! ip link show "${WIREGUARD_INTERFACE}" >/dev/null 2>&1; then
  echo "[wg-monitor] ERROR: interface ${WIREGUARD_INTERFACE} does not exist"
  echo "[wg-monitor] Tip: systemctl status wg-quick@${WIREGUARD_INTERFACE}"
  exit 1
fi

echo "[wg-monitor] interface=${WIREGUARD_INTERFACE}"
echo "[wg-monitor] interval=${INTERVAL_SECONDS}s"
echo "[wg-monitor] Watching peer RX/TX deltas and handshake freshness..."

prev_total_rx=0
prev_total_tx=0
declare -A prev_peer_rx

awk_parse='NR==1 {
  iface_pub=$2;
  iface_port=$3;
  print "IFACE|" iface_pub "|" iface_port;
  next;
}
{
  pub=$1;
  endpoint=$3;
  allowed=$4;
  hs=$5;
  rx=$6;
  tx=$7;
  if (endpoint == "(none)") endpoint="-";
  if (allowed == "(none)") allowed="-";
  print "PEER|" pub "|" endpoint "|" allowed "|" hs "|" rx "|" tx;
}'

while true; do
  now="$(date '+%Y-%m-%d %H:%M:%S')"
  dump="$(wg show "${WIREGUARD_INTERFACE}" dump 2>/dev/null || true)"

  if [ -z "${dump}" ]; then
    echo "${now} | ERROR | cannot read wg interface ${WIREGUARD_INTERFACE}"
    sleep "${INTERVAL_SECONDS}"
    continue
  fi

  mapfile -t lines < <(printf '%s\n' "${dump}" | awk "${awk_parse}")

  iface_pub="-"
  iface_port="-"
  total_rx=0
  total_tx=0
  active_delta=0
  active_recent=0

  for line in "${lines[@]}"; do
    IFS='|' read -r kind c1 c2 c3 c4 c5 c6 <<< "${line}"

    if [ "${kind}" = "IFACE" ]; then
      iface_pub="${c1}"
      iface_port="${c2}"
      continue
    fi

    peer_pub="${c1}"
    peer_endpoint="${c2}"
    peer_allowed="${c3}"
    peer_hs="${c4}"
    peer_rx="${c5}"
    peer_tx="${c6}"

    total_rx=$((total_rx + peer_rx))
    total_tx=$((total_tx + peer_tx))

    prev_rx="${prev_peer_rx[${peer_pub}]:-0}"
    delta_rx=$((peer_rx - prev_rx))
    prev_peer_rx[${peer_pub}]="${peer_rx}"

    if [ "${delta_rx}" -gt 0 ]; then
      active_delta=$((active_delta + 1))
      short_pub="${peer_pub:0:8}"
      echo "${now} | INCOMING | peer=${short_pub} endpoint=${peer_endpoint} allowed=${peer_allowed} +rx=${delta_rx}B tx=${peer_tx}B"
    fi

    if [ "${peer_hs}" -gt 0 ]; then
      age=$(( $(date +%s) - peer_hs ))
      if [ "${age}" -le 180 ]; then
        active_recent=$((active_recent + 1))
      fi
    fi
  done

  delta_total_rx=$((total_rx - prev_total_rx))
  delta_total_tx=$((total_tx - prev_total_tx))
  prev_total_rx="${total_rx}"
  prev_total_tx="${total_tx}"

  if [ "${delta_total_rx}" -lt 0 ]; then delta_total_rx=0; fi
  if [ "${delta_total_tx}" -lt 0 ]; then delta_total_tx=0; fi

  echo "${now} | SUMMARY | port=${iface_port} peers_recent=${active_recent} peers_rx_now=${active_delta} +rx=${delta_total_rx}B +tx=${delta_total_tx}B total_rx=${total_rx}B total_tx=${total_tx}B"
  sleep "${INTERVAL_SECONDS}"
done
