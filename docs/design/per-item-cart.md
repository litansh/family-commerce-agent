# Filling the cart item by item: what the screen may claim

**Decision this serves:** *is this item in the store's basket, or not?* — asked once per item, answered
by the store, never by us. This is ADR 0010's lowest cart rung: no recipe fills anything, the family
taps "הוספה" on the store's own product page inside Kaniti, and the rung below is the store's own
search page for the same words.

**The rule.** Kaniti does not touch this cart, so Kaniti may not report on it. The only evidence is the
store's own basket number rising while that item's page is on screen (`src/lib/basket.ts`). A number
that repeats, falls, or never arrives leaves the item unclaimed — the family is *asked* in the Orders
tab, not *told* on this screen. Promise 9 in its smallest form.

## The screen

```
┌──────────────────────────────────────────────┐
│ פריט 3 מתוך 12 ברמי לוי                   ✕ │   ← where am I
│ הוסיפו לסל בעמוד של הרשת, ואז ״הבא״.         │
├──────────────────────────────────────────────┤
│ [ בסל של רמי לוי: 2 ]   [ נוסף לסל ✓ ]       │   ← the store's number, and this item's verdict
├──────────────────────────────────────────────┤
│                                              │
│        the store's own page, its session     │
│                                              │
├──────────────────────────────────────────────┤
│            [    הפריט הבא    ]               │
└──────────────────────────────────────────────┘
```

One number on this screen and it is the store's. Ours is not shown, because on this rung we do not
have one — a tally of pages the family has walked past is not a tally of items in a basket.

## States

| State | What the screen shows |
|---|---|
| The store's page is open, nothing added yet | `בסל של {s}: {n}` alone — n is whatever the basket already held |
| The count rose while this item was on screen | `נוסף לסל ✓` beside it, green, and it stays as the family moves on |
| The count did not rise | nothing is said about this item — no red, no "not added": they may still tap |
| The store publishes no count (stor.ai, Wolt, Shufersal today) | `{s} לא מדווחת כמה בסל — ודאו את העגלה לפני התשלום.` in place of the chips |
| The last item | the button becomes `לסל של הרשת`, and the cart page is the recipe flow's own final state |
| "סיימתי" at the end | teaches the memory **only** the items the count confirmed; where there is no count, the whole list stays a question for the Orders tab, exactly as before |

The count is read on every page load *and* polled while a page is on screen: adding on a store's
product page does not reload anything, so a reading taken at load is stale precisely when it matters.

## What is deliberately left out

- **A per-item "הוספתי" button.** It would be the family reporting to us what the store already tells
  us, and it would let a mis-tap become a claim.
- **Our own count beside the store's.** Two numbers invite subtraction; on this rung one of them would
  be invented.
- **A red "לא נוסף".** Not adding yet is the normal state of a page that just opened.

## Proof

- `apps/mobile/test/basket.test.ts` — the rule, including the basket that already held six items, the
  store that answers `basket:?`, and the count that falls back.
- `apps/mobile/e2e/per-item-count.mjs` — the store's count recipe read on the store's *item* pages in
  WebKit, not only on its cart page. Nothing is submitted or added.
- The rise itself needs a hand: a person adding one item at Rami Levy, once, with the chip on screen.
