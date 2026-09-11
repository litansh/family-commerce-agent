#!/usr/bin/env bash
# Open a pull request from the current branch and post it to the Kaniti Telegram channel for approval.
#   ops/pr.sh "<title>" "<body file or text>"
# Pushes the branch, creates (or updates) the PR against main with gh, posts the link. Never merges.
set -euo pipefail
cd "$(dirname "$0")/.."
TITLE="$1"; BODY="${2:-}"
[ -f "$BODY" ] && BODY="$(cat "$BODY")"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != "main" ] || { echo "refusing: on main — create a branch first"; exit 1; }
git push -u origin "$BRANCH" >/dev/null 2>&1
if URL=$(gh pr view --json url --jq .url 2>/dev/null); then
  gh pr edit --title "$TITLE" --body "$BODY" >/dev/null
else
  URL=$(gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY")
fi
echo "$URL"
[ -f "$HOME/.kaniti/telegram.env" ] && { set -a; source "$HOME/.kaniti/telegram.env"; set +a; }
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  SUMMARY=$(printf '%s' "$BODY" | head -c 600)
  curl -s -m 15 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=🛒 PR for approval: $TITLE
$URL

$SUMMARY" >/dev/null || true
fi
