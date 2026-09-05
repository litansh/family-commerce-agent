# Data Sources

**Date:** 2026-09-05
**Status:** verified live during Phase 0

Every source below was probed during research. Where a probe was run, the exact result is recorded so a future reader can tell the difference between *"this is documented to work"* and *"this was observed working on 2026-09-05"*.

---

## Tier 1 — Statutory open data (the foundation)

### Food Price Transparency regulations, 2014

Every chain with 3+ stores must publish, **per branch**: a stores file, a full price file, and a promotions file — as gzipped XML, updated within one hour of any price change, with an end-of-day full file. Files carry product name, **barcode**, total price, price per unit of measure, and promotion price.

This is why Israel is an unusually good market for this product: prices are a solved, legally guaranteed input.

**Two access patterns:**

**a) Chain-hosted (Shufersal, Carrefour)**

```
GET https://prices.shufersal.co.il/            → HTTP 200
```
Returns a paginated listing linking directly to Azure blob URLs with pre-signed SAS tokens. No authentication.

```
https://pricesprodpublic.blob.core.windows.net/price/
  Price7290027600007-001-001-20260905-010000.gz?sv=2014-02-14&sr=b&sig=…&se=…&sp=r
```

Filename encodes: `Price` | chain GS1 id `7290027600007` | subchain `001` | branch `001` | date | time.

**b) Cerberus shared portal** — `https://url.publishedprices.co.il`

Used by Rami Levy, Yochananof, Tiv Taam, Osher Ad, Keshet, Politzer, Salach Dabach, Fresh Market and others.

**Verified access, 2026-09-05:**
1. `GET /login` → CSRF token in `<meta name="csrftoken" content="…">`
2. `POST /login/user` with `csrftoken`, `username=RamiLevi`, **`password=` (empty)** → HTTP 302 (success)
3. Re-read the CSRF token from `/file` — *the token rotates after login; reusing the pre-login token returns `"CSRF security check failed"`*
4. `POST /file/json/dir` with the post-login token → **`iTotalRecords: 2703`**

Observed file cadence — **hourly**:
```
Price7290058140886-001-001-20260905-070009.gz    25,498 B
Price7290058140886-001-001-20260905-080019.gz    85,606 B
Price7290058140886-001-001-20260905-090019.gz   771,160 B
```

Username is the chain's own identifier; the password is blank for most chains. This is by design — the regulations require public access.

**What it gives us that nothing else does:** *branch-level* prices. This is the **only** source for "what would this basket cost at the Rami Levy in Givatayim if I drove there", and it is therefore load-bearing for our driving-vs-delivery differentiator.

**What it does not give us:** stock, delivery fees, delivery slots, or any online-storefront concept. It is a price feed, nothing more.

### `il-supermarket-scraper` — do not write our own ingestion

`OpenIsraeliSupermarkets/israeli-supermarket-scarpers` · PyPI `il-supermarket-scraper` · Docker images · daily automated tests.

**37 chain adapters:** Bareket, Yeinot Bitan & Carrefour, Cofix, City Market (×2), Dor Alon, Good Pharm, Hazi Hinam, Het Cohen, Keshet, King Store, Maayan 2000, Mahsani Ashuk (×2), Netiv Hased, Meshmat Yosef (×2), Osher Ad, Polizer, **Rami Levy**, Salach Dabach, Shefa Barcart Ashem, **Shufersal**, Shuk Ahir, Stop Market, **Super-Pharm**, Super Yuda, Super Sapir, Fresh Market & Super Dosh, Quik, **Tiv Taam**, **Victory** (×2), Yellow, **Yohananof**, Zol VeBegadol, **Wolt**.

Self-described as beta; some chains are flaky, some sources are geo-restricted. Still far better than 37 hand-written adapters.

---

## Tier 2 — Aggregators (the reason the scope is reduced)

### SuperMCP — `https://supermcp.web.app/mcp` ⭐ primary

