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

---

# The screens — the design, refined against a real compare

Everything below is the *app-designer* half of line 2 and 3. It was written after capturing one real
compare for the test family (`node apps/mobile/e2e/compare-capture.mjs`, kept at
`apps/mobile/e2e/lab/compare.json`: 8 lines, 12 storefronts, 2 options, 10 rejected) and reading what
the response actually carries. Three things in that capture changed the design, and they are stated
first because they are the reason the card looks the way it does.

## What today's compare really says, and the three things it changed

**One.** The capture's own numbers, per storefront, for the eight-line list:

| Store | Lines it priced | Its own items total | Why it is not an option today |
|---|---|---|---|
| רמי לוי אונליין | 8/8 | ₪98.99 | — it is the answer, ₪134.89 delivered |
| שופרסל ONLINE | 7/8 | ₪137.20 | — second option, ₪173.10 delivered |
| **ויקטורי אונליין** | **8/8** | **₪133.90** | minimum ₪250 — short ₪116.10 |
| **טיב טעם אונליין** | **8/8** | **₪133.09** | minimum ₪300 — short ₪166.91 |
| **קרפור אונליין** | **8/8** | **₪154.28** | minimum ₪200 — short ₪45.72 |
| קוויק | 7/8 | ₪110.73 | minimum ₪200 |
| חצי חינם אונליין | 7/8 | ₪97.08 | minimum ₪500 |
| יהלומים ביתן | 6/8 | ₪65.91 | coverage |
| ויקטורי \| אלנבי (וולט) | 4/8 | ₪42.25 | coverage |
| ויקטורי \| אחד העם (וולט) | 4/8 | ₪42.25 | coverage |
| ויקטורי \| רוטשילד (וולט) | 3/8 | ₪39.63 | coverage |
| מחסני השוק \| רמת גן (וולט) | 3/8 | ₪23.75 | coverage |

Three stores price **every line of the list** and are still not offered: Victory, Tiv Taam, Carrefour.
Their reason is a **minimum**, not coverage — an honest reason, and it stays. But it is a reason that
belongs *on the card* next to a complete basket ("סל מלא ₪154.28 · חסר ₪45.72 למינימום"), not a reason
to reduce a store to a grey row with a number that is not a basket. That is the design's first claim,
confirmed against production: **the full basket exists at more stores than the screen admits.**

**Two — the exact basket only means something for a line the family pinned.** Of the eight lines,
exactly one carried a barcode: `שמן זית אליעד`, gtin `7290017334479`. It is the only line any store
marked `substituted`. Eleven of the twelve storefronts priced it; **one — שופרסל — has the family's
actual bottle**, and the other ten put their own oil behind it: Rami Levy "שמן זית מזוכך אופיר
750מ״ל" ₪14.90, Carrefour "שמן זית כתית מעולה 750 מ״ל כשר לפסח" ₪29.90, Hatzi Hinam "שמן זית 750
מ״ל OLIO" ₪19.90. The other seven lines are free text; each store resolves "חלב 3%" its own way (a 2 ℓ
bottle here, a 1 ℓ bag there) and no store ever "failed" to give the family what they asked for,
because they did not ask for a product — they asked for milk.

That one line is the whole design in miniature. The cheapest full basket is Rami Levy's ₪134.89, and
it contains a bottle of oil the family did not choose. Their exact bottle exists — at Shufersal, whose
own full basket is ₪173.10. So the honest card at Rami Levy does not say "unavailable" and does not
quietly hand them the Ofir: it says **סל מלא ₪134.89**, names the swap, and offers the exact bottle
with what it really costs — a second delivery from Shufersal. That is design state 4, and it is
reachable from production today.

So the two prices are not two prices on every card. **A line the family never pinned has no exact
version, and nothing to charge extra for.** The rule the cards keep:

> The second number appears only when this store swapped a line the family pinned. With no such swap,
> the full basket *is* the exact basket, and the card shows one number.

This is what keeps the screen calm. On the capture's own data the second number appears on every card
(one pinned line, swapped everywhere) — and on an ordinary free-text list it appears nowhere.

