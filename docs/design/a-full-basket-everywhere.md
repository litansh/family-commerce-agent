# A full basket at every store, and what your exact one costs

**The owner's words, 13 September:** "הוא חייב להציע סל מלא אצל כולם, אבל כל אחד עם אלטרנטיבה
מסוימת ואם היוזר רוצה דווקא את הסל שלו - תן לו, הוא פשוט צריך להבין שזה עולה יותר ב-xxx",
and before it: "היוזר לא יזמין הרי סל חלקי", and "אתה מחובר להמון חנויות אז אין סיבה שלא יהיו
אלטרנטיבות".

## The decision this screen serves

Not "which store has most of my list" — nobody orders a partial basket. It is **"where do I buy all
of it, and what does my exact version cost?"**

## The model

Every store that delivers gets **two prices**, not one:

| | What it is | When it is the answer |
|---|---|---|
| **Full basket** | every line, using this store's own nearest product wherever it lacks the exact one | the default: the family wants the shop done |
| **Your exact basket** | only the products the family actually chose | when a brand matters, and they accept paying for it |

A store is never rejected for being unable to price a line. It is offered with the alternative named,
and the difference between the two prices is stated in shekels: *"סל מלא ₪243 · הסל המדויק שלך
₪261, כי הקוטג' שביקשת אין כאן"*.

```
┌────────────────────────────────────────────┐
│ רמי לוי אונליין            סל מלא  ₪243    │
│ מחר 10:00–14:00                            │
│ 2 החלפות · הסל המדויק שלך ₪261 (+₪18)  ▾  │
├────────────────────────────────────────────┤
│   קוטג' תנובה → קוטג' טרה 5%      ₪6.90   │
│   תפוחים      → תפוחי עץ פינק      ₪9.90   │
│   [ קח את שלי, +₪18 ]   [ החלף הכל ]      │
└────────────────────────────────────────────┘
```

Rules the cards must keep:

1. **Never a silent swap.** Every alternative is named next to what was asked for.
2. **Never a partial basket presented as a price.** A store that truly cannot complete the basket,
   even with alternatives, says which lines nobody nearby has — that is the only honest gap.
3. **The exact basket is always reachable** in one tap, with its own number and the difference.
4. **"עשה את זה זול יותר"**: one action that swaps each line for the cheapest product of the same
   kind and size at that store, showing the new total and every swap it made. Reversible in one tap.

## Why a store used to vanish, and what changed

A twenty-line list produced two options and nine rejections; three of those stores met the coverage
floor exactly and were thrown out by a rounding bug (fixed, PR #105). The rest were rejected for
missing lines nobody had offered an alternative for: the engine looked up at most twelve gaps and
gave itself nine seconds, which is why stores missing nine or ten lines came back with none. The
background compare now looks up every gap it can, and catalogue answers are cached and shared across
families, so the work is affordable at a thousand households as well as at one.

## What has to be built

1. **Engine**: a full-basket total per storefront alongside the exact-basket total, with the swap list.
   Coverage stops being a rejection gate and becomes a fact on the card. *api-fixer*
2. **The cards**: the layout above, the two prices, the swap list, the two actions. *app-designer*
3. **"עשה את זה זול יותר"** as a per-store action over the family's own chosen products. *app-designer + api-fixer*
4. **Accuracy checks**: every swap is the same kind and size class; the two totals always differ by
   exactly the sum of the swaps; no card shows a price for a basket it cannot fill. *product-qa*
