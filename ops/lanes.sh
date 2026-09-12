#!/usr/bin/env bash
# The fleet in two lanes: each lane runs its agents one at a time (ops/fleet.sh), the two lanes run
# side by side. Half the wall-clock of a single queue, a quarter of the burn of five-at-once.
#   ops/lanes.sh                 the daily split
#   ops/lanes.sh --wait          run and wait (what ops/repair.sh does)
set -uo pipefail
cd "$(dirname "$0")/.."
LOGDIR="$HOME/.kaniti/health"; mkdir -p "$LOGDIR"
# Lane A: the two agents that judge and design (slower, more thinking). Lane B: the store-facing fixers.
ops/fleet.sh product-qa app-designer > "$LOGDIR/lane-a-$(date +%Y-%m-%d).log" 2>&1 &
A=$!
ops/fleet.sh store-recipe-fixer api-fixer price-portal-fixer > "$LOGDIR/lane-b-$(date +%Y-%m-%d).log" 2>&1 &
B=$!
echo "lane A (product-qa, app-designer) pid $A · lane B (stores, api, prices) pid $B"
[ "${1:-}" = "--wait" ] && { wait $A; wait $B; echo "both lanes done"; }
exit 0