**Three — the screen may not add the line prices up.** `storefrontLines[sid][lineId].price` is the
provider's `unitPrice`. The store's own subtotal is built from `lineTotal`, which carries promotions
and loyalty pricing, and the two disagree: summing the capture's unit prices gives ₪107.40 at Rami
Levy against the engine's ₪98.99, ₪143.20 at Tiv Taam against ₪133.09, ₪168.74 at Carrefour against
₪154.28 — ₪8 to ₪21 out, one way, at every chain. (The four Wolt venues match to the agora, which is
what points at promotions: the chains run them, the venues do not.)

A card that showed line prices adding up to a headline they do not add up to would break promise 4 in
the most direct way there is. Therefore: **the totals come from the engine, never from the screen**,
and the swap list shows each line's **lineTotal** — what that line costs inside this basket — not its
shelf price. `lib/fullBasket.ts` is deliberately incapable of inventing a total: given no engine
total it returns the store's own `itemsSubtotal` and says the number is items-only.

## The card

One decision: **buy the whole list here, or somewhere else.** Everything on the card serves it.

Read order — first, second, third:

1. **The store, and when it delivers.** (who, and can I have it today)
2. **The headline: one number, in cash, and the name of the basket it buys.** (what it costs)
3. **The other basket, named, with the difference in shekels.** (what my exactness costs) — a tap switches.
4. **What was swapped, and what nobody has.** (what I am agreeing to) — a tap unfolds.
5. **The two actions.** (buy it · make it cheaper)

### The resting card — a store that fills the basket with one alternative

```
┌──────────────────────────────────────────────────┐
│ רמי לוי אונליין                    סל מלא        │
│ משלוח בחלון · מחר                     ₪134.89   │
│ ──────────────────────────────────────────────── │
│ ▸ החלפה אחת · הסל המדויק שלך — בשופרסל            │
│                                                  │
│ [        קנו כאן · ₪134.89        ]              │
│ [      עשה את זה זול יותר         ]              │
└──────────────────────────────────────────────────┘
```

Unfolded (▾), the swap list — each line as *what you asked → what this store gives*, with that line's
cost inside this basket, and where the family's own one actually is:

```
│ ▾ החלפה אחת                                      │
│    שמן זית  →  שמן זית מזוכך אופיר 750מ״ל  ₪14.90│
│       החלפה — את זה שביקשתם יש בשופרסל           │
```

Once the engine prices the exact basket, that second line grows its number and its honesty about the
second van: `הסל המדויק שלך ₪151.40 (+₪16.51) · ב-2 משלוחים משופרסל`.

### A store the compare hides today

```
┌──────────────────────────────────────────────────┐
│ קרפור אונליין                      סל מלא        │
│ משלוח בחלון                        ₪154.28 + משלוח│
│ ──────────────────────────────────────────────── │
│ חסר ₪45.72 למינימום של ₪200                      │
│ ▸ החלפה אחת                                      │
│                                                  │
│ [        הוסיפו ₪45.72 ואפשר להזמין        ]     │
│ [      עשה את זה זול יותר         ]              │
└──────────────────────────────────────────────────┘
```

The basket is complete. The store is not orderable *yet*, and the card says exactly what would make it
orderable, in shekels. That is information, not a rejection.

### A store that cannot fill the basket even with alternatives

```
┌──────────────────────────────────────────────────┐
│ מחסני השוק | רמת גן (וולט)         ל־3 מתוך 8    │
│ משלוח ב-45 דק׳                        ₪23.75    │
│ ──────────────────────────────────────────────── │
│ אין כאן חלופה ל: ביצים L, פילה סלמון, בננות…     │
└──────────────────────────────────────────────────┘
```

It keeps its number, in muted ink, labelled for what it covers — it is not a basket, so it may not sit
in the same column as one (promise 4, `docs/design/compare-accuracy.md`). No "buy here" primary: there
is nothing here to buy the list from. This state is the **only** honest gap the design allows, and
every card in it is a line for *api-fixer*: a store with no alternative for ביצים is a lookup that did
not run, not a store without eggs.

