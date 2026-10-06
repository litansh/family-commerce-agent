# Product Landscape — Israeli Family Grocery Purchasing Agent

**Date:** 2026-09-05
**Status:** Phase 0 research complete
**Author:** Research pass with live verification of every data source claimed below

---

## Method

Every claim in this document about an API, feed or portal was **verified live** during research, not read from documentation. Where a source was tested, the evidence is stated inline. Competitor feature claims are from their own marketing pages and are marked as such — those are *not* independently verified.

---

## Existing products

| Product | Price comparison | Basket optimization | Multi-store split | Delivery cost | Travel cost | Live inventory | Cart creation | Checkout | Family preferences |
|---|---|---|---|---|---|---|---|---|---|
| **SuperMCP** (free MCP) | ✅ 16 chains, GTIN-canonical | ✅ full basket, delivered total | ✅ `split_order` | ✅ **verified fee bands + minimums + free-delivery thresholds, per address** | ❌ | ⚠️ catalogue presence only, no stock | ❌ | ❌ | ❌ |
| **Salai** (paid MCP/CLI) | ✅ | ✅ | ⚠️ Salai-side cart, not a split optimizer | ❌ | ❌ | ❌ | ⚠️ own cart only | ❌ | ❌ |
| **Kach** (kach.co.il) | ✅ 8 chains | ✅ | ✅ pick 2–4 stores | ❌ | ⚠️ flat "₪ per extra store" | ❌ | ❌ | ❌ | 🔜 receipt upload "coming soon" |
| **SuperCompare** | ✅ 15 chains | ✅ | ✅ 2–3 stores | ❌ | ⚠️ mentioned qualitatively | ❌ | ⚠️ own list only | ❌ | ⚠️ saved lists per account |
| **Cheapersal** | ✅ 30+ chains | ✅ | ❓ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **IsraBis** | ✅ 49 chains, 255k SKUs / 4h | ✅ | ❓ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **CHP** (chp.co.il) | ✅ incumbent, branch-level | ⚠️ basket at a branch | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ saved lists |
| **PriceZ** | ✅ food + pharma | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ shared lists |
| **SuperGET** | ✅ + sells an API | ✅ | ❓ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **israeli-grocery-saving-split** (GitHub, hobby) | ✅ via Salai | ✅ cheaper-store-per-item | ✅ 2 stores | ❌ | ❌ | ❌ | ✅ **Shufersal wishlist + Keshet cart** | ❌ | ✅ **JSON preference store** |
| **Retailer own apps** (Shufersal/Rami Levy/…) | ❌ own prices only | ❌ | ❌ | ✅ own | ❌ | ✅ own | ✅ own | ✅ own | ⚠️ own reorder history |
| **Instacart** (US/CA) | ⚠️ within its network | ⚠️ | ❌ | ✅ | ❌ | ✅ | ✅ **API: shopping-list deep link** | ✅ user-completed | ⚠️ |
| **AnyList / Bring!** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **shared household lists — best-in-class UX** |

Legend: ✅ does it · ⚠️ partial/weak · ❌ does not · ❓ not determinable from public material · 🔜 announced

---

## What already exists

Ranked by how much it removes from our build.

### 1. A complete, legal, free national price dataset — solved

Israel's **Food Price Transparency regulations (2014)** oblige every chain with 3+ stores to publish, per branch, a stores file, a full price file and a promotions file, updated within an hour of any price change. This is the single most important fact about this market: the hard part of a price-comparison product in most countries — getting the prices — is a solved, legally mandated problem here.

Verified live during this research:

- **Shufersal** — `https://prices.shufersal.co.il/` returns HTTP 200 and links directly to Azure blob URLs with pre-signed SAS tokens. No login. Example file: `Price7290027600007-001-001-20260905-010000.gz`.
- **Cerberus shared portal** (`url.publishedprices.co.il`) — the portal used by Rami Levy, Yochananof, Tiv Taam, Osher Ad, Keshet and others. Logged in with username `RamiLevi` and an **empty password**, then listed the directory: **2,703 files**, with price files landing **hourly** (`...20260905-070009.gz`, `...-080019.gz`, `...-090019.gz`). Fully open.

### 2. Scrapers and parsers for that dataset — solved

