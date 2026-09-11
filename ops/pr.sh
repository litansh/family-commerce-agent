#!/usr/bin/env bash
# Open a pull request from the current branch, wait for CI, fix a red check before anyone sees it,
# then post the PR to the Kaniti Telegram channel for approval.
#   ops/pr.sh "<title>" "<body file or text>" [--no-wait]
# Pushes the branch, creates (or updates) the PR against main with gh, watches the checks; on a
# failure it runs a headless repair (api-fixer) on this branch, pushes, and watches again (twice).
# Never merges.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
TITLE="$1"; BODY="${2:-}"; WAIT=1; [ "${3:-}" = "--no-wait" ] && WAIT=0
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
tg() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && curl -s -m 15 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1" >/dev/null || true; }

STATUS="opened"
if [ "$WAIT" = 1 ]; then
  LOGDIR="$HOME/.kaniti/health"; mkdir -p "$LOGDIR"
  for attempt in 1 2 3; do
    sleep 20
    # Watch every check; gh exits non-zero when one fails. Skipped jobs (the deploy on a PR) are fine.
    if gh pr checks "$URL" --watch --fail-fast >/dev/null 2>&1; then STATUS="checks green"; break; fi
    STATUS="checks red"
    [ "$attempt" = 3 ] && break
    # What failed, verbatim, for the fixer.
    LOG="$LOGDIR/pr-ci-$(date +%Y-%m-%d_%H%M).log"
    for RUN in $(gh run list --branch "$BRANCH" --limit 5 --json databaseId,conclusion --jq '.[] | select(.conclusion=="failure") | .databaseId'); do gh run view "$RUN" --log-failed 2>/dev/null | tail -c 6000 >> "$LOG"; done
    echo "== CI red on $URL (attempt $attempt); repairing"; tg "🛒 $TITLE — CI red on attempt $attempt, the fixer is on it: $URL"
    claude -p "You are Kaniti's api-fixer (read .claude/agents/api-fixer.md and CLAUDE.md). The pull request $URL on branch $BRANCH has a red CI check. The failing log is at $LOG. Reproduce locally with the same commands the workflow runs (.github/workflows/ci.yml: npm run typecheck, npm test, npm run check:recipes -w apps/mobile, npx tsc --noEmit -p apps/mobile/tsconfig.json, npm run build -w apps/api), fix the cause (never weaken a test or a promise to pass), commit on this branch with a message that names what broke, and push origin $BRANCH. Do not merge, do not touch main." \
      --permission-mode acceptEdits --max-turns 60 \
      --allowedTools "Read,Grep,Glob,Edit,Write,Bash(node *),Bash(npx *),Bash(npm *),Bash(git *),Bash(gh *),Bash(cat *),Bash(ls *)" >> "$LOG" 2>&1 || true
  done
fi
# The agents' review, from this Mac with the local login, so every PR gets one without any key in GitHub.
PRNUM=$(gh pr view "$URL" --json number --jq .number 2>/dev/null || true)
[ -n "$PRNUM" ] && (ops/pr-review.sh "$PRNUM" >/dev/null 2>&1 &)
SUMMARY=$(printf '%s' "$BODY" | head -c 600)
tg "🛒 PR for approval ($STATUS): $TITLE
$URL

$SUMMARY"
[ "$STATUS" = "checks red" ] && exit 1 || exit 0