### "עשה את זה זול יותר"

Not a third price on a resting card — three numbers shouting is a list, not a decision. It is a
**mode the card enters**: the headline becomes the cheaper total, the card is chipped `מוזל`, every
swap it made is listed in accent green, and one tap undoes all of it.

```
┌──────────────────────────────────────────────────┐
│ רמי לוי אונליין            ⟨מוזל⟩  סל מוזל       │
│ משלוח בחלון · מחר                     ₪121.40   │
│ ──────────────────────────────────────────────── │
│ חסכתם ₪13.49 · סל מלא ₪134.89                    │
│ ▾ 4 החלפות                                       │
│    חלב 3%  →  חלב תנובה 3% 2 ל׳          ₪7.90  │
│       זול יותר · ₪1.20 פחות                      │
│    …                                             │
│ [        קנו כאן · ₪121.40        ]              │
│ [        בטלו את ההוזלה           ]              │
└──────────────────────────────────────────────────┘
```

Two swap kinds, and they are never the same colour, because reversing them costs different things:

| Kind | Why | Colour | Undo |
|---|---|---|---|
| **חלופה** | this store does not have the product the family pinned | amber | not undoable here — that line is bought somewhere else |
| **זול יותר** | the family asked to be cheaper; the exact one is on the shelf | accent | one tap, free, instant |

Merging them, as the first draft of this design did, would tell a family a swap is reversible when it
is not.

## Every state

| # | State | What the card shows |
|---|---|---|
| 1 | Every line, nothing pinned was swapped | **one** number, `הסל שלך`, no second price, no swap line |
| 2 | Every line, a pinned line swapped | `סל מלא` headline; `הסל המדויק שלך ₪Y (+₪Z)`; `N החלפות ▾`; both actions |
| 3 | The exact basket is the cheaper of the two (Z < 0) | the exact basket becomes the headline; the full basket is the second line, with `−₪Z` |
| 4 | The exact basket needs another store | second line reads `+₪Z · ב-2 משלוחים מ{brand}` — never a single number hiding a second delivery |
| 5 | Nobody nearby has the pinned product | no exact-basket line at all; the swap row says `את זה שביקשתם אין באף חנות` — the only gap the design calls honest |
| 6 | The store cannot fill some line, even with an alternative | number in muted ink, labelled `ל־{n} מתוך {m}`, the lines named, **no** primary buy action |
| 7 | Basket complete, under the store's minimum | complete number + `חסר ₪X למינימום של ₪Y`; the primary action says what would fix it |
| 8 | Made cheaper | headline = cheaper total, chip `מוזל`, `חסכתם ₪X`, every swap in accent, `בטלו את ההוזלה` |
| 9 | "Cheaper" found nothing at this store | the action reports once, in place: `לא נמצא כאן זול יותר`, and stays tappable |
| 10 | The delivery fee for this store is not known yet | `₪X + משלוח`, in muted ink — never a delivered total that was guessed |
| 11 | Store closed | unchanged: the when-chip warns and the store ranks after every open one (`lib/compare.ts#etaRank`) |
| 12 | A completion price rests on an estimate | `≈` in front of it, everywhere, every time |

States 2, 4, 6, 7, 10 and 11 are reachable from the captured compare and are asserted by
`e2e/full-basket.mjs` against it. States 3, 8, 9 and 12 need the engine line below. States 1 and 5 are
the two the eight-line capture happens not to contain — 1 needs a list with nothing pinned (the
ordinary case, and the reason the rule exists), 5 a pinned product no store nearby carries.

## The words

Hebrew is the product; English is kept in step in the same commit (`lib/i18n.ts`).