`OpenIsraeliSupermarkets/israeli-supermarket-scarpers` (PyPI: `il-supermarket-scraper`) is an actively maintained Python package with adapters for **37 chain sources** including Shufersal, Rami Levy, Carrefour, Yochananof, Victory, Tiv Taam, Osher Ad, Keshet, Hazi Hinam, Super-Pharm, Good Pharm and Wolt. It handles each chain's schema quirks, has Docker images, and runs daily automated tests. A sibling package handles parsing. Writing our own XML ingestion would be re-doing work that is already done, tested daily, and free.

### 3. A canonical GTIN product model with per-chain listings — **already exists and is free**

This was assumed to be one of the hardest things to build. It is not — it exists.

`get_product(gtin: "7290004131074")` against **SuperMCP** returned one canonical product (`חלב תנובה מהדרין 3% 1 ליטר`, `sizeQty: 1000`, `sizeUnit: ml`) with **16 chain listings** attached — Shufersal, Rami Levy, Victory, Carrefour, Yochananof, Osher Ad, Tiv Taam, Keshet, Machsanei Hashuk, Hazi Hinam, Stop Market, Wolt Market and three Wolt-hosted storefronts — each with that chain's own messy local name (`חלב בקרטון 3% שומן 1 ל`, `חלב תנובה טרי1ל קרטו`, `חלב 3% קרטון 1 ליטר*`).

That is precisely the "user intent → canonical product → retailer SKU" resolution layer described in the brief, already built and already normalising the naming chaos across chains.

### 4. Delivery economics per address — **already exists and is free**

`list_delivery_options(address: "הרצל 1, רמת גן")` returned **19 storefronts that actually deliver to that address**, each with minimum order, fee bands, free-delivery threshold and service-area coverage — including Wolt-hosted grocery fronts (Victory ×6 branches, Machsanei Hashuk, Wolt Market ×3).

Crucially, each carries a **provenance record**: `{confidence: "verified", verifiedAt: "2026-08-02", sourceUrl: "https://www.rami-levy.co.il/he/orders-and-deliveries", stale: false}`. Someone has done the unglamorous work of manually verifying published delivery terms per chain and dating them. That work is worth more than it looks and is genuinely tedious to replicate.

### 5. A working basket optimizer including delivery — **already exists and is free**

A real 8-line basket (`חלב 3%`, `ביצים L`, `עגבניות`, `טופו`, `חיתולי פמפרס מידה 4`, `טבליות למדיח`, `לחם אחיד`, `קוטג' 5%`) sent to `optimize_delivery` for a Ramat Gan address returned, in one call:

- all 8 lines resolved and priced (`pricedLines: 8, requestedLines: 8`)
- per-line: chosen product, unit price, line total, pack size, **normalised unit price** (`0.72 per_100ml`), promo flag, `clubOnly`/`couponOnly` flags, `substituted: true` with `substitutionReason: "chain_equivalent"`, and a deep link to the product on the retailer's site
- storefront totals: `itemsSubtotal: 150`, `deliveryFee: 35.9`, `deliveredTotal: 185.9`, `meetsMinimum: true`, `catalogSize: 15858`, `coverageRatio: 1`, `priceFeedAsOf: 2026-08-31`
- `assumptions[]` explaining each resolution decision with a machine-readable `kind` (`generic_default`) and `reason` (`availability_upgrade`, `commodity_best_effort`) — an **explainability layer**, which the brief specifically asked for

It also accepts `memberships`, `include_club`, `include_coupon`, `slot_type: pickup`, `max_split_stores`, `resolution_mode`, and a `needs_confirmation` continuation flow for ambiguous lines. A pickup run returned click-and-collect plans at a ₪15 pickup fee across Carrefour, Quik, Shufersal, Tiv Taam and Yohananof.

This is, functionally, sections 2, 8 and most of 9 of the brief — built, free, and unauthenticated.

### 6. Household list UX — solved internationally

AnyList and Bring! have spent a decade on shared-household list mechanics: real-time sync, per-member contributions, aisle grouping, recipe import. Neither knows anything about Israeli prices, but the interaction design is a solved problem worth copying rather than rediscovering.

