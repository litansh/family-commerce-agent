# app-designer's lines

One file per agent so two agents never edit the same file (parallel runs kept
colliding in `docs/BACKLOG.md`). Tick a line when its pull request is open, and say where the
proof lives. The whole list, and what it means, is `docs/BACKLOG.md`.

- [x] **Variant cards and the brand chip**: the add flow shows variants; every list line carries the choice chip; the brand sheet writes memory. *app-designer* — PR open. Proof:
      `apps/mobile/test/choice.test.ts` (223 unit tests green), `node apps/mobile/e2e/variant-cards.mjs`
      against the real catalogue for the test family, and `./maestro/run.sh choice` green on the
      iPhone 17 Pro — shots in `maestro/shots/choice-*.png`.

## What the proof taught, for whoever picks up next

- **The API searches too narrow for grouping to pay.** `/search` asks the catalogue for `limit: 12`
  and groups *after* truncating, so "חלב" is twelve products and therefore twelve cards — the wall
  of milk `docs/design/item-identity.md` set out to remove. Only "ביצים" collapses today (12 → 7);
  חלב, קפה and שמנת collapse nothing. `variant-cards.mjs` prints the ratio per query. The screen is
  honest either way (when grouping collapses nothing it shows the flat list and offers no toggle),
  so this is **api-fixer's** line, not a blocker for the chip. Written into the design doc under
  "What has to be built" → API.