Streamable-HTTP MCP. **Free, no registration, no API key, no credit card.** Server identifies as `super-mcp` version `0007863b`.

Its own instructions state the boundary plainly: *"It doesn't order, doesn't pay and doesn't change anything."*

**Eight tools:**

| Tool | What it does |
|---|---|
| `optimize_delivery` | Prices a whole list at every storefront delivering to an address; ranks by what the order actually costs |
| `split_order` | Answers "can I save by ordering from more than one shop?" — returns which items to buy where, with each leg's own subtotal |
| `list_delivery_options` | Which storefronts deliver here, with fee, minimum, free-delivery threshold, service area |
| `get_delivery_terms` | Full published terms for one storefront — every fee band over basket size |
| `search_products` | Canonical catalogue by free text (Hebrew), brand, category, or exact GTIN |
| `get_product` | One canonical product by UUID or GTIN, **with every per-chain listing** |
| `suggest_similar_products` | Substitution candidates when resolution picked wrong |
| `get_promotions` | Promotions — `2 for ₪30`, club price, second-unit discount — filterable by store or product |

**Live verification, 2026-09-05.** 8-line basket, address `ביאליק 20, רמת גן`:

```
address resolved   → 32.0806119, 34.8149998  precision: "address"
pricedLines        → 8 / 8      coverageRatio: 1
best plan          → רמי לוי אונליין
                     itemsSubtotal 150.00 + deliveryFee 35.90 = deliveredTotal 185.90
                     meetsMinimum true · catalogSize 15,858 · priceFeedAsOf 2026-08-31
deliveryTerms      → confidence "verified", verifiedAt "2026-08-02",
                     sourceUrl "https://www.rami-levy.co.il/he/orders-and-deliveries"
```

Per-line output includes normalised unit price (`0.72 per_100ml`), `clubOnly` / `couponOnly` flags, `substituted: true` with `substitutionReason: "chain_equivalent"`, and a deep link to the item on the retailer's site.

An `assumptions[]` array explains every resolution decision in machine-readable form:
```json
{"itemIndex": 2, "query": "עגבניות", "kind": "generic_default",
 "reason": "commodity_best_effort",
 "message": "\"עגבניות\" names a kind of product rather than one product…"}
```

`list_delivery_options` for the same address returned **19 storefronts**, all `confidence: verified`:

| Storefront | Minimum |
|---|---|
| רמי לוי אונליין, שופרסל ONLINE | none |
| וולט מרקט (×3 branches), ויקטורי-וולט (×6), מחסני השוק-וולט | ₪70 |
| קרפור אונליין, קוויק, יהלומים ביתן | ₪200 |
| ויקטורי אונליין | ₪250 |
| טיב טעם אונליין | ₪300 |
| קשת טעמים אונליין | ₪350 |
| חצי חינם אונליין | ₪500 |

`get_product(gtin: "7290004131074")` returned the canonical product plus **16 chain listings** with each chain's own local name — the cross-chain naming problem, already solved.

`slot_type: "pickup"` returned click-and-collect plans at a ₪15 pickup fee across Carrefour, Quik, Shufersal, Tiv Taam and Yohananof.

