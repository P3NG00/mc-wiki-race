#!/usr/bin/env bash
# Starts headless Firefox with WebDriver BiDi and runs test/e2e.mjs against index.html, or with --offline test/offline.mjs,
# which answers every request to the wiki itself. Needs firefox and node (>= 22, for the global WebSocket).
# Optional arg: directory for screenshots (e2e.mjs only). MWR_URL runs it against a served copy (a host's container, say)
# instead of this folder's index.html.
set -euo pipefail
cd "$(dirname "$0")/.."
TEST=e2e
if [ "${1:-}" = --offline ]; then TEST=offline; shift; fi
PORT=${PORT:-9333}
PROFILE=$(mktemp -d)
trap 'kill "$FF" 2>/dev/null || true; rm -rf "$PROFILE"' EXIT
# Headless Firefox has no pointer device, so it matches (hover: none). Report a mouse (fine pointer that hovers, 2 | 4),
# as a desktop browser does, so hover styles apply.
printf 'user_pref("ui.primaryPointerCapabilities", 6);\nuser_pref("ui.allPointerCapabilities", 6);\n' > "$PROFILE/user.js"
firefox --headless --remote-debugging-port="$PORT" --profile "$PROFILE" --no-remote about:blank >/dev/null 2>&1 &
FF=$!
for _ in $(seq 50); do (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null && break; sleep 0.2; done
node "test/$TEST.mjs" "$PORT" "${MWR_URL:-file://$PWD/index.html}" "${1:-}"