### 7. A safe execution pattern — proven by Instacart

Instacart's Developer Platform does not let a third party place an order. It lets you **create a shopping-list page and hand the user a link**; the user picks the store, reviews the cart and checks out themselves. That pattern — agent prepares, human completes — is the mature answer to exactly the risk described in section 3 of the brief. (Instacart itself is US/Canada-only, requires a registered business, and takes 30–40 days to approve, so it is a pattern to borrow, not a service to use.)

---

## What does NOT exist

Equally explicit. This is the actual product opportunity.

### 1. Structured family memory

**Nothing in this market models a household.** Every product here is a single-user price lookup with, at best, a saved list.

Nothing models: preferred brand per product, acceptable alternative brands, brands never to buy, per-member dietary rules (vegetarian for one child, not the others), preferred package size, per-item substitution policy ("cheapest is fine" vs "brand matters" vs "never substitute"), or the household's own trade-off constants — how much saving justifies a second retailer, how much justifies driving.

SuperCompare and CHP save a list. Kach has announced receipt upload "coming soon". The `israeli-grocery-saving-split` hobby project has the most sophisticated preference model found anywhere in this landscape — a JSON store with `item_mappings` (canonical Hebrew name → confirmed GTIN, `order_count`, `unit_hint`), `default_quantities`, `global_defaults` and seasonality flags — and it is a personal Claude Code skill maintained by one person for one family.

This is the largest genuine gap.

### 2. Honest driving-vs-delivery economics

SuperMCP prices **online storefronts only** — delivery and click-and-collect. It does not price the basket at a physical branch you would drive to.

But the transparency feed is **branch-level**, and Rami Levy's public API exposes per-branch availability (`available_in: [179, 331, 411, …]`). So the data to answer *"would it be cheaper if I drive there myself?"* exists and nobody joins it to distance, ₪/km, parking and a configurable value of time. Kach's "₪ per extra store" is a flat constant, not a real travel model.

This is a real gap, and it is the question a family actually asks.

### 3. Execution

**No product in this market builds a cart on a retailer's site.** Every one of them ends at "here's the cheapest — now go type it in yourself." For a 60-item weekly family shop, that re-typing is most of the work, and it is where the entire value proposition leaks away.

The only working proof that it is *possible* is the `israeli-grocery-saving-split` skill, which drives Shufersal's wishlist and Keshet's Angular cart through browser automation. It works, and its own documentation lists why it is fragile (below).

### 4. Real-time stock

The transparency feed carries **no stock data at all** — it is a price feed. Only the retailers' own storefronts know what is actually in stock. Shufersal's search endpoint does return `stock.stockLevelStatus`, and Rami Levy's API returns `available_in` branch arrays, but no aggregator surfaces this. Any promised total is a *quote*, not a guarantee, until a real cart is built.

### 5. A conversational, household-facing interface

Salai and SuperMCP are MCP servers for developers and AI agents. The consumer apps are search-and-compare forms. Nothing lets a family member say *"we need groceries for the weekend"* or *"buy what we usually buy"* and get a real answer — because nothing has the family memory that would make those sentences meaningful.

### 6. Cross-domain purchasing

Super-Pharm and Good Pharm publish under the same transparency law and appear in `il-supermarket-scraper` and Kach. But nothing treats pharmacy, baby, pet and household as one purchasing surface with one memory.

---

## What we can reuse

