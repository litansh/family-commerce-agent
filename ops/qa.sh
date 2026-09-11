#!/usr/bin/env bash
# The daily product review: the product-qa agent reads docs/WHAT-WE-PROMISE.md and judges the
# product with real data (both test carts, yesterday's compares from phones, the simulator's
# screenshots). Runs after the health checks whether they were green or not — a promise can be
# broken while every check passes. Opens pull requests; never pushes.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOGDIR="$HOME/.kaniti/health"; mkdir -p "$LOGDIR"; LOG="$LOGDIR/qa-$(date +%Y-%m-%d_%H%M).log"
eval "$(AWS_PROFILE=personal-cfo aws configure export-credentials --profile personal-cfo --format env 2>/dev/null)" 2>/dev/null || true
PROMPT="Run the daily product review as the product-qa sub-agent: judge Kaniti against docs/WHAT-WE-PROMISE.md using today's shopper JSON (~/.kaniti/health/test-cart.json and test-cart-short.json), the last 24 hours of '\"event\":\"quote\"' lines from the fca-api log if AWS answers (say so if it does not), and the simulator screenshots under apps/mobile/maestro/shots/. For every broken promise: reproduce, fix or add the missing check, prove it, and open a pull request via ops/pr.sh. Finish with a short report: promises checked, broken ones with evidence, PRs opened. If nothing is broken, say so in one line."
claude -p "$PROMPT" --permission-mode acceptEdits --max-turns 100 \
  --allowedTools "Read,Grep,Glob,Edit,Write,Agent,Bash(node *),Bash(npx *),Bash(npm *),Bash(git *),Bash(./ops/*),Bash(ops/*),Bash(aws logs *),Bash(aws dynamodb get-item *),Bash(aws dynamodb scan *),Bash(curl *),Bash(ls *),Bash(cat *),Bash(sed *)" \
  2>&1 | tee -a "$LOG"
[ -f "$HOME/.kaniti/telegram.env" ] && { set -a; source "$HOME/.kaniti/telegram.env"; set +a; }
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  TAIL=$(tail -c 900 "$LOG")
  curl -s -m 15 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=🛒 product review · $(date +%Y-%m-%d)
$TAIL" >/dev/null || true
fi
