# Basket Economics at Real Family Scale

**Date:** 2026-09-05
**Why this document exists:** an earlier conclusion in `product-landscape.md` was drawn from a 12-line test basket and was **wrong at real family scale**. This document records the corrected measurement and the numbers that actually justify the project.

---

## The correction

> **Earlier claim (wrong):** "Multi-store splitting rarely wins for delivery — a second ₪30–40 delivery fee exceeds item-level savings."
>
> **Corrected:** that holds for a small basket. At a real weekly family basket it is false. **Splitting wins, and by a meaningful amount.**

A 12-line basket returned `splitOrder: null`. A 36-line basket at the same address returned a two-store split saving **₪67**. The fixed ₪35.90 second delivery fee is 30% of a small basket's savings and a rounding error against a ₪1,000 one. Basket size is the whole variable, and the household in question shops at the size where splitting pays.

---

## Measurement

**Basket:** 36 lines — a realistic Israeli weekly family shop: dairy, eggs, bread, 9 produce lines, chicken/beef/salmon, pantry staples, nappies and wipes, cleaning and household.
**Address:** ביאליק 20, רמת גן.
**Source:** SuperMCP `optimize_delivery` and `split_order`, run live 2026-09-05.

### Delivered, single retailer

| Retailer | Items | Delivery | **Total** | Lines priced |
|---|---|---|---|---|
| **רמי לוי אונליין** | ₪800.30 | ₪35.90 | **₪836.20** | **36/36** ✅ |
| ויקטורי אונליין | ₪878.80 | ₪35.90 | ₪914.70 | 33/36 |
| קשת טעמים | ₪919.94 | ₪29.90 | ₪949.84 | 33/36 |
| **שופרסל ONLINE** | ₪1,047.30 | ₪35.90 | **₪1,083.20** | 34/36 |
| טיב טעם | ₪1,069.34 | ₪29.90 | ₪1,099.24 | 36/36 |
| קרפור אונליין | ₪1,076.08 | ₪35.90 | ₪1,111.98 | 36/36 |
| חצי חינם | ₪1,083.06 | ₪35.90 | ₪1,118.96 | 33/36 |
| קוויק | ₪1,138.18 | ₪29.90 | ₪1,168.08 | 35/36 |
| יהלומים ביתן | ₪1,179.34 | ₪29.90 | ₪1,209.24 | 34/36 |

### The headline number

> **₪836 vs ₪1,083 for the identical basket. A ₪247 spread — 30% — on one week's shop.**
>
> **≈ ₪12,800 per year** on chain choice alone.

That single figure is larger than every other saving in this document combined, and it requires no splitting, no driving and no automation — only knowing which chain is cheapest *for this household's actual basket*, which changes week to week with promotions.

### Two-store split

```
Best single:  רמי לוי           ₪836.20   (36/36 lines)
Split:        רמי לוי  25 lines  ₪416.40 + ₪35.90
              ויקטורי  11 lines  ₪281.00 + ₪35.90
              ─────────────────────────────────────
              Total              ₪769.20   saving ₪67.00
```

**≈ ₪3,500/year** for accepting two deliveries instead of one.

Raising the cap to three stores changed nothing — the optimizer still chose two. A third ₪35.90 fee is not worth paying. **Two stores is the ceiling, and that is a useful product simplification.**

### Pickup — worse, and worth knowing

| | Best delivered | Best pickup |
|---|---|---|
| Single retailer | **₪836.20** (Rami Levy) | ₪1,104.76 (Shufersal) |
| Two-store split | **₪769.20** | ₪1,064.88 |

Pickup fees are lower (₪10–15 vs ₪35.90) but **item prices are higher and Rami Levy has no pickup storefront at this address at all**. Shufersal's own pickup basket costs ₪47 *more* than its delivery basket.

**Conclusion: for this household, delivery beats click-and-collect outright.** Pickup should not be a headline option in the UI. This also weakens the case for the drive-yourself comparison being a *primary* feature — it stays in the model, but it is no longer the differentiator I ranked it as.

### Coverage is a trap, and the UI must handle it