**Also accepts:** `memberships` (e.g. Rami Levy credit card), `include_club`, `include_coupon`, `max_split_stores` (default 2), `resolution_mode` (`fast` vs strict), `intent` (the shopper's own framing), and a `needs_confirmation` / `continuation` flow for ambiguous lines.

**Limits found:** chain-level listings only — **no per-branch prices**, so it cannot answer the driving question. No stock. No cart, no order, no payment, by design.

> ### ⚠️ Dependency risk — the single largest technical risk in this project
>
> SuperMCP is a **free service on Firebase hosting with no published terms of service, no SLA, no documented rate limits, and no stability guarantee.** No `/mcp/docs` endpoint exists (404). It could add auth, add pricing, change its schema, or disappear, without notice.
>
> It is currently load-bearing for our prices, our product resolution and our delivery terms.
>
> **Mitigation, and it is not optional:**
> 1. It sits behind a `QuoteProvider` interface. Domain code must never import an MCP client.
> 2. **Cache every response we receive**, keyed by `(basket_hash, address, date)`. This doubles as our regression corpus and our resolution-quality evidence.
> 3. Keep a costed fallback ready: `il-supermarket-scraper` → S3 → our own price index. Estimated **2–3 weeks** to reach price parity, but **not** delivery-terms parity — the manually verified fee bands are the part that hurts to lose.
> 4. Health-check it in CI daily with a fixed basket and alert on schema drift or a total moving more than a threshold.
> 5. Be a good citizen: cache aggressively, never poll, keep volume to what one family plausibly generates.

### Salai — `https://mcp.salai.co.il/mcp` (paid, secondary)

Hosted MCP + npm CLI + web app. Requires an API key (`X-API-Key`). Tools: `fulfill_shopping_list`, `search_products`, `get_retailers`, `get_stores`, plus Salai-side cart management.

Does product resolution and cross-store quotes well, and it is the engine behind `israeli-grocery-saving-split`. But per its own site it does **not** model delivery fees, travel cost, retailer-side carts, checkout, or family preferences — so it covers strictly less than SuperMCP while costing money.

**Verdict: not in the MVP.** Keep as a documented second `QuoteProvider` implementation for redundancy if SuperMCP proves unreliable. That is exactly what the connector seam is for.

Useful artefact regardless — its documented retailer/store IDs:

| Retailer | retailerId (GS1) | Online storeId |
|---|---|---|
| שופרסל | `7290027600007` | 413 |
| רמי לוי | `7290058140886` | 39 |
| יוחננוף | `7290803800003` | 150 |
| ויקטורי | `7290696200003` | 097 |
| חצי חינם | `7290700100008` | 103 |
| טיב טעם | `7290873255550` | 519 |
| קרפור | `7290055700007` | 5304 |
| קשת טעמים | `7290785400000` | 120 |
| אושר עד | `7290103152017` | varies |

---

## Tier 3 — Retailer endpoints (undocumented, verified working)

### Rami Levy — `POST https://www.rami-levy.co.il/api/catalog` ⭐

**Unauthenticated. No API key. Returns rich structured JSON.** Verified 2026-09-05.

```bash
curl -X POST https://www.rami-levy.co.il/api/catalog \
  -H 'Content-Type: application/json' \
  -d '{"store":331,"q":"חלב תנובה","from":0,"size":2}'
```

Per product: `barcode`, `price.price`, `department`/`group`/`subGroup` taxonomy, `available_in` (array of branch IDs), images, kashrut codes — **plus a full GS1 attribute block**:

```json
"gs": {
  "BrandName": "תנובה",
  "Product_Description_English": "Tnuva Milk 3% 2L Carton Mehadrin",
  "Country_of_Origin": "IL",
  "Product_Dimensions": { "Net_Weight": {"value":"2","UOM":"קג"}, … },
  "Allergen_Type_Code_and_Containment": [6818],
  "Nutritional_Values": [ … ],
  "Search_Tags": ["7290116936307","חלב תנובה 3% שומן 2 ליטר","חלב מהדרין",
                  "חלב טרה","חלב 3%","חלב 2 ליטר","חלב","משקה חלב"]
}
```

**Why this matters more than it first appears.** `Search_Tags` is a hand-curated **synonym list per product** — the exact thing needed to map a family's own words onto a GTIN, and precisely the piece SuperMCP does not expose. The allergen and dietary blocks feed the per-member dietary rules in the preference model. `available_in` gives branch-level availability for the driving comparison.

Undocumented and unversioned; it can change without notice. Treat as enrichment, never as a hard dependency.

### Shufersal online search — unauthenticated JSON

```bash
curl 'https://www.shufersal.co.il/online/he/search/results?q=חלב:relevance&limit=3' \
  -H 'x-requested-with: XMLHttpRequest' -H 'accept: application/json'
```

Returns `{results: [{code: "P_522319", name: "…", stock: {stockLevelStatus: {code: "inStock"}}, …}]}`.

**The only verified live-stock signal found in this entire research pass.** `P_`-prefixed codes are Shufersal-internal, not GTINs — a mapping is required.

The site runs a WAF (see the failure catalogue in `retailer-integration-matrix.md`).

### Keshet Teamim / Prutah platform — Bearer-token REST

Keshet runs on **Prutah**, a white-label Israeli grocery e-commerce platform (AngularJS 1.8, app module `ZuZ`). Documented in `israeli-grocery-saving-split`:

```
GET  /v2/retailers/1219/branches/2585/products?appId=4&query=…&size=20&filters=…
GET  /v2/retailers/1219/branches/2585/products/autocomplete
POST /v2/retailers/1219/branches/2585/carts/{cartId}
GET  /v2/retailers/1219/branches/2585/specials
GET  /v2/retailers/1219/users/{userId}/coupons
```

Auth is a Bearer token lifted from the Angular session (`User.session.token`), obtained via phone + SMS OTP.

**Strategically the most interesting endpoint shape found.** If Prutah is genuinely white-label across several Israeli chains, one connector would cover several retailers — the single highest-leverage integration in this market.

**Not verified.** Direct probes of `keshet-teamim.co.il`, `victoryonline.co.il` and `yochananof.co.il` all returned **HTTP 403 or connection failure** from this machine even with a browser User-Agent — bot protection rejecting datacenter/VPN egress or TLS fingerprint. `osherad.co.il` is Next.js (a different platform) and `shop.hazi-hinam.co.il` did not expose platform markers.

**Open question for Phase 1** — worth an hour of a real browser's time, because the answer changes the connector strategy materially: *how many Israeli chains run on Prutah, and does the same `/v2/retailers/{id}/branches/{id}/…` shape work across them?*

---

## Tier 4 — Reference only

| Source | Status |
|---|---|
| **Instacart Developer Platform** | US/Canada only, registered business required, 30–40 day approval. Not usable. **Borrow the pattern**: `create_shopping_list_page` returns a link the *user* opens to pick a store and check out — the agent never touches payment. |
| **Wolt** | Developer platform is **merchant-side only** (POS integration, inventory upload, Wolt Drive). No consumer ordering API. Wolt-hosted grocery storefronts are already visible *through* SuperMCP, which is the only access we need. |
| **AnyList / Bring!** | No public API. Household list UX reference. |
| **CHP, PriceZ, Cheapersal, IsraBis, SuperGET** | Consumer apps. SuperGET sells an API; no reason to buy it given SuperMCP is free and richer. Competitive reference only. |

---

## Summary — what each source is for

| Need | Primary | Fallback |
|---|---|---|
| Canonical product / GTIN | SuperMCP `get_product` | Transparency feed + Rami Levy `gs` block |
| Family's words → GTIN | **Our preference store** (the thing we build) | Rami Levy `Search_Tags` for cold start |
| Online prices + delivered totals | SuperMCP `optimize_delivery` | Salai, then own index |
| Delivery fees, minimums, slots | SuperMCP `list_delivery_options` / `get_delivery_terms` | Manual per-chain table (expensive) |
| **Branch-level prices (driving)** | **Transparency feed via `il-supermarket-scraper`** | none — this is the only source |
| Promotions | SuperMCP `get_promotions` | Transparency promo files |
| Live stock | Shufersal search; Rami Levy `available_in` | none — accept that quotes are estimates |
| Cart creation | Retailer-specific — see integration matrix | manual |

**The one-line version:** everything except branch-level pricing and family memory can be rented. Branch-level pricing is free and statutory. Family memory is ours to build.