| Asset | What it gives us | Access | Risk |
|---|---|---|---|
| **SuperMCP** (`https://supermcp.web.app/mcp`) | Canonical GTIN catalogue, per-chain listings, per-address delivery terms, basket pricing, split, promotions, substitutions, pickup | Free, **no auth**, 8 tools | **High — single free hobby service, no ToS, no SLA, no rate-limit policy, no stability guarantee.** Must be treated as a replaceable connector, never as our database. |
| **Price Transparency feeds** | Branch-level prices + promotions, hourly, for ~35 chains — the fallback that makes SuperMCP replaceable, and the **only** source for physical-branch pricing | Free, legally mandated. Shufersal: open Azure blobs. Cerberus: username = chain name, blank password (verified) | Low. Statutory. |
| **`il-supermarket-scraper`** (PyPI) | 37 maintained chain adapters, Docker, daily CI | Free, open source | Low-medium — beta, some chains flaky, some geo-restricted |
| **Rami Levy public API** (`POST /api/catalog`) | Unauthenticated JSON with **GS1 attributes**: barcode, brand, net weight, nutrition, allergens, kosher, `Search_Tags` synonyms, per-branch `available_in`, department taxonomy | Free, no auth (verified) | Medium — undocumented, can change without notice |
| **Shufersal online search** (`/online/he/search/results?q=…`) | Unauthenticated JSON with product code and **`stock.stockLevelStatus`** | Free, no auth (verified) | Medium — undocumented; site has a WAF |
| **`israeli-grocery-saving-split`** | Preference-store schema; documented Shufersal wishlist API and Keshet/Prutah REST API; a catalogue of failure modes learned the hard way | MIT licence | — |
| **Salai** | Second opinion / redundancy for product resolution | Paid, API key | Low, but a paid dependency for something SuperMCP does free |
| **Instacart's list-page pattern** | The safe execution model: agent prepares, human checks out | Design pattern only | — |
| **AnyList / Bring!** | Household list interaction design | Design reference only | — |

---

## What we should NOT build

Building any of these would produce an inferior duplicate of something that already works.

1. **XML price ingestion from scratch.** Use `il-supermarket-scraper`. 37 adapters, daily CI, free.
2. **A cross-chain price-comparison consumer app.** This market has at least eight, several free, one government-adjacent and entrenched (CHP), one with 49 chains and 255k SKUs updated 4-hourly (IsraBis). We would arrive last and worst.
3. **A canonical product/GTIN resolver, as a first move.** SuperMCP's already merges 16 chains' naming chaos under one GTIN. Build the *thin* mapping we uniquely need — the family's own words (`"החלב הרגיל"`) → GTIN — and let SuperMCP own GTIN → chain SKU.
4. **A delivery-terms database.** Someone has already manually verified fee bands, minimums and service areas per chain and stamped them with dates and source URLs. Reproducing that is weeks of tedium for parity.
5. **Our own price database on day one.** A DynamoDB table of national prices costs real money and buys nothing until SuperMCP proves unreliable. Design the seam; do not build behind it yet.
6. **Full checkout automation.** Not in the MVP, possibly never. See risks.
7. **Anything for pharmacy, pet, or electronics.** Keep the connector interface honest and stop there.
8. **A WhatsApp bridge.** `israeli-grocery-saving-split` demonstrates it works and also demonstrates the cost: an always-awake Mac, an unofficial protocol bridge, and a ban risk on a personal WhatsApp account. A PWA is cheaper and safer.

---

## Our actual differentiation

Stated precisely, and deliberately narrow.

> Every existing product answers **"what does this basket cost at each chain?"**
> None of them answers **"what should *this family* buy, and what is the least annoying way to actually get it into the house?"**

Four things, none of which exists today:

**1. Structured household memory as a first-class domain model.**
Not chat history, not a saved list. Explicit, inspectable, editable records — `ProductPreference`, `BrandPreference`, `SubstitutionPolicy`, `RetailerPreference`, `PriceSensitivity`, `ConveniencePreference` — owned by the household, not a person, and versioned. This is what makes *"buy what we usually buy"* and *"cheaper replacement, but not that brand"* into executable queries rather than chat.

**2. Total-cost decisions including the family's own constants.**
Every competitor optimises money. A family optimises money, time and hassle together. We model ₪/km, round-trip time, parking, a configurable and explicitly non-objective value of time, and the household's own thresholds ("a second retailer needs to save ₪40", "driving needs to save ₪80"). Delivery, pickup and drive-yourself get compared on one honest axis, with cash cost and time-inclusive cost shown **separately** and never conflated.

**3. Execution — cart preparation, with the human at the payment step.**
The differentiator is not the recommendation, it is not having to re-type 60 items. Instacart's pattern is the right one: the agent prepares a cart the family can inspect, and a human checks out. This is where the actual weekly hours go.

**4. One household surface, extensible by domain.**
The retailer connector interface and the preference model are domain-neutral. Grocery is domain #1 and the only one we build.

### What our differentiation is *not*

