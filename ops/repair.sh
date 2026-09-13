#!/usr/bin/env bash
# The orchestrator: run every check; when something is unhealthy, hand the report to a
# headless Claude Code run that dispatches the matching repair sub-agent (.claude/agents),
# verifies with the same checks, commits and pushes. Then check again and say what happened.
#
#   ops/repair.sh [--sim]        (launchd runs it every morning; run it by hand any time)
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:/usr/local/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
LOGDIR="$HOME/.kaniti/health"; mkdir -p "$LOGDIR"
STAMP=$(date +%Y-%m-%d_%H%M); LOG="$LOGDIR/run-$STAMP.log"
# A macOS notification, and Telegram when ~/.kaniti/telegram.env has TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
[ -f "$HOME/.kaniti/telegram.env" ] && { set -a; source "$HOME/.kaniti/telegram.env"; set +a; }
notify() {
  osascript -e "display notification \"$2\" with title \"Kaniti ops\" subtitle \"$1\"" >/dev/null 2>&1 || true
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -m 15 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=🛒 Kaniti ops · $1: $2" >/dev/null || true
  fi
}

echo "== check $(date)" | tee -a "$LOG"
if node ops/check.mjs "$@" 2>&1 | tee -a "$LOG"; then
  notify "healthy" "every check passed"
  # The briefing goes out every day, healthy or not: its absence is what a dead bot looks like.
  node ops/briefing.mjs 2>&1 | tee -a "$LOG"
  # The scout: who delivers to our families today, and which storefront is new or not yet connectable.
  node --experimental-strip-types ops/store-scout.mjs 2>&1 | grep -v Warning | tee -a "$LOG"
  # מבצעים second rung (docs/BACKLOG.md, ADR 0011): named deals read from the chains' own PromoFull
  # files, on this Mac, for /deals to fall back on when the pricing provider's own feed goes thin.
  node --experimental-strip-types services/branch-prices/refresh-deals.mjs 2>&1 | tail -15 | tee -a "$LOG"
  # Rami Levy's online branches, geocoded and placed on the map (docs/BACKLOG.md, ADR 0011): the
  # API Lambda's own attempt is blocked (a data centre gets Rami Levy's block page), so this Mac is
  # the only place that can actually reach it and write CATALOG#RL_BRANCHES for the API to read.
  node --experimental-strip-types services/retailer-connectors/refresh-branches.mjs 2>&1 | tail -5 | tee -a "$LOG"
  # Hatzi Hinam's own stock, from this Mac (docs/BACKLOG.md, ADR 0011): a barcode the guest session
  # says is out of stock drops from its compare card; CATALOG#HH_STOCK is what the API reads.
  node --experimental-strip-types services/retailer-connectors/refresh-hazi-hinam-stock.mjs 2>&1 | tail -5 | tee -a "$LOG"
  # Open pull requests without an agents' review get one (the review workflow needs a key; this needs only this Mac).
  for n in $(gh pr list --state open --json number --jq '.[].number' 2>/dev/null); do ops/pr-review.sh "$n" 2>&1 | tail -1 | tee -a "$LOG"; done
  # The product review runs on green days too: a promise can be broken while every check passes.
  ops/qa.sh
  # Nothing the owner opens should be unmergeable.
  ops/unblock.sh 2>&1 | tee -a "$LOG"
  # Then the fleet works the backlog in two lanes; each lane is serial and resumes around a usage limit.
  ops/lanes.sh --wait
  exit 0
fi

echo "== repair $(date)" | tee -a "$LOG"
REPORT="$LOGDIR/latest.json"
PROMPT="You are the Kaniti ops orchestrator. Every decision is made by the agent that owns it (CLAUDE.md); you route, you weigh their answers when they disagree, and you write the decision into the pull request body. The health report at $REPORT (and ~/.kaniti/health/stores.json for stores) shows what is unhealthy right now. Delegate one sub-agent at a time (usage is a budget; never several in parallel), each told to start from docs/CONTEXT.md and node ops/find.mjs. For each failing check, delegate to the matching sub-agent: a screen that is confusing or grew feature by feature -> app-designer (design proposal first, as a PR); 'stores' or 'cart' -> store-recipe-fixer; 'prices' -> price-portal-fixer; 'sim' -> sim-flow-fixer; 'api', 'unit', 'recipes' or 'shopper' -> api-fixer (the shopper check is the whole product through the API as a family of five: cheap, fast, split, substitutes, in-store). Give each agent the failing rows verbatim. After the agents report, run 'node ops/check.mjs --only <the checks that failed>' yourself; only when they pass, commit on a branch named ops/<date>-<what> with a message that names the store/portal and what changed, and open a pull request with ops/pr.sh "<title>" "<body>" (it posts the PR to the Telegram channel for the owner's approval). Never push to main and never merge. If a fix needs the person (a store locked an account, a portal moved behind a login we do not have, a Terraform change), do not guess: write it to ops/NEEDS-HUMAN.md and stop. Never submit a store's login, send an SMS or e-mail, create an account, or store PII."
claude -p "$PROMPT" --permission-mode acceptEdits --max-turns 120 \
  --allowedTools "Read,Grep,Glob,Edit,Write,Agent,Bash(node *),Bash(npx *),Bash(npm *),Bash(git *),Bash(./maestro/*),Bash(bash maestro/*),Bash(curl *),Bash(ls *),Bash(cat *),Bash(sed *)" \
  2>&1 | tee -a "$LOG"

echo "== recheck $(date)" | tee -a "$LOG"
if node ops/check.mjs "$@" 2>&1 | tee -a "$LOG"; then
  notify "repaired" "checks pass after the repair run"; node ops/briefing.mjs 2>&1 | tee -a "$LOG"; ops/qa.sh; ops/lanes.sh --wait; exit 0
fi
notify "still unhealthy" "see $LOG"
node ops/briefing.mjs 2>&1 | tee -a "$LOG"
exit 1
