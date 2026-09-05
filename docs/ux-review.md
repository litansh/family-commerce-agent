# UX review — Kanili v0.1

**Date:** 2026-09-06 · **Method:** heuristic walk-through of every screen on the live site at phone width, tap-counting the three core jobs, against Nielsen's heuristics and the best list apps (Bring!, AnyList) and grocery apps (Instacart, Shufersal).

## The bar

> Every ordinary thing in three taps. Simple, clear, light.

| Job | Taps today | Target | Blocker |
|---|---|---|---|
| Do the usual weekly shop | open → tap 15 tiles → compare → option → order → approve (~19) | **3**: open → *Usual shop* → *Approve* | no one-tap "usual shop"; options screen makes you choose |
| Add one thing | type → tap card (2) | 2 | ✓ |
| Add something you forgot | tap tile (1) | 1 | ✓ |
| Compare and order | compare → option → order → approve (4) | **2**: compare → *Approve* | best option should be pre-chosen with one CTA |

## Findings and fixes

**F1 — The options screen asks a question the optimizer already answered.** Ranked options are shown as equal cards; the family must read, choose, then find the order button on the next screen. *Fix:* the best option is selected by default with a single sticky call to action — "Order through Kanili · ₪836" — and the alternatives collapse under "other ways to buy". (Instacart never shows you a comparison table; it shows a cart and a button.)

**F2 — No one-tap "usual shop".** The household's memory knows the rhythm; the list still starts empty every week. *Fix:* when memory holds ≥5 usuals, the list opens with a hero action — "Add the usual shop (14 items)" — that adds everything due or regularly bought in one tap, with the overdue ones first. The family removes the two things they don't want rather than adding fourteen they do.

**F3 — Waiting is a spinner.** 20 seconds of "comparing…" with nothing to look at. *Fix:* skeleton cards that resolve into real ones, and the line count and address as reassurance — the wait is real, so make it legible.

**F4 — Tap targets under 44pt.** The ✕ on rows, the ± steppers, the tile chips. *Fix:* every interactive element ≥44pt hit area (hitSlop where the visual is smaller).

**F5 — Too many words on screens that should be glanceable.** Sub-explanations under every card. *Fix:* one line of context per screen, and details behind a tap.

**F6 — Approval is the moment that matters and it looks like everything else.** *Fix:* the approval card is the only bordered card on its screen, total is the largest text in the app, the button says the amount.

**F7 — No feedback on add.** Tapping a tile silently moves it. *Fix:* haptic on native (done) plus a brief "added" toast.

**F8 — Sign-in screen explains too much.** Three sentences before the button. *Fix:* one line, two buttons.

## What already reads well
- One accent colour, one primary action per screen, tabular prices.
- Aisle grouping keeps a 40-line list scannable.
- Photos on cards make products recognisable at a glance.
- Hebrew RTL and English LTR from the same components.

## Still to do (design)
- A human designer's pass on type scale and spacing before store submission.
- Onboarding: the first shop with an empty memory is the weakest moment; seed from a scanned receipt or a past-orders import.
- Dark mode (the tokens are in place; the palette is not).
