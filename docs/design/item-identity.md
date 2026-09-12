# Choosing an item: one line, one product, no wall of milk

**Decision this serves:** *which product this line means* — precisely enough to compare one-to-one
across stores, in as few taps as a person standing in a kitchen will give.

**The tension.** A comparison is only honest between the same thing: "milk ₪5.90 here, ₪7.20 there"
means nothing when one is 1 ℓ Tnuva 3 % and the other a 2 ℓ store brand. So the unit of comparison
must be a single product. But "חלב" matches two hundred products in an Israeli chain, and no family
will read them. And brand matters sometimes (Tara or Tnuva, a family has a side) and not at all
other times (canned corn).

## The model: three layers, one visible

| Layer | What it is | Who decides |
|---|---|---|
| **Line** | the family's words on the list: "חלב 3 %" | the family, typing |
| **Choice** | *any brand* (cheapest equivalent) or *this one* (a pinned barcode) | the family, one tap — default *any brand* |
| **Item** | the barcode actually priced and bought, per store | Kaniti, and it always says which |

Only the line and the choice are ever on screen. The item is named wherever a number depends on it.

**The variant is the unit, not the product.** Two products are genuinely different when an attribute
the family would notice differs: size, and the category's defining attribute (fat % for milk, count
for eggs, grind for coffee, % for cream). Brand is *not* a variant axis — it is the second-order
question, and its usual answer is "cheapest". So search results collapse into variants:

```
חיפוש: חלב                                          ← the family types

┌─────────────────────────────────────────────┐
│ 🥛 חלב 3%  ·  1 ליטר                        │
│    12 מותגים  ·  ₪5.90–8.40                 │   ← one tap adds it, "כל מותג"
├─────────────────────────────────────────────┤
│ 🥛 חלב 1%  ·  1 ליטר                        │
│    9 מותגים  ·  ₪5.90–7.90                  │
├─────────────────────────────────────────────┤
│ 🥛 חלב 3%  ·  2 ליטר                        │
│    4 מותגים  ·  ₪10.90–13.50                │
└─────────────────────────────────────────────┘
        הצגת כל המוצרים (214)   ← the flat list stays, one tap away, for the rare exact hunt
```

Order: what this family bought before, then how many stores carry it, then price. Twelve brands
behind one row is the whole point — the family reads three rows, not two hundred.

## The list line

```
חלב 3%   1 ליטר   [ כל מותג ▾ ]        2 ✕
```

The chip is the choice, and it is the only place brand is asked. Tapping it:

```
איזה מותג?                              ← sheet
  ● כל מותג — הזול ביותר בכל חנות        ₪5.90–8.40
  ○ תנובה                                ₪6.90–7.50
  ○ טרה                                  ₪5.90–7.20
  ○ יטבתה                                ₪7.40–8.40
  [ ] תמיד המותג הזה (לזכור)
```

"תמיד" writes the preference to memory; two purchases of the same brand under *any brand* raise the
suggestion "תמיד קונים טרה. לקבע?" — the family answers once, never again.

## What each choice means in the compare

- **כל מותג** — every store prices *its own* cheapest product of that variant. The row names it, so
  the comparison stays one-to-one and legible: `רמי לוי ₪6.20 (תנובה 1 ל')  ·  שופרסל ₪5.90 (טרה 1 ל')`.
  Different brands, same variant, and the screen says so. This is the case where splitting a cart
  actually pays, and the family can see why.
- **מותג מקובע** — the same barcode everywhere. A store that lacks it shows the swap in the open
  ("תנובה → טרה"), and the sheet offers "לא להחליף את הפריט הזה", which makes the store simply miss
  the line instead (promise 3 then keeps the store as a split leg).
- **Out of stock at the family's branch** is neither: it reads "אזל בסניף שלכם" and the alternative
  is proposed in the compare, before anyone shops (promise 9).

## States

| State | What the screen shows |
|---|---|
| No results | "לא מצאנו {q}. אפשר להוסיף כמו שכתבתם, ונחפש בכל חנות." — the line goes on as free text |
| One product only | the product itself as the card, with its brand, no variant row |
| A variant no nearby store carries | greyed, with "אין בחנויות שמגיעות אליכם" — never silently dropped |
| A pinned product that vanished from every store | the line stays, the chip turns to "כל מותג" with a note, never an empty list |
| Offline / search failed | the family's own words go on the list unresolved; the compare resolves them |

## Why not the alternatives

- *A flat ranked list of products*: honest but unusable — the family scrolls past forty yoghurts.
- *One "milk" concept with the store choosing*: comfortable but dishonest — it hides that a 2 ℓ bottle
  beat a 1 ℓ carton on price, which is the single most common way a comparison lies.
- *Asking brand first*: most lines do not care, and asking costs a tap on every line.

## What has to be built

1. **Domain** — `variantKey(candidate)` → `{ base, attrs, size }` and `groupIntoVariants(candidates)`,
   with the brand kept aside; tested against real Israeli product names (חלב, ביצים, קפה, שמנת).
2. **API** — `/search` answers variants (brand count, price range, the products behind each) and keeps
   the flat list behind a flag for "הצגת כל המוצרים".
3. **App** — variant cards in the add flow; the brand chip on every list line; the brand sheet;
   memory wired to the chip (any ↔ `substitution: 'equivalent'`, pinned ↔ `'never'`).
4. **Compare** — for *any brand* lines, name the product each store used, next to its price.

Each is a separate pull request; this page is the agreement they are built against.