We are not building a better price engine. SuperMCP's is better than ours would be for at least a year, and it is free. Every hour spent on price comparison is an hour not spent on the four things above.

---

# RECOMMENDATION

## 🟡 BUILD WITH REDUCED SCOPE

**Build the family layer and the execution layer. Reuse everything below them.**

### Why

The research changed the shape of the project. Three of the four things this brief proposed to build — the canonical product model (§8), the price/availability engine, and the delivery-aware basket optimizer (§9) — **already exist, work well, and are free**, and that was verified by running real baskets through them, not by reading a landing page.

Building those anyway would mean spending the first three months reaching parity with a free service, and arriving ninth in a market that already contains CHP, PriceZ, Kach, SuperCompare, Cheapersal, IsraBis, SuperGET and Salai.

But the two things a family actually feels — *"the system knows what we buy"* and *"I didn't have to type 60 items"* — are **absent from every product in this market, without exception.** That gap is real, it is where the weekly hours go, and it is defensible precisely because it is unglamorous: household memory is worth little to a price-comparison startup and a lot to one family.

One early finding was **measured again at real family scale and reversed** — recorded in full in `basket-economics.md`:

> A 12-line test basket showed no benefit from splitting. A **36-line basket — this household's actual weekly shop, ~₪1,000** — at the same address showed a two-store split saving **₪67/week (~₪3,500/year)**. Basket size was the whole variable. **Splitting is in the MVP**, capped at two stores; a third delivery fee never paid for itself in testing.

The same measurement produced the number that actually justifies the project:

> **The identical 36-line basket costs ₪836 at Rami Levy and ₪1,083 at Shufersal — a ₪247 spread, 30%, on one week's shop. ≈₪12,800/year on chain choice alone**, requiring no splitting, no driving and no automation.

And the household's own stated pain reframed the priority order:

> *"we mostly forget something and then we need to buy expensively in a nearby super"* — a **completeness problem, not an optimization problem**. Nothing in this market solves it, because solving it requires knowing what this household normally buys. That moves household memory from "differentiator #1 of four" to **the feature the MVP is built around**.

### What we reuse

- **SuperMCP** for product resolution, prices, delivery terms and delivered totals — behind a connector interface, never called directly from domain code
- **Price Transparency feeds via `il-supermarket-scraper`** for branch-level physical-store pricing (which SuperMCP does not cover) and as the fallback that makes SuperMCP replaceable
- **Rami Levy's public API** for GS1 attributes and branch availability, to enrich product resolution
- **`israeli-grocery-saving-split`** — **extract ideas, do not fork.** Its preference schema and its documented retailer internals are worth more than its code, which is prompt-shaped Markdown for a different runtime. Full review in `docs/retailer-integration-matrix.md`.

### What we build

1. Household preference model and memory (the core asset)
2. A deterministic total-cost optimizer over quotes — money, travel, time, convenience, substitution — with configurable weights and a real test suite
3. Driving-vs-delivery-vs-pickup economics on branch-level data
4. Cart preparation, stopping before payment
5. A mobile-first household PWA

### Biggest risks

1. **SuperMCP dependency** — one free hobby service, no ToS or SLA, is currently load-bearing for our prices. Mitigated by the connector seam and a costed fallback plan; see `docs/data-sources.md`.
2. **Cart automation fragility and ToS** — retailer terms almost certainly prohibit automation; Shufersal has a WAF that already fires on ordinary product names. See `docs/mvp-proposal.md`.
3. **Being wrong about the value of memory.** If after ten weeks the family still edits every list by hand, the differentiation is not real and the project should stop. This is a phase gate, not a footnote.

### First implementation step

Not code. **Instrument the current reality for two weeks:** log the family's actual weekly list, and for each list run the SuperMCP basket and record what it got right, what it resolved wrong, and what a human had to fix. That data is the acceptance criterion for Phase 1 *and* the seed corpus for the preference model. If SuperMCP's resolution is good enough on a real family's real list, the reduced scope holds. If it is not, the scope is wrong and we find out for the price of two weeks instead of three months.

Details: `docs/data-sources.md` · `docs/retailer-integration-matrix.md` · `docs/mvp-proposal.md` · `docs/architecture-v0.md`
