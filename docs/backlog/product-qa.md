# product-qa's lines

One file per agent so two agents never edit the same file (parallel runs kept
colliding in `docs/BACKLOG.md`). Tick a line when its pull request is open, and say where the
proof lives. The whole list, and what it means, is `docs/BACKLOG.md`.

- [ ] **The test cart goes end to end, and chaotically**: thirty-five lines through list → resolve → compare → the store's cart → the store's own basket count, stopping at the payment page; then the same flow abused on purpose (typos, mixed languages, a barcode that exists nowhere, an out-of-stock line, duplicates, quantity 90, a 200-character name, emoji, an empty line, a store that answers slowly). Every failure becomes a check. *product-qa*
- [ ] **The per-item count lab in the daily checks**: `apps/mobile/e2e/per-item-count.mjs` is run by hand today; it belongs in `ops/check.mjs`'s `cart` section so a store that stops publishing its basket number turns a check red. *product-qa*
- [x] product-qa checks promise 9 daily: the cart lab now flags `PROMISE9-VIOLATION` when the store's basket count disagrees with ours, or a barcode the catalogue lacks resolves to an unrelated product; `ops/check.mjs`'s `cart` check turns red on either (PR, this one). The shopper's claims (barcode/link per line) are checked against the catalogue already; no store-state claim there yet to match.
- [x] product-qa: two working rungs per ladder, checked daily in the labs (PR, this one). `ops/check.mjs` now derives each ADR 0010 ladder's rung count from that same run's own results (no lab runs twice) and prints it as a `ladders` section; a ladder under two working rungs, or one no daily lab touches at all, fails the run. Today: Compare is the only ladder with two (SuperMCP quote + price-transparency files); Connect, Fill the cart and Prices in-store each have exactly one, and Read history has none — all already tracked above and in "Connect and stay connected".
- [ ] **Automatic confirmation verified end to end** on a real order at Rami Levy. *product-qa*
- [ ] **Suggestions after a few cycles**: prove with the shopper that the memory changes the compare (brand preference, forgotten items). *product-qa*
