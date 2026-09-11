# The compare screen ("איך לקנות") — design proposal

Status: proposal for the owner's approval. Nothing here is built yet.

## The decision this screen exists for
"Where do I buy this list today?" One answer, chosen in under thirty seconds, with the
trade-offs visible but not shouted. Promises 1–4 (the whole picture, cheapest and
fastest with why, nothing dropped for one item, honest numbers).

## What is wrong today
The screen grew feature by feature: a mode switch, up to three option cards, a store
table, a "why not" fold, an in-store card, chips for coupons, coverage, substitutions,
ETAs. Each is right; together they bury the decision. Today's reports: "it tells me to
buy everything at Shufersal without the alternatives", a provider code on a card, and a
saving computed against the wrong baseline.

## Information hierarchy
1. **The answer** — one card: where, how much, when, and the one thing you should know
   (a missing item, a swap, two deliveries).
2. **The alternatives** — every store, one row each, same shape: price · when · what it
   lacks. Rows are the same kind of thing as the answer, so comparing is reading down a
   column, not decoding chips.
3. **Driving there** — the same rows, for the branches near home, in the same shape.
4. **The controls** — cheap / balanced / fast stays, above the answer; it re-orders,
   never hides.

Left out on purpose: the "why not" fold (its content moves into the rows), coverage
percentages (replaced by named items), the separate substitution chip (replaced by the
swap line), and the coupon chip (folded into the price with a small "כולל קופון").

## Every store row is the same sentence
```
[logo] רמי לוי                          ₪180   ~חלון משלוח
       חסר: סלמון · חלופה: עגבניות → שרי       +₪68 להשלמה
```
- price is the delivered total (items + delivery); the completed total sits under it
  when something is missing.
- the second line is only the exceptions: missing items, swaps, "חסרים ₪40 למינימום".
  A store with nothing to say has no second line.
- tapping a row expands it: the full line-by-line for that store, the swaps with the
  original names, and "קנו כאן" — every store is orderable, not only the winner.

## The answer card
```
┌──────────────────────────────────────────────┐
│  הכי זול · רמי לוי + ויקטורי (וולט)   ₪852   │
│  שני משלוחים · וולט ~35 דק׳ · רמי לוי בחלון  │
│  חוסך ₪51 לעומת הכל ברמי לוי                 │
│  ▸ 32 פריטים ברמי לוי · 6 בוולט              │
│  [ קנו דרך קניתי ]                            │
└──────────────────────────────────────────────┘
```
One number. One line of when. One line of why. The legs fold open.

## States
- **Loading**: the skeleton of the answer card plus three rows; "עוד ~20 שניות".
- **One store only**: the answer card, then the rows — each with its reason — so "only
  Shufersal" is never a mystery.
- **Split**: the answer card names both stores and both deliveries; the alternatives
  include the best single store right under it with the difference.
- **Missing everywhere**: the item is named at the top: "אין סלמון באף חנות היום" with
  "הסירו" / "החליפו" actions, and the rest of the compare goes on.
- **Nothing delivers**: the in-store rows lead; the copy says why.
- **Error**: one sentence, one retry, the list untouched.

## Words on the buttons (Hebrew)
- קנו דרך קניתי · קנו כאן (per row) · החליפו · הסירו · נסו שוב
- modes: הכי זול · מאוזן · הכי מהר

## What changes in the data (already there)
Everything the rows need is in the quote: options, rejected with reasons, storefront
lines with swaps, missing estimates, ETAs, drive rows with the same-lines comparison.
No API change is required for this design.

## Build plan (after approval)
1. `StoreRow` component: one shape for options, rejected stores and branches.
2. Answer card on top of it; alternatives as rows; drive rows as rows.
3. Remove the table, the fold and the chips it replaces; keep the mode control.
4. Simulator: `order.yaml` stays green; screenshots of every state into the PR.
