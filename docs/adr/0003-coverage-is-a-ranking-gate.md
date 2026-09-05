# ADR 0003 — Coverage is a ranking gate, not a display field

**Status:** accepted · 2026-09-05

## Context
On a real 36-line basket, four Wolt-hosted storefronts showed the lowest totals — ₪486 against
₪836 — while pricing only 10 to 15 of the 36 lines. They are not cheap; they are incomplete.
Presenting one as "cheapest" would cause exactly the top-up trip at makolet prices that this
household is trying to eliminate.

## Decision
A storefront below `minCoverageRatio` is not offered at all, and is reported under "not offered"
with the reason. Every option that *is* offered names the specific items it cannot supply.

## Consequences
- An initial 0.95 floor was too strict: on 36 lines it disqualified anything missing two items,
  which threw away both the Shufersal price comparison and a profitable split. Set to 0.90, with
  missing items surfaced per option so the family decides rather than the threshold.
- The Wolt storefronts at 28–56% are still correctly rejected.
