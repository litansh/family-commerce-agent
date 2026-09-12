#!/usr/bin/env bash
# The agents' review of a pull request, run on this Mac with the local Claude login (no key needed):
# the product-qa agent judges the diff against the promises and posts one review comment.
#   ops/pr-review.sh <pr-number>
# Called by ops/pr.sh after a PR is opened, and by the daily run for any open PR without a review.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
PR="$1"
[ -n "$PR" ] || { echo "usage: ops/pr-review.sh <pr-number>"; exit 1; }
# Already reviewed by an agent? One review per head commit.
HEAD=$(gh pr view "$PR" --json headRefOid --jq .headRefOid)
if gh pr view "$PR" --json comments --jq '.comments[].body' | grep -q "agents-review:$HEAD"; then echo "PR #$PR already reviewed at $HEAD"; exit 0; fi
DIR=$(mktemp -d /tmp/fca-review-XXXX)
gh pr checkout "$PR" --repo litansh/family-commerce-agent >/dev/null 2>&1 || true
git worktree add -q "$DIR" "$(gh pr view "$PR" --json headRefName --jq .headRefName)" 2>/dev/null || git worktree add -q "$DIR" HEAD
cd "$DIR"
git fetch -q origin main
REVIEW=$(claude -p "You are Kaniti's product-qa agent reviewing pull request #$PR. Read CLAUDE.md, docs/WHAT-WE-PROMISE.md and .claude/agents/product-qa.md first. Then read the diff (git diff origin/main...HEAD) and judge it against the promises: which promise it keeps or touches, what could break for a family, whether every number stays honest, whether anything internal reaches the screen, whether the new rule has a test. Run what you can: npm run typecheck; npm test; npm run check:recipes -w apps/mobile; npx tsc --noEmit -p apps/mobile/tsconfig.json. Do not push. Answer with ONE review under 40 lines: first line 'verdict: approve' or 'verdict: needs changes', then the promises touched, findings with file and line, and what the simulator run on the Mac should look at. Hebrew product words may stay in Hebrew." \
  --model sonnet --allowedTools "Read,Grep,Glob,Bash(git *),Bash(npm *),Bash(npx *),Bash(node *)" --max-turns 40 2>/dev/null)
cd - >/dev/null; git worktree remove --force "$DIR" >/dev/null 2>&1
[ -n "$REVIEW" ] || { echo "no review produced"; exit 1; }
gh pr comment "$PR" --body "$(printf '%s\n\n<!-- agents-review:%s -->' "$REVIEW" "$HEAD")" >/dev/null && echo "reviewed PR #$PR"