- **The compare already names the product each store used** (step 4 of the design's "What has to be
  built" — landed in `50b0f43`, held by `e2e/split-naming.mjs`). What it still cannot show is a
  **per-store price per line**: the quote does not carry one, so a כל מותג line says which product
  each store brought but not what each store charges for it. That is the piece that would let a
  family see *why* splitting pays, line by line. It needs the quote to carry it first — api-fixer.
- **The simulator's XCUITest driver on this Mac is unstable, and it is poisoning the `sim` check.**
  Twice today `node ops/check.mjs --only sim` came back `connect 0/9` then `1/9` with every store
  failing identically, and `maestro hierarchy` against a plainly-rendered Home screen returned only
  the status bar — the app was fine, the driver could not see it. `maestro test` revives it;
  `maestro hierarchy` alone does not. A flow that runs green one minute fails the next on an empty
  snapshot. This is **sim-flow-fixer's** ground; recorded here because it makes every other agent's
  sim evidence unreliable until it is fixed.
  - Run `order` alone after a revive and it passes the list, the compare and the store's cart fill
    ("הסל מוכן"); only the last `"[1-9][0-9]* נוספו"` assertion fails, against a snapshot that had
    gone thin again.
  - `apps/mobile/maestro/order.yaml` taps the list tab as `.*רשימה`, which landed on the compare
    button once the list had lines in it. The tabs now carry `tab-home|list|orders|me`; the text
    matcher still works, so nothing is broken — but `tab-list` is the handle to switch to.
- **Metro on 8082 is shared and is whatever checkout started it.** It was serving the main checkout
  while this worktree's flows ran, so the app under test had none of the changes. Check with
  `lsof -a -p $(lsof -ti tcp:8082) -d cwd -Fn` before believing a sim result from a worktree.
- [x] **A full basket at every store** (docs/design/a-full-basket-everywhere.md), the owner's central ask: every store priced for the whole list using its own alternatives, the family's exact basket priced beside it with the difference in shekels, and a 'make it cheaper' action. Coverage becomes a fact on the card, not a reason to hide a store. *app-designer* — two PRs.
      **PR #114, the design**: the card, the read order, the three modes, the twelve states, the words,
      the engine contract, and what is left out. Drawn against a real compare captured first
      (`apps/mobile/e2e/lab/compare.json`), which changed it three times over.
      **PR (branch `app-designer/full-basket-cards`), the build**: `src/lib/fullBasket.ts` (pure),
      `src/screens/StoreBasketCard.tsx`, the compare screen wired to it, 24 strings in both languages,
      `PriceCol` lifted into `ui.tsx`. Proof: `node apps/mobile/e2e/full-basket.mjs` (185 checks green
      over the real compare), `apps/mobile/test/fullBasket.test.ts` (9 tests, suite 243 → 252),
      `npm run typecheck` clean, `./maestro/run.sh full-basket`.

## What the build taught, for whoever picks up next

- **The screen may never sum `storefrontLines[…].price`.** It is the provider's `unitPrice`; a store's
  own subtotal is built from `lineTotal`, which carries promotions. On the captured compare the
  difference is ₪8.41 at Rami Levy (₪107.40 summed against the engine's ₪98.99), ₪10.11 at Tiv Taam,
  ₪14.46 at Carrefour, ₪20.81 at Victory — and **zero at all four Wolt venues**, which is what points
  at promotions rather than at a bug. `lib/fullBasket.ts` is written so it cannot produce a total of
  its own, and `e2e/full-basket.mjs` asserts the gap on every card. **api-fixer**: carrying
  `lineTotal` per storefront line is the fix, and it is small.
- **Three stores priced every line of an eight-line list and were still not offered** — ויקטורי
  ₪133.90, טיב טעם ₪133.09, קרפור ₪154.28 — all three held back by an **order minimum**, not by
  coverage. That is an honest reason and it stays; it is now a sentence on the card in shekels. The
  design's "stores rejected for coverage had 0–2 alternatives for 9–11 missing lines" is still true of
  the Wolt venues (3–4 of 8 lines, no alternatives offered) — those gaps are a lookup that did not
  run, and they are **api-fixer's** line, not a store without eggs.
- **The exact basket is meaningless for a line the family never pinned.** Of the eight lines exactly
  one carried a barcode (שמן זית אליעד); it is the only line any store marked `substituted`. Eleven
  storefronts priced it and **one — שופרסל — has the family's actual bottle**. So the second number
  appears only when a pinned line was swapped, and the cheapest full basket (Rami Levy ₪134.89)
  contains an oil the family did not choose while their own is at a store costing ₪173.10. That single
  line is the whole design in miniature and is worth keeping as the demo.
- **A delivery fee is only in the response for stores that became options.** Every other card's number
  is therefore items-only and says "+ משלוח" in muted ink. One field — `storefronts[sid].deliveryFee`
  — turns eight of the twelve cards into delivered totals that may sit in one column. It is the
  highest-value thing **api-fixer** can add for this screen, above the full/exact totals themselves.
- **"עשה את זה זול יותר" is built but dark.** The card shows the action only when
  `quote.cheaper[sid]` exists: an empty array is "the engine looked and found nothing" (a sentence),
  and an absent key is "nobody has looked" (no button). A button that does nothing is worse than no
  button, and this way the action lights up on its own the day the engine answers — no screen change.
  The unit tests cover both branches already.
- **The first thing the finished card found was a bad substitute.** On the simulator run, Tiv Taam
  swapped **לחם אחיד → לחם זיתים 540 גרם** — olive bread for plain sliced bread, which is not the same
  kind of thing, and the family would have found it in the basket. It is on the card now, named, in
  amber, with the ₪24.90 it costs and the two stores that have what was actually asked for. Naming
  every swap is what surfaced it. The swap itself is **api-fixer / product-qa** ground: the
  substitute-quality rule ("no pickles for cucumbers") does not catch bread.
- **A store can substitute a line the family never pinned.** לחם אחיד carried no barcode and was still
  marked `substituted`, by the store, not by Kaniti. So the design's "only a pinned line can be
  swapped" is the rule for *Kaniti's* swaps; a store's own swap is always shown too, and the card
  handles it — but the wording "את זה שביקשתם יש ב…" reads a little oddly for a free-text line and
  would be worth a second pass if it turns out to be common.
- **`buy-here.yaml` and `compare-shots.yaml` both had to move.** The compare's alternatives list now
  holds only *splits* (two stores, two deliveries); a single store is a card under
  "כל החנויות שמגיעות אליכם". A store that cannot fill the basket keeps its way to be bought from —
  as a quiet link reading "קנו כאן את N הפריטים שיש", never a primary button offering a basket it has
  not got (promises 1 and 6; the charter's "move it, size it, but keep it reachable").
