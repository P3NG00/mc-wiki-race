#!/usr/bin/env bash
# Starts headless Firefox with WebDriver BiDi and runs test/e2e.mjs against index.html.
# Needs firefox and node (>= 22, for the global WebSocket). Optional arg: directory for screenshots.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-9333}
PROFILE=$(mktemp -d)
trap 'kill "$FF" 2>/dev/null || true; rm -rf "$PROFILE"' EXIT
firefox --headless --remote-debugging-port="$PORT" --profile "$PROFILE" --no-remote about:blank >/dev/null 2>&1 &
FF=$!
for _ in $(seq 50); do (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null && break; sleep 0.2; done
node test/e2e.mjs "$PORT" "file://$PWD/index.html" "${1:-}"
