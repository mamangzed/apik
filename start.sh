#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PORT="${PORT:-2611}"
APP_HOST="${HOST:-0.0.0.0}"
PID_FILE="$ROOT_DIR/.apik-backend.pid"
MODE="${1:-start}"

echo "========================================="
echo " APIK Production Launcher"
echo "========================================="
echo

command -v node >/dev/null 2>&1 || {
  echo "Node.js is required but was not found in PATH."
  exit 1
}

command -v npm >/dev/null 2>&1 || {
  echo "npm is required but was not found in PATH."
  exit 1
}

if [ ! -d "$ROOT_DIR/backend/node_modules" ]; then
  echo "[1/4] Installing backend dependencies..."
  npm --prefix "$ROOT_DIR/backend" install
fi

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "[2/4] Installing frontend dependencies..."
  npm --prefix "$ROOT_DIR/frontend" install
fi

echo "[3/4] Building production assets..."
npm --prefix "$ROOT_DIR" run build

echo "[4/5] Checking existing process on port $APP_PORT..."
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PID="$(lsof -ti tcp:"$APP_PORT" -sTCP:LISTEN || true)"
  if [ -n "$EXISTING_PID" ]; then
    echo "Found process PID $EXISTING_PID on port $APP_PORT. Stopping it..."
    kill -9 "$EXISTING_PID" || true
    sleep 1
  else
    echo "No process is listening on port $APP_PORT."
  fi
else
  echo "lsof is not installed, skipping automatic port cleanup."
fi

if [ "$MODE" = "stop" ]; then
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE")"
    if kill -0 "$PID" >/dev/null 2>&1; then
      echo "Stopping APIK backend (pid $PID)..."
      kill "$PID"
      rm -f "$PID_FILE"
      exit 0
    fi
  fi
  echo "APIK backend is not running."
  exit 0
fi

if [ "$MODE" = "status" ]; then
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE")"
    if kill -0 "$PID" >/dev/null 2>&1; then
      echo "APIK backend is running (pid $PID)."
      exit 0
    fi
  fi
  echo "APIK backend is not running."
  exit 1
fi

echo "[5/5] Starting production server on $APP_HOST:$APP_PORT..."
export NODE_ENV=production
export PORT="$APP_PORT"
export HOST="$APP_HOST"

if [ "$MODE" = "start-bg" ] || [ "$MODE" = "daemon" ]; then
  nohup node "$ROOT_DIR/backend/dist/index.js" >"$ROOT_DIR/apik.log" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Started in background. PID: $(cat "$PID_FILE")"
  echo "Logs: $ROOT_DIR/apik.log"
  exit 0
fi

exec node "$ROOT_DIR/backend/dist/index.js"