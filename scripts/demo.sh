#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Starting ILM backend..."
cd "$(dirname "$0")/../backend"
npm install --silent
nohup npm run dev >/tmp/ilm-backend.log 2>&1 &
BACKEND_PID=$!
sleep 2

echo "[2/3] Backend health check"
curl -s http://localhost:8787/health || true

echo "[3/3] Open UI"
echo "Open this file in browser: $(cd ../ui && pwd)/index.html"
echo "Backend log: /tmp/ilm-backend.log"
echo "Backend pid: ${BACKEND_PID}"
