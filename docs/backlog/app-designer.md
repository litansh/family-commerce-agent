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
- [ ] **A full basket at every store** (docs/design/a-full-basket-everywhere.md), the owner's central ask: every store priced for the whole list using its own alternatives, the family's exact basket priced beside it with the difference in shekels, and a 'make it cheaper' action. Coverage becomes a fact on the card, not a reason to hide a store. *app-designer*
