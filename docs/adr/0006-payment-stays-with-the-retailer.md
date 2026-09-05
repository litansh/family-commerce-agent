# ADR 0006 — Payment stays with the retailer; Kanili prepares and forwards

**Status:** accepted · 2026-09-06

## Context
The product owner's intent: pay inside Kanili when possible; otherwise Kanili organises the cart
across stores and forwards the family to each one. No Israeli grocery chain offers a payment or
ordering API. The only way to "pay inside Kanili" today is to automate a retailer's checkout with
the family's stored credentials — fragile, against every chain's terms, a likely App Store
rejection, and a card-data liability we have chosen not to carry.

## Decision
Three tiers, in the order they ship:
1. **Deep links per item** (shipped) — tap → item on the retailer's site → the family adds and pays.
2. **Prepared cart** (next, Israel) — a worker at home fills the retailer's own list/cart feature
   (Shufersal wishlist → one tap converts to cart); the family reviews and pays on the retailer.
   Requires the family's explicit opt-in and their own retailer credentials, stored encrypted per
   household, never in the app.
3. **Pay in Kanili** — only if and when a retailer offers a sanctioned API. Not built otherwise.

Kanili never sees, stores or transmits a payment card. Kanili's own monetisation, when it comes, is
an App Store / Play subscription, which keeps card handling with Apple and Google.

## Consequences
- Every option in the app ends at a retailer, by design; the UI says "we prepare, you approve".
- Store review risk stays low: comparison and list features only, no credential capture in-app.
- The prepared-cart worker is the one piece that runs outside AWS (retailer sites block datacenter
  egress) and the one piece that touches retailer credentials; it gets its own consent flow.
