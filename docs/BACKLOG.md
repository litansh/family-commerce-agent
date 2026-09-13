# Backlog — everything the owner asked for, and where it stands

The orchestrator's worklist. Each line names the promise it serves (docs/WHAT-WE-PROMISE.md),
the agent that owns it, and its state. An agent picks a line, reproduces the gap in a lab,
fixes it, proves it, and opens a pull request that names the line. Done lines stay, struck.

## Reported by the owner, 13 September 2026 — the orchestrator's directive
Everything below was seen by the owner using the app on a real phone, or measured against the
provider from the ops Mac the same night. Each line names the agent that owns it. These come before
anything else in this file: they are what a family meets.

- [x] **The provider fails on everyday items.** Measured: `search_products('טופו')` → `internal_error` after 20.7 s; `('שוקולד')` → 29.4 s; `('חלב')` → 4.8 s; a 3-line quote → 3.1 s. In production: `lines resolve to products 0/39`, the 39-line basket → HTTP 503 after 59 s. Ladder built (ADR 0010): `McpClient` retries the vendor's transient `internal_error` once with backoff; `CatalogWithFallback` + `RamiLevyCatalogSearch` race the provider against Rami Levy's own catalogue (sub-second) for search; `/resolve` gives each line its own deadline and reports `unresolved` instead of one line's rejection sinking all 39. Proven: 172→184 unit tests, and the live provider now answers טופו/שוקolד/חלב in 0.5–0.7 s each (was 20.7 s failure / 29.4 s / 4.8 s). **Was still open below** — the daily `search` check stayed red for two of the eight everyday words this PR's evidence didn't cover: `search_products('ביצים')`/`('סלמון')` answer in under a second with real, named products, but every one `pricedAtChains: 0`, so `/search` filtered all of them out while Rami Levy's own catalogue prices both. `CatalogWithFallback` trusted any non-empty answer as final regardless of whether anyone could buy it; it now gives the chain catalogue a turn when the provider's answer has products but none are priced anywhere. Proven: 184→186 unit tests; `node ops/search-health.mjs` reproduced red (2/8: ביצים, סלמון) before this change.
- [ ] **`quoteBasket` fails on a full week's basket, not just search.** Reproduced against the live provider: the 39-line basket's `optimize_delivery` call answers `internal_error` after 44–57 s (the first 20 lines fail this way; the last 19 succeed in 46.8 s) — our own client aborts at 22 s before the vendor's answer, real or erring, ever arrives, so every retry within the background job's 110 s budget dies to our own timeout, not the vendor's. Confirmed live: both the sync `/quote` route and the phone's real async `/compares` job end in `stores_slow` for this exact basket (checked 2026-09-13). A safe retry-on-`internal_error` is now wired in (this PR), but the deeper fix — enough per-attempt time for the vendor to actually answer a big basket, within the Lambda's 120 s ceiling, without leaving a compare stuck `pending` if the Lambda itself gets killed — needs a deliberate budget/timeout redesign (and maybe a Lambda timeout increase, an infra PR of its own), not a rushed change under this line. See `ops/NEEDS-HUMAN.md`. *api-fixer*
- [x] **A daily `search` check**: everyday Hebrew items (טופו, שוקולד, חלב, לחם, ביצים, קוטג', סלמון, בננות) must resolve, red when any does not. `ops/search-health.mjs` + the `search` check in `ops/check.mjs`, and a new rung ("the chains' own catalogues") in the Compare ladder. All eight now resolve (ביצים, סלמון fixed above).
- [x] ~~**The provider fails on everyday items.**~~ Duplicate of the line above, kept on this list by a merge before PR #66 landed; resolved there and above.
- [x] **AWS is treated differently by the stores and by the provider** — decided in ADR 0011: a chain's own site is called from the person's device or from the ops Mac, never from a Lambda; the API only reads the caches they write.
- [ ] **Move the branch list and its geocoding to the ops Mac** (the refresher's Lambda attempt is blocked; it must be best-effort and the Mac's nightly run must write the row). *api-fixer*
- [ ] **Order history read on the device and posted**, per ADR 0011, for every store. *store-recipe-fixer*
- [x] ~~AWS egress note~~
- [x] ~~**A daily `search` check**~~: duplicate of the line above, kept on this list by two separate merges before PR #66 and this PR landed; resolved there.
- [ ] **Pictures for every line, proven daily.** *product-qa*'s half is done: `ops/test-cart.mjs` now fails when the winning cart's real lines are under 85% pictured, and `ops/deals-health.mjs` (new, wired into `ops/check.mjs` as `deals`) does the same for Home's deals carousel — both red today. Reproduced live 2026-09-13: every `imageUrl` Kaniti has ever shown is a `img.rami-levy.co.il` URL; a fresh `/deals` pull backfilled through `POST /images` still resolved 0/15 missing lines, every one a חצי חינם/קרפור/שופרסל/טיב טעם promo item (knives, perfume, Lego, diapers, dates) that Rami Levy's own catalogue never carried, so there was never a barcode to look an image up by. **Still open** — Rami Levy's image CDN is the only source `ImageResolver` has; extend it per chain (stor.ai and Shufersal by barcode, as this same line said before) or the two new checks stay red forever, correctly. *api-fixer*
- [ ] **Branch stock for every chain, not only Rami Levy**: an item the family's branch does not carry is missing in the compare. stor.ai exposes per-branch availability; Hatzi Hinam and Wolt venues too. *store-recipe-fixer*
- [ ] **Pictures for every line, proven daily**: a check that a household's usual list has a real photograph on every line, not the drawn glyph; extend the sources per chain (stor.ai and Shufersal by barcode) until it passes. *api-fixer + product-qa*
- [ ] **The store's basket count for every cart recipe** (`basketCountJs`): what Kaniti says is added must equal what the store holds, per store. *store-recipe-fixer*
- [ ] **Simulator flows for the new list and compare**: a tap opens the item sheet, a swipe deletes, undo restores, and the compare's out-of-stock block appears with its alternative. *sim-flow-fixer*
- [ ] **מבצעים from the chains' own promotion files** as a second rung when the provider's feed is thin or one-sided. *price-portal-fixer*
- [ ] **The test cart goes end to end, and chaotically**: thirty-five lines through list → resolve → compare → the store's cart → the store's own basket count, stopping at the payment page; then the same flow abused on purpose (typos, mixed languages, a barcode that exists nowhere, an out-of-stock line, duplicates, quantity 90, a 200-character name, emoji, an empty line, a store that answers slowly). Every failure becomes a check. *product-qa*
- [x] **The compare must be accurate and beautiful** ("איך לקנות must be accurately amazing"): every number named, every swap named, every store's own product shown, nothing that needs a second screen to understand. Audited against one real compare for the test family (`apps/mobile/e2e/compare-capture.mjs`, 8 lines, 2 options, 10 rejected stores) and five departures fixed: four Wolt venues **shut until tomorrow morning read as "משלוח בחלון"** (`eta.kind: 'closed'` fell through to the window branch, and the chip's tone was a regex over rendered Hebrew) and could rank as "הכי מהר"; the answer card **named no saving at all** because the optimizer makes the winner its own baseline (`savingVsBaseline: 0`) — ₪52.11 never reached the phone; a **7-of-8 basket at ₪173.10 stood beside a complete ₪134.89 one** with its ₪187.00 completed total never shown and the difference dropped entirely; **items-only prices sat in the delivered column** in full ink; and an alternative **row read its first leg only**, so a split would name leg 0's products under lines leg 1 buys and call them missing. The rules now live in `apps/mobile/src/lib/compare.ts`, free of React and i18n so a lab can run them: `apps/mobile/e2e/compare-accuracy.mjs` checks them over a real compare and is the new daily `compare` check in `ops/check.mjs`; 13 of its rules fail on the old screen, and `apps/mobile/test/compare-rules.test.ts` pins the split (192 unit tests, was 184). Design: `docs/design/compare-accuracy.md`. *Not yet seen on the simulator — the flow needs an approval this run could not give; `maestro/compare-shots.yaml` is the flow for it.* **A per-store price per line is still missing** (line below, *api-fixer*): a row can name each store's product but not what that store charges for it.

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
- [x] ~~**Per-item flow verified too**: when the family adds item by item on the store's pages, read the store's count after each and show it.~~ The count is polled while the item's page is on screen (adding there reloads nothing), a rise is the store confirming that item, and "סיימתי" teaches the memory only what rose; a store with no count recipe says so instead of implying. Design: `docs/design/per-item-cart.md`; `apps/mobile/e2e/per-item-count.mjs` proves the recipe reads on the item pages, `test/basket.test.ts` pins the rule.
- [ ] **The per-item count lab in the daily checks**: `apps/mobile/e2e/per-item-count.mjs` is run by hand today; it belongs in `ops/check.mjs`'s `cart` section so a store that stops publishing its basket number turns a check red. *product-qa*
- [ ] **A rise seen once on a phone**: the rule is unit-tested and the reading is proved in a browser, but nobody has yet watched `נוסף לסל ✓` appear after a real tap at Rami Levy. *needs a person with the app*
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
- [x] ~~**The compare names the product per store** for "כל מותג" lines, so a split is legible.~~ The answer card unfolds into each leg's own products, the checkout names what that leg's cart will add (it named the winner's before), `apps/mobile/e2e/split-naming.mjs` proves it on a live compare (PR #54).
- [ ] **A per-store price per line in the quote** (`storefrontLines[sid][lineId].price`): the compare can name each store's product but not what that store charges for it, so `רמי לוי ₪6.20 (תנובה 1 ל')` from the design is still half a sentence. *api-fixer*
- [ ] **Ordering through Kaniti uses the leg's own barcode**: `legsFor` in `apps/mobile/src/screens/Options.tsx` still sends `quotedLines`' gtin, i.e. the winner's product, to every leg — the same mix-up the screens just stopped making, one layer down. *api-fixer*

## The compare (promises 1–4)
- [x] Substitutes for missing lines; partial stores as split legs; one missing line never disqualifies; completed-cost ranking; same-kind substitutes; every store row names what it lacks (PRs #1, #6, #8, #9).
- [x] The compare screen to the approved design; store rows open their own store (PR #13).
- [ ] **Delivery windows on the compare** (the chains' slots next to Wolt's live minutes): needs a saved address at the chain, or Kaniti filling the chain's address form once. *store-recipe-fixer + app-designer*
- [ ] **"Fast" measured for every store**: Wolt is live; the chains count as a window. Read each chain's next slot from the phone once connected. *store-recipe-fixer*
- [x] ~~**Copy on the in-store rows**: with a saving note the longest branch names truncate; shorten `driveSaves`/`driveCosts`.~~ The comparison is the row's last line, full width, and the branch title drops the price file's code and the duplicated brand (PR #53).
- [x] ~~**Coupons folded into the price** with a small "כולל קופון", per the design.~~ `couponSavings` reached no screen at all before; it is small print under a one-store option's cash now (PR #53).

## In-store prices (promise 1)
- [x] Six chains' price files, nearest branches, honest like-for-like comparison (ADR 0009, PRs #5, #9).
- [ ] **Victory / Mahsanei HaShuk** price portal (laibcatalog postback answered "no files"). *price-portal-fixer*
- [x] **Promotions** (PromoFull files: club prices, multi-buys) lower the in-store total. The library side (`parsePromoFull`, `bestDealTotal`, `promoFile` on every portal) landed earlier unwired; the refresher now fetches each indexed branch's promo file alongside its price file and the quote path prices every line the cheapest way, marking club-only deals (this PR). *price-portal-fixer*
- [ ] **Items of physical-only chains** (Osher Ad, Yohananof) into the item list from the branch indexes. *store scout + api-fixer*

## The list and the memory (promises 6, 7)
- [x] Pack sizes on every item (PR #7); purchase confirmation from store history; pending carts as the fallback.
- [ ] **Automatic confirmation verified end to end** on a real order at Rami Levy. *product-qa*
- [x] ~~**The home screen still shows "connect Shufersal at the home computer" with a CLI command** — a leftover from before ADR 0008; remove it, the phone is the product.~~ Gone from Home and from the list, replaced by one line pointing at "אני", where connecting happens (PR #53).
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
