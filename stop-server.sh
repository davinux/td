#!/usr/bin/env bash
# Stop the static dev server started by start-server.sh.
# Usage: ./stop-server.sh [port]  (default: 8000)
PORT="${1:-8000}"

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
else
  pkill -f "http.server ${PORT}" 2>/dev/null || true
fi

echo "Stopped server on port ${PORT} (if it was running)."
