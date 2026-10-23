#!/usr/bin/env bash
# Publishes dist-pages/ to the gh-pages branch under hub/ (the student's website).
# Usage: scripts/deploy-pages.sh "<commit message>"
# GHP_DIR: a clone of the repo checked out on gh-pages (default: scratchpad clone).
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:-Student hub: website update}"
GHP_DIR="${GHP_DIR:-/tmp/claude-0/-home-user-openclaw/c6c7c2c9-6e8c-5c7d-8ac2-0faf85b0d800/scratchpad/ghp}"
if [ ! -d "$GHP_DIR/.git" ]; then
  echo "No gh-pages clone at $GHP_DIR" >&2
  exit 1
fi
[ -f dist-pages/index.html ] || { echo "Run npm run build:pages first" >&2; exit 1; }
git -C "$GHP_DIR" pull --ff-only origin gh-pages >/dev/null
rm -rf "$GHP_DIR/hub"
mkdir -p "$GHP_DIR/hub"
cp -r dist-pages/. "$GHP_DIR/hub/"
git -C "$GHP_DIR" add hub
if git -C "$GHP_DIR" diff --cached --quiet; then
  echo "Website already up to date"
  exit 0
fi
git -C "$GHP_DIR" -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "$MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FQN13h1FeRz1TnJkL3yTRB"
for i in 1 2 3 4; do
  if git -C "$GHP_DIR" push origin gh-pages >/dev/null 2>&1; then
    echo "Website deployed: $(git -C "$GHP_DIR" rev-parse --short HEAD)"
    exit 0
  fi
  sleep $((2 ** i))
done
echo "Push failed" >&2
exit 1
