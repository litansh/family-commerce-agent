# Architecture v0

**Date:** 2026-09-05
**Status:** proposed, pending Phase 1 evidence
**Product shape:** multi-household SaaS · Google sign-in · App Store + Play Store as the end goal

---

## The one principle

> **LLMs interpret. Deterministic code decides.**
>
> Prices, totals, optimization, availability and transaction state are owned by testable code. The LLM parses language, asks good questions, proposes substitutions, and explains decisions it did not make.

`israeli-grocery-saving-split` put the split arithmetic inside a prompt. It works until it silently doesn't, and you cannot write a test for it. That is the specific mistake this architecture exists to avoid.

---

## Layers

```
  Mobile app  (Expo / React Native — iOS, Android, Web from one codebase)
        │  HTTPS + Cognito JWT
        ▼
  API  (API Gateway HTTP API → Lambda)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Shopping Orchestrator          — owns the run, not the math│
├─────────────────────────────────────────────────────────────┤
│  Intent Agent          🧠 LLM   text → structured list      │
│  Product Resolver      ⚙️+🧠    line → canonical product     │
│  Quote Engine          ⚙️       basket → priced options      │
│  Basket Optimizer      ⚙️ pure  options → ranked strategies  │
│  Explanation Agent     🧠 LLM   numbers → plain language     │
│  Cart Preparer         ⚙️       chosen option → real cart    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
  Household Memory   (DynamoDB, PK = household)
  Quote Providers    (SuperMCP · price index · Salai)
  Cart Connectors    (Shufersal · Rami Levy · deep links)
```

⚙️ deterministic and unit-tested  ·  🧠 LLM, never touching arithmetic

### Where this differs from the architecture in the brief

The brief proposed a *Retailer Discovery Layer* and a *Price & Availability Engine* as things we build. Research showed both already exist and are free. They collapse into one `QuoteProvider` interface with a rented first implementation.

The brief's *Product Resolver* was to map intent → canonical product → retailer SKU. SuperMCP already owns canonical → chain SKU across 16 chains. So our resolver shrinks to the half nobody else has: **the household's own words → canonical product**. That is a much smaller and much more defensible piece of software.

An **Explanation Agent** is added: the optimizer must justify itself, and turning its numbers into a sentence is a genuinely good use of an LLM — precisely because it happens *after* every number is fixed.

---

## Domain model

Everything meaningful hangs off the household, never the person. A family shares memory; a person only signs in.

```
Household ──┬── Member (Google identity, role)
            ├── Address (home, alternatives)
            ├── Constants (₪/km, value of time, parking,
            │              min saving for 2nd store, min saving to drive)
            ├── RetailerAccount ──► Secrets Manager ref (never a secret)
            ├── ShoppingList ── ListItem
            ├── ShoppingRun ── Quote ── Option ── PreparedCart
            └── Memory
                 ├── ProductPreference      "milk" → GTIN, qty, unit, confirmed, order_count
                 ├── BrandPreference        prefer / accept / never, per category
                 ├── SubstitutionPolicy     never | same_brand | equivalent | cheapest
                 ├── RetailerPreference     preferred, acceptable, excluded
                 ├── PriceSensitivity       per category: cheapest_ok | brand_matters | organic_only
                 ├── ConveniencePreference  max delivery fee, willingness to split, to drive
                 └── DietaryRule            per member: vegetarian, allergen, kosher
```

Two rules that matter more than the schema:

**Memory is inspectable and editable.** Every preference is a row a family can see and change in the UI. A preference the family cannot correct is a bug that compounds weekly.

**Memory writes only on a completed shop.** An abandoned run writes nothing. Borrowed from `israeli-grocery-saving-split`, and it is the difference between memory that improves and memory that drifts.

---

## Product resolution — the piece we own

Four-stage cascade, cheapest and most certain first:

```
1. Household memory     "החלב הרגיל" → GTIN 7290004131074      confirmed, free, instant
2. Exact GTIN / barcode                                          deterministic
3. Catalogue search     SuperMCP search_products                 ranked candidates
4. LLM disambiguation   only when 1–3 are ambiguous              → asks the human
                        ↓
                   human confirms once
                        ↓
                   written to memory — never asked again
```

