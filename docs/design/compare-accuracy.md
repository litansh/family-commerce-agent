# The compare, accurate — what the numbers on "איך לקנות" are allowed to say

Backlog: *"The compare must be accurate and beautiful — every number named, every swap named, every
store's own product shown, nothing that needs a second screen to understand."* (owner, 13 Sep 2026)

This is not a new screen. `docs/design/compare-screen.md` is approved and built. This note is the
audit of where the build departs from it, read off **one real compare for the test family**
(`node apps/mobile/e2e/compare-capture.mjs`, 8 lines, 2 options, 10 rejected stores, 1 branch), and
the rule each departure now obeys.

## The decision this screen exists for
Unchanged: "where do I buy this list today?", in under thirty seconds. What changes is that every
number a family reads is now one they could recompute from the same response, and no number stands
next to another it is not comparable with (promise 4).

## What the real compare showed

| Read on the screen | What the response says | Promise |
|---|---|---|
| `ויקטורי \| אלנבי (וולט) · משלוח בחלון` | `eta.kind = "closed"`, `text: "נפתח ביום מחר בשעה 07:00"` — four Wolt venues shut until tomorrow | 2, 9 |
| `הסל השלם הזול ביותר מרשת אחת` and no figure | רמי לוי ₪134.89 against שופרסל ₪173.10 + ₪13.90 to complete — a ₪52.11 saving nobody is told | 2 |
| `שופרסל ONLINE  ₪173.10 · להשלמה ≈₪13.90` | a 7-of-8 basket in the same column as a complete ₪134.89 one, with no completed total | 4 |
| `קרפור אונליין  ₪154.28` in full ink | items only, no delivery — not the same kind of number as ₪134.89 | 4 |
| a split alternative's lines | the row reads `legs[0]` only: it names leg 0's products for lines leg 1 buys, and calls leg 1's lines "missing" | 3, 4 |

The last one has no example in today's capture (both options are single-store) and is the one that
would have gone on hiding: it is the same mix-up PR #54 fixed on the answer card, one layer down, in
the alternatives.

## The rules, now enforced

1. **A store that is closed says it is closed.** `slots` → "משלוח בחלון". `closed` → the venue's own
   sentence when Wolt gave one, else "סגור · נפתח ב־{שעה}", else "סגור עכשיו", in the warn tone, and
   it sorts after every open store — "הכי מהר" may never name a shop that is shut.
2. **The answer names its saving.** Against the cheapest complete alternative when one exists (exact,
   like for like); otherwise against the cheapest alternative's *completed* total, written `≈` and
   "עם השלמה". When there is no alternative at all, the reason stands alone — that is the only case.
3. **An incomplete basket carries its completed total.** The design already said so: "the completed
   total sits under it when something is missing". The difference from the answer is computed on that
   completed total, never on the partial one.
4. **A price that is not a delivered total does not look like one.** A rejected store's number is
   items only: muted ink, and the note says for how many lines and that delivery is not in it.
5. **A row is its whole option.** Missing lines come from the option's own `unpricedLineIds`; a swap
   is named only on the leg that actually buys that line; unfolding a split shows each leg with its
   own brand, its own money and its own products — the answer card's shape, reused.

## What is deliberately still out
- **A per-store price per line.** `storefrontLines[sid][lineId].price` does not exist, so a row can
  name each store's product but not what that store charges for it. Backlog line, *api-fixer*; until
  it lands, `רמי לוי ₪6.20 (תנובה 1 ל')` stays half a sentence and the screen does not fake the half.
- **A delivered total for a rejected store.** The response carries `minimumOrder` but no delivery fee
  for a store that was rejected, so there is nothing honest to add. Rule 4 is the answer instead.
- Coverage percentages (named items instead) and the "why not" fold — left out by the approved design.

## Where the rules live
In `apps/mobile/src/lib/compare.ts`, free of React and of i18n, next to `quote.ts#productAt` — which
is what makes rule 1–5 checkable. `apps/mobile/e2e/compare-accuracy.mjs` runs them over a real
compare and fails on each, so the same failure turns a check red before a family meets it again.
The module returns kinds, ids and minor units; the screen does the words. A rule expressed as a
regex over rendered Hebrew (`/דק|min/.test(when)`, which is how the ETA chip picked its tone) is a
rule no lab can check — that is how a closed store came to read as a delivery window.