Four Wolt-hosted storefronts showed the lowest totals in the raw ranking:

```
מחסני השוק (וולט)   ₪486.88   ← but only 10 of 36 lines  (28% coverage)
ויקטורי אלנבי (וולט) ₪504.50   ← only 14 of 36 lines      (39% coverage)
```

They are not cheap. They are *incomplete* — a partial basket that would force exactly the top-up trip this household is trying to avoid.

> **Hard product rule:** never rank a storefront on total without coverage. Anything below ~95% coverage is not an option, it is a partial basket, and presenting it as cheapest is actively harmful to this family.

This is a real bug we would have shipped if the optimizer ranked on price alone.

---

## The forgetting problem — the household's actual stated pain

> *"mostly we forget something and then we need to buy expensively in a nearby super"*

This is a **completeness problem, not an optimization problem**, and it reframes the product's priority order.

Rough cost: forgetting 3–5 items a week and replacing them at a neighbourhood makolet at a 25–40% markup costs roughly **₪20–40/week, ≈ ₪1,000–2,000/year** — plus a trip nobody wanted to make. Smaller than the ₪12,800 chain spread, but it is the loss the family actually *feels*, because it comes with an errand attached.

No product in this market addresses it, because addressing it requires knowing what this household normally buys — which is precisely the household-memory gap identified in `product-landscape.md`.

**Consequence for the roadmap:** the memory layer moves from "differentiator #1 of four" to **the feature the MVP is built around**. Concretely:

1. **Prediction before submission.** When the list is opened, surface what this household normally buys at this point in its cycle and hasn't added — ranked by `order_count` and time since last purchase. Not a generic staples list: *this* household's.
2. **Consumption-interval modelling.** Milk every 4 days, nappies every 11, olive oil every 6 weeks. An item overdue against its own interval is a strong forgetting signal and is computable from purchase history alone.
3. **Completeness check before checkout.** "You usually buy nappies with a shop this size and they aren't on the list."
4. **Post-shop capture.** When a top-up happens anyway, record it — that is the highest-quality training signal the system will ever get about what it missed.

Measurable acceptance criterion, and it should be the headline metric of the whole project:

> **Forgotten-item rate per shop.** Baseline it in Phase 1 by asking the family to log every top-up trip. Target: cut it by half by Phase 4. If it does not move, the memory layer is not working and no amount of price optimization redeems the product.

---

## Total opportunity for this household

| Source | Per week | Per year | Needs |
|---|---|---|---|
| **Right chain for this basket** | ~₪247 | **~₪12,800** | comparison only — available today |
| Two-store split | ~₪67 | ~₪3,500 | comparison + willingness to take 2 deliveries |
| Fewer forgotten-item top-ups | ~₪20–40 | ~₪1,000–2,000 | **household memory — the thing we build** |
| Pickup / driving | negative | — | not worth featuring |

**Realistic combined: ₪14,000–16,000/year**, against an AWS bill of roughly $5/month.

Two honest caveats:

- The ₪247 spread is one measurement on one basket on one day. It must be re-measured across several weeks before being quoted as a steady figure — promotions move chain rankings around, which is itself an argument for re-checking every week rather than picking a chain once.
- Resolution errors inflate spreads. Some of that ₪247 may be SuperMCP matching different products at different chains. **Phase 1's ≥85% resolution gate must pass before any of these numbers are trusted** — which is exactly what Phase 1 was already for.

---

## What changes in the plan

1. **Splitting is in the MVP**, capped at two stores. It was previously deprioritised on bad evidence.
2. **Coverage ratio is a first-class ranking input**, not a display field. Below ~95% is not an option.
3. **Pickup and drive-yourself are demoted** from headline options to secondary. Delivery wins for this household.
4. **Household memory becomes the centre of the MVP**, not one of four differentiators — because the family's stated pain is forgetting, not price.
5. **Forgotten-item rate is the project's headline metric**, alongside resolution accuracy.
6. **Chain choice is re-evaluated every week**, never fixed — the ₪247 spread moves with promotions.