The system distinguishes four relationships explicitly, and never lets an LLM decide between them alone:

| Relationship | Test |
|---|---|
| **same product** | identical GTIN |
| **equivalent** | same brand + category + size within tolerance |
| **acceptable substitute** | same category + size tolerance, allowed by the household's `SubstitutionPolicy` and every member's `DietaryRule` |
| **different product** | everything else — offered, never chosen |

**Invariant, cheap and high-value:** if a line's price differs more than ~3× across chains, flag it as a probable resolution error rather than a bargain. This single check catches the `בננה` → banana protein powder class of failure that cost the prior project real money.

---

## The optimizer

A **pure function**. No I/O, no network, no LLM. Given quotes and household constants, it returns ranked strategies. It is the most testable thing in the system and must stay that way.

```
EffectiveCost = ItemsCost
              + DeliveryFee | TravelCost
              + TimeCost            (only if the household opted in)
              + ConveniencePenalty  (per extra retailer)
              + SubstitutionPenalty (per compromised line)
```

**Cash cost and time-inclusive cost are reported as two separate figures and are never added together in any output.** Time has no objective monetary value; the household sets its own rate or leaves it at zero, and the UI shows both columns.

Weight profiles, selectable per run: `cheapest` · `convenience` · `balanced` (default) · `single_retailer_only` · `max_savings`.

Every strategy carries an `explanation` object — the raw numbers behind its rank. The Explanation Agent renders it; it never computes it.

**Travel model**
```
TravelCost = 2 × distance_km × household.cost_per_km + parking
TimeCost   = round_trip_minutes × household.value_of_time_per_hour / 60
```
Requires branch-level prices, which only the transparency feed has — the reason that feed stays in the architecture even though SuperMCP covers everything online.

**Known economic finding, and it shapes the UI:** a 12-line basket run through `split_order` returned no split at all, because a second ₪30–40 delivery fee exceeds typical item-level savings. **Splitting is mostly a pickup-and-driving feature, not a delivery feature.** The UI should not lead with a split option for delivery when the arithmetic rarely supports one.

---

## Connectors

```
QuoteProvider          CartConnector
  searchProduct()        prepareCart(items) → PreparedCart
  getProduct()           getStatus()
  quoteBasket()          capabilities()
  getDeliveryOptions()
  getPromotions()
```

Two interfaces, not one twelve-method interface. Pricing and cart-building have different failure modes, different trust levels, and different hosting — conflating them would drag browser fragility into the pricing path.

| Implementation | Strategy | Status |
|---|---|---|
| `SuperMcpQuoteProvider` | rented, free | MVP |
| `PriceIndexQuoteProvider` | own, transparency feed — branch-level, drives the driving comparison | MVP (Shufersal + Rami Levy branches only) |
| `SalaiQuoteProvider` | rented, paid | documented, not built |
| `DeepLinkCartConnector` | universal, unbreakable | **MVP default** |
| `ShufersalWishlistCartConnector` | native list-import feature | MVP enhancement |

**Preference order for any connector: official API → documented feed → reliable public dataset → browser automation.** Browser automation is last, and it is never the only path — every retailer must remain reachable by deep link, so a WAF change degrades the experience instead of ending the shop.

`capabilities()` lets the orchestrator ask what a connector can actually do rather than assuming, which is what keeps a second retailer from becoming a rewrite.

---

## Mobile

**Expo / React Native, one codebase → iOS, Android and web.**

The end goal is the App Store and Google Play, so the honest choice is the stack that reaches both without a rewrite. Expo does, and `react-native-web` gives the web build for free during development — so early phases still get browser-speed iteration without building a PWA that gets thrown away.

- **Flutter** — equally capable, but the Dart ecosystem is a worse fit for a TypeScript backend and shared domain types.
- **PWA only** — fastest to start, but iOS PWAs cannot reach the App Store, and the whole thing would be rebuilt at Phase 6. Ruled out precisely *because* store distribution is the goal.

Development order stays speed-first: web target during Phases 1–4, EAS builds to TestFlight and internal Play testing from Phase 5. No visual polish before the purchasing workflow works.

