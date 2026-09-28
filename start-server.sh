#!/usr/bin/env bash
# Start a static dev server for the Tower Defense game.
# Usage: ./start-server.sh [port]  (default: 8000)
set -e
PORT="${1:-8000}"
cd "$(dirname "$0")"

# Stop any previous server on this port (ignore errors)
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
else
  pkill -f "http.server ${PORT}" 2>/dev/null || true
fi

nohup python3 -m http.server "${PORT}" > server.log 2>&1 &
echo "Serving td.davinux.net locally at http://localhost:${PORT} (pid $!, log: server.log) — live at https://td.davinux.net"
