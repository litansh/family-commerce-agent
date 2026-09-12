#!/usr/bin/env bash
# The fleet, one agent at a time. Each agent runs headless in its own worktree and branch, on the
# model its charter names, commits WIP as it goes, and opens pull requests with ops/pr.sh. When the
# account's session limit stops a run ("You've hit your session limit · resets 3:20pm"), the runner
# waits for the reset and resumes the same session - nothing is lost and nothing runs twice.
#
#   ops/fleet.sh [agent ...]              default: every charter in .claude/agents, in this order
#   ops/lanes.sh                          two lanes at once (what the daily run uses)
#   ops/fleet.sh product-qa               one agent
#   FLEET_TASK="..." ops/fleet.sh api-fixer   a specific task instead of "work the backlog"
#
# One agent at a time inside a lane. ops/lanes.sh runs two lanes side by side: fast enough for a
# day's backlog, far from the five-at-once on the biggest model that emptied the budget every day. Log: ~/.kaniti/health/fleet-<date>.log
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:/usr/local/bin:$PATH"
ROOT=$(pwd); LOGDIR="$HOME/.kaniti/health"; mkdir -p "$LOGDIR"; LOG="$LOGDIR/fleet-$(date +%Y-%m-%d_%H%M).log"
AGENTS=("$@"); [ ${#AGENTS[@]} -gt 0 ] || AGENTS=(product-qa store-recipe-fixer api-fixer price-portal-fixer app-designer sim-flow-fixer)
[ -f "$HOME/.kaniti/telegram.env" ] && { set -a; source "$HOME/.kaniti/telegram.env"; set +a; }
tg() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && curl -s -m 15 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1" >/dev/null || true; }
# "resets 3:20pm (Asia/Jerusalem)" → seconds to sleep (plus a minute), never more than 6 h.
until_reset() {
  local when; when=$(grep -o 'resets [0-9]\{1,2\}:[0-9]\{2\}[ap]m' "$1" | tail -1 | awk '{print $2}')
  [ -n "$when" ] || { echo 1800; return; }
  local now target; now=$(date +%s); target=$(LC_ALL=C date -j -f "%Y-%m-%d %I:%M%p" "$(date +%Y-%m-%d) $when" +%s 2>/dev/null || echo $((now + 1800)))
  [ "$target" -le "$now" ] && target=$((target + 86400))
  local s=$((target - now + 60)); [ "$s" -gt 21600 ] && s=21600; echo "$s"
}

for A in "${AGENTS[@]}"; do
  CH="$ROOT/.claude/agents/$A.md"; [ -f "$CH" ] || { echo "no charter for $A" | tee -a "$LOG"; continue; }
  MODEL=$(sed -n '/^---$/,/^---$/p' "$CH" | awk -F': ' '/^model:/{print $2}'); [ "$MODEL" = inherit ] && MODEL=sonnet; MODEL=${MODEL:-sonnet}
  DAY=$(date +%Y-%m-%d); BR="$A/$DAY"; WT="/tmp/fca-fleet-$A"
  git fetch -q origin main
  # An existing worktree (yesterday's run, a saved WIP branch) is continued, not replaced - unless its
  # branch is already merged, in which case a fresh branch starts from main. Either way main is merged
  # in first, so the agent works on the product as it is (the rules, the context page, the last fixes).
  if [ -d "$WT" ]; then
    BR=$(git -C "$WT" rev-parse --abbrev-ref HEAD)
    if git merge-base --is-ancestor "$(git -C "$WT" rev-parse HEAD)" origin/main; then BR="$A/$DAY"; git -C "$WT" checkout -q -B "$BR" origin/main; else git -C "$WT" merge -q --no-edit origin/main >/dev/null 2>&1 || git -C "$WT" merge --abort 2>/dev/null; fi
  else git worktree add -q -B "$BR" "$WT" origin/main 2>/dev/null || git worktree add -q "$WT" "$BR"; fi
  ( cd "$WT" && [ -d node_modules ] || ln -s "$ROOT/node_modules" node_modules; [ -e apps/mobile/node_modules ] || ln -s "$ROOT/apps/mobile/node_modules" apps/mobile/node_modules ) 2>/dev/null
  SID=$(uuidgen | tr 'A-Z' 'a-z'); OUT="$LOGDIR/fleet-$A-$DAY.out"
  TASK="${FLEET_TASK:-Work the lines that name you in docs/BACKLOG.md and anything in docs/PRODUCT-REVIEW.md that is yours, one line at a time: reproduce in the smallest lab, fix, prove with the same lab, commit and push WIP as you go, and open one pull request per line with ops/pr.sh (it posts to Telegram for the owner). Stop after three pull requests or when nothing of yours is left; finish with a five-line report.}"
  PROMPT="You are Kaniti's $A agent. Read docs/CONTEXT.md and .claude/agents/$A.md first, nothing else up front. You are in the worktree $WT on branch $BR (never touch main). Run git log --oneline origin/main..HEAD and git diff origin/main --stat first: that is your saved work in progress - finish and prove it before anything new. $TASK"
  echo "== $A ($MODEL) on $BR at $(date)" | tee -a "$LOG"; tg "🛒 fleet · $A starts ($MODEL) on $BR"
  ATTEMPT=0; ARGS=(--session-id "$SID")
  while :; do
    ATTEMPT=$((ATTEMPT + 1))
    ( cd "$WT" && claude -p "$PROMPT" "${ARGS[@]}" --model "$MODEL" --permission-mode acceptEdits --max-turns 140 \
        --allowedTools "Read,Grep,Glob,Edit,Write,Bash(node *),Bash(npx *),Bash(npm *),Bash(git *),Bash(gh *),Bash(./ops/*),Bash(ops/*),Bash(bash ops/*),Bash(./maestro/*),Bash(bash maestro/*),Bash(aws logs *),Bash(aws dynamodb get-item *),Bash(aws dynamodb scan *),Bash(curl *),Bash(ls *),Bash(cat *),Bash(sed *),Bash(head *),Bash(tail *),Bash(wc *)" ) > "$OUT" 2>&1
    # A run killed from outside (a stray pkill, the OS) or ended without its report is resumed, not skipped.
    if grep -q "Killed: 9\|Terminated: 15" "$OUT" || [ "$(wc -c < "$OUT")" -lt 200 ]; then
      echo "   run ended early ($(tail -c 120 "$OUT" | tr '\n' ' ')); resuming in 2 min" | tee -a "$LOG"
      sleep 120; ARGS=(--resume "$SID"); PROMPT="Continue exactly where you stopped; your WIP is committed on $BR."; [ "$ATTEMPT" -lt 8 ] && continue
    fi
    if grep -q "hit your session limit\|rate_limit" "$OUT"; then
      S=$(until_reset "$OUT"); echo "   limit reached; resuming in $((S / 60)) min" | tee -a "$LOG"; tg "🛒 fleet · $A paused by the usage limit, resumes in $((S / 60)) min"
      sleep "$S"; ARGS=(--resume "$SID"); PROMPT="Continue exactly where you stopped; your WIP is committed on $BR."; [ "$ATTEMPT" -lt 8 ] && continue
    fi
    break
  done
  # Whatever the agent left uncommitted is kept.
  ( cd "$WT" && git add -A ':!node_modules' ':!apps/mobile/node_modules' ':!**/tsconfig.tsbuildinfo' ':!apps/api/dist-types' >/dev/null 2>&1 && git commit -q -m "WIP: saved by the fleet runner" >/dev/null 2>&1 && git push -q -u origin "$BR" >/dev/null 2>&1 ) || true
  tail -c 1200 "$OUT" | tee -a "$LOG"; tg "🛒 fleet · $A done: $(tail -c 700 "$OUT")"
done
echo "== fleet done $(date)" | tee -a "$LOG"
