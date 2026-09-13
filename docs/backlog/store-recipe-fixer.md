# store-recipe-fixer's lines

One file per agent so two agents never edit the same file (parallel runs kept
colliding in `docs/BACKLOG.md`). Tick a line when its pull request is open, and say where the
proof lives. The whole list, and what it means, is `docs/BACKLOG.md`.

- [ ] **Order history read on the device and posted**, per ADR 0011, for every store. *store-recipe-fixer*
- [ ] **Branch stock for every chain, not only Rami Levy**: an item the family's branch does not carry is missing in the compare. stor.ai exposes per-branch availability; Hatzi Hinam and Wolt venues too. *store-recipe-fixer*
- [ ] **The store's basket count for every cart recipe** (`basketCountJs`): what Kaniti says is added must equal what the store holds, per store. *store-recipe-fixer*
- [ ] **Cloud copy of every store session.** The phone captures the store's cookies/tokens after sign-in and posts them; the log now shows what was captured (`store-session` events). No household has a sealed session yet — find out why the capture posts nothing for Rami Levy and fix it. *store-recipe-fixer*
- [ ] **Session restore from the cloud.** When the phone's WebView lost a store session (reinstall, new phone) but the cloud has one, put the cookies and tokens back before asking anyone. *store-recipe-fixer + api-fixer*
- [ ] **Order-history recipes verified on real accounts**: Rami Levy, the stor.ai chains, Hatzi Hinam report their response shape to the log; tune field names from the first real order. *store-recipe-fixer*
- [ ] **Cart recipes for stor.ai (Victory, Carrefour, Keshet, Mahsanei HaShuk, Tiv Taam) and Wolt** — today per-item deep links; the family taps "add" per item. Native carts need a test account per chain (the owner allowed creating fictive accounts). *store-recipe-fixer*
- [ ] **Hatzi Hinam cart recipe** written, unverified. *store-recipe-fixer*
- [ ] **Rami Levy cart recipe's name fallback picks an unrelated product**: `apps/mobile/src/lib/stores.ts` line ~270, `byName[l.name]` — a barcode the catalogue lacks falls back to a free-text name match that is not held to the head-word/half-the-words rule from PR #40; reproduced live with `cart-recipe-lab.mjs`'s deliberately-absent line (barcode `9999999999999`, name "לא קיים"), which the recipe added as "קופסת אחסון אניגליש קייק" (a storage box). Now a red `PROMISE9-VIOLATION` in the daily `cart` check (this PR) — was silently "ok" before. *store-recipe-fixer*
- [x] ~~**Rami Levy cart recipe's name fallback picks an unrelated product**~~: fixed in `8583355` (already on main) — the stem for "קיים" was shortening to two letters, which then prefix-matched "קייק" (cake); `__kStem` now only shortens while the result stays a word (≥3 chars) and `__kPick`'s prefix match needs ≥4 chars either side. Proof: `test/name-match.test.ts` ("a short stem never matches by prefix") passes 6/6; `cart-recipe-lab.mjs rami-levy` (run twice) reports `byName:0`, the deliberately-absent line `missing`, no `PROMISE9-VIOLATION`, `basket page count: 2` matching `2 added`. `node ops/check.mjs --only cart` is green. *store-recipe-fixer*
- [ ] **Branch stock for the other chains** (stor.ai exposes per-branch availability; Hatzi Hinam, Wolt venues): an item the family's branch does not carry is missing in the compare, not a surprise at checkout. *store-recipe-fixer + api-fixer*
- [ ] **Basket count for every store with a cart recipe** (Hatzi Hinam, the stor.ai chains once their recipes exist, Wolt): a `basketCountJs` per store, read on the cart page. *store-recipe-fixer*
- [ ] **History from the DOM**: for every store, a second rung that reads the orders page itself when the orders API changes. *store-recipe-fixer*
- [ ] **Cart rungs for stor.ai, Wolt, Hatzi Hinam**: a native rung above the per-item pages (needs the fictive accounts the owner allowed). *store-recipe-fixer*
- [ ] **Delivery windows on the compare** (the chains' slots next to Wolt's live minutes): needs a saved address at the chain, or Kaniti filling the chain's address form once. *store-recipe-fixer + app-designer*
- [ ] **"Fast" measured for every store**: Wolt is live; the chains count as a window. Read each chain's next slot from the phone once connected. *store-recipe-fixer*
- [ ] **New storefronts the scout finds** become connectable: a PR per platform-known store. *store-recipe-fixer*
