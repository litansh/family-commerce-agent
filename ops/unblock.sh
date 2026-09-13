#!/usr/bin/env bash
# Keep every open pull request mergeable, before the owner meets one that is not.
#
#   ops/unblock.sh            merge main into every conflicting open PR, push, report
#   ops/unblock.sh --dry      say what would happen
#
# Union-merge handles the shared lists (.gitattributes); anything else that conflicts is left alone
# and named in the report, because a real code conflict is a decision, not a chore.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
git fetch -q origin
FIXED=(); STUCK=(); CLEAN=0
for N in $(gh pr list --state open --json number --jq '.[].number'); do
  read -r STATE BRANCH <<<"$(gh pr view "$N" --json mergeable,headRefName --jq '"\(.mergeable) \(.headRefName)"')"
  [ "$STATE" = CONFLICTING ] || { CLEAN=$((CLEAN+1)); continue; }
  [ "$DRY" = 1 ] && { STUCK+=("#$N $BRANCH (would try)"); continue; }
  W=$(mktemp -d "${TMPDIR:-/tmp}/fca-unblock-XXXX"); rm -rf "$W"
  if git worktree add -q "$W" -b "unblock/$N-$$" "origin/$BRANCH" 2>/dev/null; then
    if git -C "$W" merge --no-edit origin/main >/dev/null 2>&1; then
      git -C "$W" push -q origin "HEAD:$BRANCH" && FIXED+=("#$N $BRANCH")
    else
      LEFT=$(git -C "$W" diff --name-only --diff-filter=U | tr '\n' ' ')
      git -C "$W" merge --abort 2>/dev/null
      STUCK+=("#$N $BRANCH — needs a person: $LEFT")
    fi
    git worktree remove --force "$W" >/dev/null 2>&1
    git branch -D "unblock/$N-$$" >/dev/null 2>&1
  else
    STUCK+=("#$N $BRANCH — could not check out")
  fi
done
echo "unblock: ${#FIXED[@]} fixed, ${#STUCK[@]} need a person, $CLEAN already clean"
for x in "${FIXED[@]:-}"; do [ -n "$x" ] && echo "  fixed   $x"; done
for x in "${STUCK[@]:-}"; do [ -n "$x" ] && echo "  stuck   $x"; done
if [ "${#STUCK[@]}" -gt 0 ] && [ -f "$HOME/.kaniti/telegram.env" ]; then
  set -a; source "$HOME/.kaniti/telegram.env"; set +a
  curl -s -m 15 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=🛒 pull requests needing a person:
$(printf '%s\n' "${STUCK[@]}")" >/dev/null || true
fi
exit 0
