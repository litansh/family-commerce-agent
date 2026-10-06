# ADR 0010 — Every flow has a fallback

**Status:** accepted (owner's instruction, 2026-09-12).

## Context
Once Kaniti is public, stores will change their sites, add challenges, rename endpoints, and some
will try to block it. Kaniti acts as the person, on the person's own phone, in the person's own
session (ADR 0008) - so it is never a scraper the store can cut off wholesale - but any one flow
(a helper the site exposes, an endpoint, a page structure) can stop working overnight.

## Decision
1. **No store action depends on one flow.** Connect, compare, fill the cart, read history: each has a
   ladder of at least two independent flows. A flow that fails, or succeeds without verification
   (promise 9), hands over to the next rung; the last rung is always the person on the store's own
   pages with Kaniti's list beside them. The family sees the outcome, never the rung.
2. **Verified, not assumed.** A rung counts as done only when the store's own state says so (the
   store's signed-in check, its cart count, its order history). A recipe's return value is not proof.
3. **Detected within a day.** The daily run exercises every rung in a lab (`ops/check.mjs`, the
   shopper, the cart lab, the session lab) so a broken rung is a red check the repair agents take,
   before a family meets it. A store change that needs a person goes to `ops/NEEDS-HUMAN.md`.
4. **Recipes, not code, on the phone.** Store behaviour lives in recipes (`apps/mobile/src/lib/stores.ts`)
   and cloud drivers, so a fix is a data change shipped by Metro or a deploy, never an app-store release.

## The ladders today
| Action | Rungs (first to last) | Gap |
|---|---|---|
| Connect | session captured on the phone → one-time code → password once → **cloud copy restored** → the store's own login page | cloud restore not wired (backlog) |
| Compare | SuperMCP quote → substitutes from the catalogue → **the store's own catalogue** (Rami Levy: done for stock) → the price-transparency files (in-store) | the store's catalogue as a price source for delivered baskets (backlog) |
| Fill the cart | the site's own helper → the site's API via its axios → plain fetch → **per-item pages with "add"** → the store's search page | stor.ai / Wolt / Hatzi Hinam have only the last two rungs (backlog) |
| Read history | the store's orders API in the session → **the orders page read from the DOM** → the family's "done" tap | DOM reading not written for most stores (backlog) |
| Prices in-store | six chains' portals + laibcatalog → **static branch lists** when a portal is down | promotions (PR #32) |
| Detect a change | the daily labs → store health per store → the phone's reports in the log and the channel | — |

## Consequences
Every recipe PR names its rung and the rung below it. product-qa's daily review checks that each
ladder has at least two working rungs in the lab. Adding a store means adding its ladder, not one flow.
