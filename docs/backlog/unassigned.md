# Unassigned's lines

One file per agent so two agents never edit the same file (parallel runs kept
colliding in `docs/BACKLOG.md`). Tick a line when its pull request is open, and say where the
proof lives. The whole list, and what it means, is `docs/BACKLOG.md`.

- [ ] **Shufersal**: the owner's account is locked at the store (customer service); the cart recipe waits for that. *needs the owner*
- [ ] **A rise seen once on a phone**: the rule is unit-tested and the reading is proved in a browser, but nobody has yet watched `נוסף לסל ✓` appear after a real tap at Rami Levy. *needs a person with the app*
- [ ] **TestFlight** (Apple Developer Program, shamirlitan@gmail.com) then **Android**. *needs the owner*

## Finished, kept as the record (19)

- [x] **The provider fails on everyday items.** Measured: `search_products('טופו')` → `internal_error` after 20.7 s; `('שוקולד')` → 29.4 s; `('חלב')` → 4.8 s; a 3-line quote → 3.1 s. In production: `lines resolve to products 0/39`, the 39-line basket → HTTP 503 after 59 s. Ladder built (ADR 0010): `McpClient` retries the vendor's transient `internal_error` once with backoff; `CatalogWithFallback` + `RamiLevyCatalogSearch` race the provider against Rami Levy's own catalogue (sub-second) for search; `/resolve` gives each line its own deadline and reports `unresolved` instead of one line's rejection sinking all 39. Proven: 172→184 unit tests, and the live provider now answers טופו/שוקolד/חלב in 0.5–0.7 s each (was 20.7 s failure / 29.4 s / 4.8 s). **Was still open below** — the daily `search` check stayed red for two of the eight everyday words this PR's evidence didn't cover: `search_products('ביצים')`/`('סלמון')` answer in under a second with real, named products, but every one `pricedAtChains: 0`, so `/search` filtered all of them out while Rami Levy's own catalogue prices both. `CatalogWithFallback` trusted any non-empty answer as final regardless of whether anyone could buy it; it now gives the chain catalogue a turn when the provider's answer has products but none are priced anywhere. Proven: 184→186 unit tests; `node ops/search-health.mjs` reproduced red (2/8: ביצים, סלמון) before this change.
- [x] **A daily `search` check**: everyday Hebrew items (טופו, שוקולד, חלב, לחם, ביצים, קוטג', סלמון, בננות) must resolve, red when any does not. `ops/search-health.mjs` + the `search` check in `ops/check.mjs`, and a new rung ("the chains' own catalogues") in the Compare ladder. All eight now resolve (ביצים, סלמון fixed above).
- [x] ~~**The provider fails on everyday items.**~~ Duplicate of the line above, kept on this list by a merge before PR #66 landed; resolved there and above.
- [x] **AWS is treated differently by the stores and by the provider** — decided in ADR 0011: a chain's own site is called from the person's device or from the ops Mac, never from a Lambda; the API only reads the caches they write.
- [x] ~~AWS egress note~~
- [x] ~~**A daily `search` check**~~: duplicate of the line above, kept on this list by two separate merges before PR #66 and this PR landed; resolved there.
- [x] Rami Levy: only a verified cart counts as added; the store's basket count shown beside ours; a mismatch reaches the channel (PRs #36, this one).
- [x] Rami Levy: branch stock (`available_in`) checked in the compare before a line is offered, and again in the cart recipe; the store-chosen branch kept on the household from the phone's report.
- [x] ~~**Per-item flow verified too**: when the family adds item by item on the store's pages, read the store's count after each and show it.~~ The count is polled while the item's page is on screen (adding there reloads nothing), a rise is the store confirming that item, and "סיימתי" teaches the memory only what rose; a store with no count recipe says so instead of implying. Design: `docs/design/per-item-cart.md`; `apps/mobile/e2e/per-item-count.mjs` proves the recipe reads on the item pages, `test/basket.test.ts` pins the rule.
- [x] ~~**The compare names the product per store** for "כל מותג" lines, so a split is legible.~~ The answer card unfolds into each leg's own products, the checkout names what that leg's cart will add (it named the winner's before), `apps/mobile/e2e/split-naming.mjs` proves it on a live compare (PR #54).
- [x] Substitutes for missing lines; partial stores as split legs; one missing line never disqualifies; completed-cost ranking; same-kind substitutes; every store row names what it lacks (PRs #1, #6, #8, #9).
- [x] The compare screen to the approved design; store rows open their own store (PR #13).
- [x] ~~**Copy on the in-store rows**: with a saving note the longest branch names truncate; shorten `driveSaves`/`driveCosts`.~~ The comparison is the row's last line, full width, and the branch title drops the price file's code and the duplicated brand (PR #53).
- [x] ~~**Coupons folded into the price** with a small "כולל קופון", per the design.~~ `couponSavings` reached no screen at all before; it is small print under a one-store option's cash now (PR #53).
- [x] Six chains' price files, nearest branches, honest like-for-like comparison (ADR 0009, PRs #5, #9).
- [x] Pack sizes on every item (PR #7); purchase confirmation from store history; pending carts as the fallback.
- [x] ~~**The home screen still shows "connect Shufersal at the home computer" with a CLI command** — a leftover from before ADR 0008; remove it, the phone is the product.~~ Gone from Home and from the list, replaced by one line pointing at "אני", where connecting happens (PR #53).
- [x] Store scout daily; Yeinot Bitan and Quik map to Carrefour (PR #3).
- [x] Ops loop, PRs via Telegram, CI deploy after merge, Terraform from GitHub, agents' review on PRs, no more laptop credentials (PRs #2, #11, #12, #14, #15).