| key | he | en |
|---|---|---|
| `fullBasket` | סל מלא | Full basket |
| `yourBasket` | הסל שלך | Your basket |
| `exactBasket` | הסל המדויק שלך | Your exact basket |
| `exactBasketAt` | הסל המדויק שלך {x} | Your exact basket {x} |
| `exactTwoStops` | ב-2 משלוחים מ{b} | 2 deliveries, with {b} |
| `exactNowhere` | את זה שביקשתם אין באף חנות | Nobody nearby has the one you asked for |
| `swapsN` / `swaps1` | {n} החלפות / החלפה אחת | {n} substitutions / one substitution |
| `swapMissingWhy` | החלפה — את זה שביקשתם אין כאן | Substitute — they do not have yours |
| `swapCheaperWhy` | זול יותר · {x} פחות | Cheaper · {x} less |
| `takeMine` | קחו את שלי · +{x} | Take mine · +{x} |
| `backToFull` | חזרה לסל המלא · −{x} | Back to the full basket · −{x} |
| `makeCheaper` | עשה את זה זול יותר | Make it cheaper |
| `undoCheaper` | בטלו את ההוזלה | Undo |
| `cheapBasket` | סל מוזל | Cheaper basket |
| `cheapChip` | מוזל | cheaper |
| `savedHere` | חסכתם {x} | You saved {x} |
| `cheaperNone` | לא נמצא כאן זול יותר | Nothing cheaper here |
| `ofNofM` | ל־{n} מתוך {m} פריטים | for {n} of {m} items |
| `noAlternativeFor` | אין כאן חלופה ל: {x} | No alternative here for: {x} |
| `plusDelivery` | + משלוח | + delivery |
| `shortOfMin` | חסר {x} למינימום של {y} | {x} short of the {y} minimum |
| `addToOrder` | הוסיפו {x} ואפשר להזמין | Add {x} and you can order |
| `buyHereFor` | קנו כאן · {x} | Buy here · {x} |

`עשה את זה זול יותר` is the owner's own phrasing and is kept verbatim.

## What the screen must be able to read

`lib/fullBasket.ts` is pure, React-free and free of `./api` and `./i18n`, like `lib/compare.ts` and
`lib/quote.ts` beside it, so `e2e/full-basket.mjs` runs the same functions over a real compare. It
reads what the quote carries today and grows into what the engine will add:

```ts
// already in the response — the card is built on these
rejected[].itemsSubtotal          // the engine's own items total for what this store priced
rejected[].minimumOrder / amountToMinimum
options[].legs[].deliveryFee      // known for the stores that became options
storefrontLines[sid][lineId]      // productName, price, substituted, reason, swapBy

// the engine line (api-fixer), in the order the cards need it
storefronts?: Record<sid, {
  brand: string;
  deliveryFee?: Agorot;            // ← state 10 closes: every full basket becomes a delivered total
  minimumOrder?: Agorot;
  fullBasket?: { total: Agorot; items: Agorot; unfillableLineIds: string[] };
  exactBasket?: { total: Agorot; elsewhere: { lineId; storefrontId; brand; lineTotal }[] };
}>;
storefrontLines[sid][lineId].lineTotal?: Agorot;   // ← what this line costs inside the basket
cheaper?: Record<sid, { lineId; gtin; productName; lineTotal; wasLineTotal }[]>;  // ← states 8, 9
```

Nothing on a card is ever computed by adding `price` fields together. Where a number the card needs is
absent, the card shows the weaker true thing (items-only, `+ משלוח`, `≈`) and never the stronger false
one.

## Deliberately left out

- **A third price at rest.** Full, exact and cheaper are one headline and two named alternatives; the
  card never shows three numbers at once.
- **A coverage percentage.** "87% כיסוי" is a number nobody can act on. The lines themselves are named.
- **A swap the family did not see.** No card, and no cart, ever carries an unnamed substitution.
- **Ranking by the exact basket.** The list is ordered by the full basket, because that is the basket
  almost everyone buys; the exact basket re-prices a card, it never re-orders the screen.
- **Hiding a store.** After this, the only store that does not get a card is a store that does not
  deliver to the address.

## Proof

- `apps/mobile/e2e/full-basket.mjs` over `e2e/lab/compare.json` (and over a live compare with
  `--live`): every state in the table is asserted against real numbers, and the totals-never-summed
  rule is asserted by construction.
- `apps/mobile/maestro/full-basket.yaml` on the simulator, shots in `maestro/shots/full-basket-*.png`.
