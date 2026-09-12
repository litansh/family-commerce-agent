# Backlog — everything the owner asked for, and where it stands

The orchestrator's worklist. Each line names the promise it serves (docs/WHAT-WE-PROMISE.md),
the agent that owns it, and its state. An agent picks a line, reproduces the gap in a lab,
fixes it, proves it, and opens a pull request that names the line. Done lines stay, struck.

## Reported by the owner, 13 September 2026 — the orchestrator's directive
Everything below was seen by the owner using the app on a real phone, or measured against the
provider from the ops Mac the same night. Each line names the agent that owns it. These come before
anything else in this file: they are what a family meets.

- [ ] **The provider fails on everyday items.** Measured: `search_products('טופו')` → `internal_error` after 20.7 s; `('שוקולד')` → 29.4 s; `('חלב')` → 4.8 s; a 3-line quote → 3.1 s. In production: `lines resolve to products 0/39`, the 39-line basket → HTTP 503 after 59 s. Build the ladder (ADR 0010): bounded retry on transient errors, the chains' own catalogues as the second rung (Rami Levy answers a name search in under 200 ms with barcode, name, brand, size, image and `available_in`), a per-line budget so one slow line never sinks a basket. *api-fixer*
- [ ] **A daily `search` check**: everyday Hebrew items (טופו, שוקולד, חלב, לחם, ביצים, קוטג', סלמון, בננות) must resolve, red when any does not. *api-fixer, then product-qa owns the watching*
- [ ] **Pictures for every line, proven daily**: a check that a household's usual list has a real photograph on every line, not the drawn glyph; extend the sources per chain (stor.ai and Shufersal by barcode) until it passes. *api-fixer + product-qa*
- [ ] **Branch stock for every chain, not only Rami Levy**: an item the family's branch does not carry is missing in the compare. stor.ai exposes per-branch availability; Hatzi Hinam and Wolt venues too. *store-recipe-fixer*
- [ ] **The store's basket count for every cart recipe** (`basketCountJs`): what Kaniti says is added must equal what the store holds, per store. *store-recipe-fixer*
- [ ] **Simulator flows for the new list and compare**: a tap opens the item sheet, a swipe deletes, undo restores, and the compare's out-of-stock block appears with its alternative. *sim-flow-fixer*
- [ ] **מבצעים from the chains' own promotion files** as a second rung when the provider's feed is thin or one-sided. *price-portal-fixer*
- [ ] **The test cart goes end to end, and chaotically**: thirty-five lines through list → resolve → compare → the store's cart → the store's own basket count, stopping at the payment page; then the same flow abused on purpose (typos, mixed languages, a barcode that exists nowhere, an out-of-stock line, duplicates, quantity 90, a 200-character name, emoji, an empty line, a store that answers slowly). Every failure becomes a check. *product-qa*
- [ ] **The compare must be accurate and beautiful** ("איך לקנות must be accurately amazing"): every number named, every swap named, every store's own product shown, nothing that needs a second screen to understand. *app-designer*

## Connect and stay connected (promises 5, 8)
- [ ] **Cloud copy of every store session.** The phone captures the store's cookies/tokens after sign-in and posts them; the log now shows what was captured (`store-session` events). No household has a sealed session yet — find out why the capture posts nothing for Rami Levy and fix it. *store-recipe-fixer*
- [ ] **Session restore from the cloud.** When the phone's WebView lost a store session (reinstall, new phone) but the cloud has one, put the cookies and tokens back before asking anyone. *store-recipe-fixer + api-fixer*
- [ ] **Order-history recipes verified on real accounts**: Rami Levy, the stor.ai chains, Hatzi Hinam report their response shape to the log; tune field names from the first real order. *store-recipe-fixer*
- [ ] **Shufersal**: the owner's account is locked at the store (customer service); the cart recipe waits for that. *needs the owner*
- [ ] **Cart recipes for stor.ai (Victory, Carrefour, Keshet, Mahsanei HaShuk, Tiv Taam) and Wolt** — today per-item deep links; the family taps "add" per item. Native carts need a test account per chain (the owner allowed creating fictive accounts). *store-recipe-fixer*
- [ ] **Hatzi Hinam cart recipe** written, unverified. *store-recipe-fixer*

## Store truth (promise 9)
- [x] Rami Levy: only a verified cart counts as added; the store's basket count shown beside ours; a mismatch reaches the channel (PRs #36, this one).
- [x] Rami Levy: branch stock (`available_in`) checked in the compare before a line is offered, and again in the cart recipe; the store-chosen branch kept on the household from the phone's report.
- [ ] **Rami Levy cart recipe's name fallback picks an unrelated product**: `apps/mobile/src/lib/stores.ts` line ~270, `byName[l.name]` — a barcode the catalogue lacks falls back to a free-text name match that is not held to the head-word/half-the-words rule from PR #40; reproduced live with `cart-recipe-lab.mjs`'s deliberately-absent line (barcode `9999999999999`, name "לא קיים"), which the recipe added as "קופסת אחסון אניגליש קייק" (a storage box). Now a red `PROMISE9-VIOLATION` in the daily `cart` check (this PR) — was silently "ok" before. *store-recipe-fixer*
- [ ] **Branch stock for the other chains** (stor.ai exposes per-branch availability; Hatzi Hinam, Wolt venues): an item the family's branch does not carry is missing in the compare, not a surprise at checkout. *store-recipe-fixer + api-fixer*
- [ ] **Basket count for every store with a cart recipe** (Hatzi Hinam, the stor.ai chains once their recipes exist, Wolt): a `basketCountJs` per store, read on the cart page. *store-recipe-fixer*
- [ ] **Per-item flow verified too**: when the family adds item by item on the store's pages, read the store's count after each and show it. *store-recipe-fixer + app-designer*
- [x] product-qa checks promise 9 daily: the cart lab now flags `PROMISE9-VIOLATION` when the store's basket count disagrees with ours, or a barcode the catalogue lacks resolves to an unrelated product; `ops/check.mjs`'s `cart` check turns red on either (PR, this one). The shopper's claims (barcode/link per line) are checked against the catalogue already; no store-state claim there yet to match.

## Ladders (ADR 0010, promise 8)
- [ ] **History from the DOM**: for every store, a second rung that reads the orders page itself when the orders API changes. *store-recipe-fixer*
- [ ] **Cart rungs for stor.ai, Wolt, Hatzi Hinam**: a native rung above the per-item pages (needs the fictive accounts the owner allowed). *store-recipe-fixer*
- [ ] **The store's own catalogue as a second price source** in the compare when the provider lacks a store or is slow (Rami Levy first, its catalogue already answers the API). *api-fixer*
- [x] product-qa: two working rungs per ladder, checked daily in the labs (PR, this one). `ops/check.mjs` now derives each ADR 0010 ladder's rung count from that same run's own results (no lab runs twice) and prints it as a `ladders` section; a ladder under two working rungs, or one no daily lab touches at all, fails the run. Today: Compare is the only ladder with two (SuperMCP quote + price-transparency files); Connect, Fill the cart and Prices in-store each have exactly one, and Read history has none — all already tracked above and in "Connect and stay connected".

## Choosing an item (promises 1, 4, 7) — design: docs/design/item-identity.md
- [ ] **Variants in the domain**: `variantKey` / `groupIntoVariants` (size + the category's defining attribute; brand kept aside), tested on real Israeli names. *api-fixer*
- [ ] **Search answers variants**: brand count and price range per variant, the flat list behind "הצגת כל המוצרים". *api-fixer*
- [ ] **Variant cards and the brand chip**: the add flow shows variants; every list line carries the choice chip; the brand sheet writes memory. *app-designer*
- [ ] **The compare names the product per store** for "כל מותג" lines, so a split is legible. *app-designer*

## The compare (promises 1–4)
- [x] Substitutes for missing lines; partial stores as split legs; one missing line never disqualifies; completed-cost ranking; same-kind substitutes; every store row names what it lacks (PRs #1, #6, #8, #9).
- [x] The compare screen to the approved design; store rows open their own store (PR #13).
- [ ] **Delivery windows on the compare** (the chains' slots next to Wolt's live minutes): needs a saved address at the chain, or Kaniti filling the chain's address form once. *store-recipe-fixer + app-designer*
- [ ] **"Fast" measured for every store**: Wolt is live; the chains count as a window. Read each chain's next slot from the phone once connected. *store-recipe-fixer*
- [ ] **Copy on the in-store rows**: with a saving note the longest branch names truncate; shorten `driveSaves`/`driveCosts`. *app-designer*
- [ ] **Coupons folded into the price** with a small "כולל קופון", per the design. *app-designer*

## In-store prices (promise 1)
- [x] Six chains' price files, nearest branches, honest like-for-like comparison (ADR 0009, PRs #5, #9).
- [ ] **Victory / Mahsanei HaShuk** price portal (laibcatalog postback answered "no files"). *price-portal-fixer*
- [ ] **Promotions** (PromoFull files: club prices, multi-buys) lower the in-store total. *price-portal-fixer*
- [ ] **Items of physical-only chains** (Osher Ad, Yohananof) into the item list from the branch indexes. *store scout + api-fixer*

## The list and the memory (promises 6, 7)
- [x] Pack sizes on every item (PR #7); purchase confirmation from store history; pending carts as the fallback.
- [ ] **Automatic confirmation verified end to end** on a real order at Rami Levy. *product-qa*
- [ ] **The home screen still shows "connect Shufersal at the home computer" with a CLI command** — a leftover from before ADR 0008; remove it, the phone is the product. *app-designer*
- [ ] **Suggestions after a few cycles**: prove with the shopper that the memory changes the compare (brand preference, forgotten items). *product-qa*

## Stores (promise 1)
- [x] Store scout daily; Yeinot Bitan and Quik map to Carrefour (PR #3).
- [ ] **New storefronts the scout finds** become connectable: a PR per platform-known store. *store-recipe-fixer*

## Distribution and operations (promise 8)
- [x] Ops loop, PRs via Telegram, CI deploy after merge, Terraform from GitHub, agents' review on PRs, no more laptop credentials (PRs #2, #11, #12, #14, #15).
- [ ] **The agents' key** in SSM: `claude setup-token` needs a browser once; or the Mac-side reviewer (`ops/pr-review.sh`) runs with the local login. *api-fixer*
- [ ] **TestFlight** (Apple Developer Program, shamirlitan@gmail.com) then **Android**. *needs the owner*
- [ ] **Alarms → Telegram** verified with a real alarm (the test message went through). *api-fixer*

## Rules for working this list
Reproduce before fixing; prove with the same lab; one PR per line, the line named in the body;
never weaken a promise to close a line; anything that needs the owner goes to `ops/NEEDS-HUMAN.md`.
