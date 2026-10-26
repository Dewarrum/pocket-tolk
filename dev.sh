#!/usr/bin/env bash
# Local development: the backend on :8080 and Vite on :5173 (Vite proxies /api).
# Set PORT to move the backend; the Vite proxy follows it.
#   ./dev.sh           both
#   ./dev.sh backend   backend only
# Secrets come from ~/.config/pocket-tolk/.env (override with POCKET_TOLK_ENV).
# Variables already set in the environment win over the file.
set -euo pipefail
cd "$(dirname "$0")"

env_file="${POCKET_TOLK_ENV:-$HOME/.config/pocket-tolk/.env}"
if [[ -f "$env_file" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    [[ -n "${!key+set}" ]] || export "$key=$value"
  done <"$env_file"
else
  echo "dev.sh: $env_file not found, using the current environment only" >&2
fi
export APP_TOKEN="${APP_TOKEN:-dev-token}"
export ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-http://localhost:5173}"
export PORT="${PORT:-8080}"

(cd backend && go build -o bin/server ./cmd/server)
backend/bin/server &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM

if [[ "${1:-}" == "backend" ]]; then
  wait "$backend_pid"
  exit
fi

cd frontend
[[ -d node_modules ]] || npm install
npm run dev -- --port 5173 --strictPort
