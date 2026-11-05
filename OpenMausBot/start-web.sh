#!/usr/bin/env bash
# Start OpenMausBot as a local web app (loopback only, single owner) and print a pairing link.
# Usage: ./start-web.sh            -> start server on http://127.0.0.1:8799
#        ./start-web.sh pair       -> print a fresh single-use pairing code for an already-running server
set -euo pipefail
cd "$(dirname "$0")"
export PATH=/opt/node24/bin:$PATH
DATA_DIR="$PWD/.omb-data"
PORT=8799
if [ "${1:-}" = "pair" ]; then
  exec node --experimental-strip-types server/openmausbot.ts pair --port "$PORT" --data-dir "$DATA_DIR"
fi
if [ ! -f dist/index.html ]; then
  echo "building web UI (first time only)..."
  NODE_OPTIONS=--max-old-space-size=8192 pnpm exec vite build
fi
exec node --experimental-strip-types server/openmausbot.ts serve --port "$PORT" --data-dir "$DATA_DIR" --no-open