**Store-review risk, worth knowing now:** an app that logs into third-party retailer accounts attracts scrutiny under Apple's guideline 5.2.2 (third-party content and account access) and Google's equivalents. **Comparison-only reviews cleanly; credential-holding automation may not.** This is a further argument for deep links being the default path and automation an opt-in the family enables for its own accounts — a shape far more likely to pass review, and the one to design for from the start rather than discover at submission.

---

## AI usage

| Task | LLM? | Why |
|---|---|---|
| Parse "groceries for the weekend" | ✅ | Language is the job |
| Ask a good clarifying question | ✅ | Judgement, low stakes, human answers |
| Propose substitutions | ✅ propose | Proposals are ranked and filtered by deterministic policy |
| Explain a ranking | ✅ | Renders numbers it did not compute |
| Add prices, compute totals | ❌ | Arithmetic. Code. |
| Rank options | ❌ | The optimizer. Pure, tested. |
| Decide same vs equivalent vs substitute | ❌ decide | Attribute rules decide; the LLM may only propose candidates |
| Anything about stock, payment or transaction state | ❌ | Truth, not inference |

**Model:** Claude Sonnet 5 for interactive parsing and explanations; Haiku 4.5 for cheap classification. Prompts are versioned artefacts and every call is traced to its run.

---

## Observability

Structured events, not log lines. Every shopping run answers, from data:

`list.submitted` · `intent.parsed` · `product.resolved` (with source: memory | gtin | search | llm, and confidence) · `product.unresolved` · `quote.requested` / `quote.received` (per provider, with latency) · `option.generated` (with its cost breakdown) · `option.selected` · `substitution.offered` / `.accepted` / `.rejected` · `cart.prepared` · `cart.failed` · `memory.updated` · `run.completed` / `.abandoned`

Events are per household, stored in DynamoDB and archived to S3.

Two of these matter more than the rest: **`product.resolved` by source** is the direct measure of whether the household memory is earning its place, and **`run.abandoned`** is the honest signal that the product is not working — the one metric that should be allowed to stop the project.

---

## Multi-tenancy

- Household id lives in the **partition key** (`HOUSEHOLD#<id>`), so isolation is a property of the data model, not a `WHERE` clause someone can forget.
- Household id is derived from the **verified Cognito JWT**, never from a request body or path parameter.
- One data-access layer enforces it, with tests that deliberately attempt cross-household reads and must fail.
- Retailer credentials are per household, in Secrets Manager, with the household id in the secret path and the IAM policy.
- **Gate, non-negotiable:** no household outside our family gets cart automation — and therefore stores no retailer credentials — until there is a written privacy policy and an explicit consent flow. Comparison-only onboarding for other families is safe and carries none of this.

---

## Repository

```
/apps
  /mobile              Expo / React Native — iOS, Android, web
  /api                 Lambda handlers, thin
/services
  /shopping-agent      orchestration
  /product-resolver    the cascade
  /optimizer           pure functions, heavily tested
  /retailer-connectors QuoteProvider + CartConnector implementations
/packages
  /domain              entities, value objects — no I/O
  /shared              types, errors, tracing
/infrastructure
  /terraform
/docs
  /adr
```

TypeScript throughout: one language across mobile, API and domain, with `/packages/domain` shared verbatim between the app and the backend. Python appears only where `il-supermarket-scraper` runs, isolated in the ingestion job.

**Test policy — mandatory, per the brief:** product matching, basket arithmetic, the optimizer, promotions, delivery fees, travel calculations and retailer normalization all have unit tests over recorded fixtures. Every real SuperMCP response we cache becomes a regression fixture, which is why caching earns its place twice. Browser automation is tested only in isolated integration tests, never in CI.

---

## ADRs to write

1. Reuse SuperMCP rather than building a price engine
2. DynamoDB single-table over Aurora Serverless
3. Deterministic optimizer, LLM strictly outside arithmetic
4. Deep links as the default cart path; automation as an enhancement
5. Extract ideas from `israeli-grocery-saving-split`; do not fork
6. Expo/React Native over Flutter and over PWA-only
7. Cart automation hosted at home, never in AWS
8. Household as the tenant boundary, in the partition key
