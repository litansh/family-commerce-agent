# MVP Proposal

**Date:** 2026-09-05
**Scope decision:** BUILD WITH REDUCED SCOPE
**Product shape:** multi-household from day one — Google sign-in, one household per family, our family is household #1

---

## The one-sentence MVP

> A household signs in with Google, keeps a shared shopping list, and gets three costed ways to buy it — delivered, collected, or driven to — with the household's own memory of what it actually buys, ending in a prepared cart the family checks out themselves.

Everything below the household layer is rented (see `data-sources.md`). We build the household layer, the total-cost decision, and the handoff to the retailer.

---

## Exact user journey

**Onboarding (once)**
1. Open the app → **Sign in with Google**.
2. Create a household, or accept an invite link to one. Household holds the address, the members, and all memory. Anything meaningful is owned by the household, not the person.
3. Set the household's constants: home address, ₪/km, whether time is valued and at what rate, "a second store must save at least ₪X", "driving must save at least ₪Y".
4. Optional cold start: upload past retailer invoices; we extract line items and seed the memory as `confirmed` mappings. Without this, the first three shops are noticeably worse.

**Weekly shop**
5. Any member adds to the shared list — typed, or in natural language ("we're out of milk and nappies").
6. **The forgetting check — the reason this product exists.** On open, the app surfaces what this household normally buys and has *not* added, ranked by how often they buy it and how overdue it is against its own consumption interval (milk every 4 days, nappies every 11, olive oil every 6 weeks). Before the shop is submitted it asks once more about anything conspicuously missing for a basket this size. The household's stated pain is forgetting an item and then paying makolet prices for it; this step is the fix.
7. **Resolve** — each line becomes a specific product. Lines the household has confirmed before resolve silently to a known GTIN. New or ambiguous lines are shown for one-tap confirmation, and that confirmation is remembered forever. *This step is the product.*
8. **Quote** — the resolved basket is priced across every storefront serving the address, plus the nearest physical branches of the household's preferred chains.
9. **Decide** — three or four costed options:
   - Best convenience — single retailer, delivered
   - Cheapest delivered — single retailer, lowest delivered total
   - Collect yourself — click-and-collect, with travel cost and time shown
   - Drive yourself — physical branch, with travel cost and time shown
   Options are ranked on delivered total **and coverage together** — a storefront pricing under ~95% of the list is not offered at all, however cheap it looks, because a partial basket causes the top-up trip we are trying to eliminate. Splitting is capped at two stores; a third delivery fee never paid for itself in testing.
   Each option shows **cash cost** and **time-inclusive cost as a separate figure**, never merged. Each carries a plain-language explanation of why it ranks where it does, generated from the optimizer's own numbers.
10. **Prepare** — the family picks an option. We hand over a prepared cart:
    - *Shufersal*: a populated wishlist, one tap from becoming a cart
    - *Rami Levy*: a deep-linked list, one item per tap
    - *everything else*: deep links
11. **Checkout is the human's, always.** We stop before payment. No exceptions in the MVP, and no plan to change it.
12. **Learn** — on a completed shop, and only then, the household's memory updates: confirmed mappings, quantities, retailer preference.

---

## Retailers

| Purpose | Retailers |
|---|---|
| **Comparison** | All 16 chains SuperMCP covers, free — Shufersal, Rami Levy, Victory, Carrefour, Yochananof, Osher Ad, Tiv Taam, Keshet, Machsanei Hashuk, Hazi Hinam, Stop Market, Quik, Wolt Market and Wolt-hosted fronts |
| **Cart preparation** | **Shufersal** (native wishlist) and **Rami Levy** (deep links) only |
| **Driving comparison** | Shufersal + Rami Levy branches near the household, from the transparency feed |

Two retailers for execution, sixteen for comparison. Rationale in `retailer-integration-matrix.md`.

---

## Technical scope

**In**
- Google sign-in (Cognito + Google IdP), households, invites, per-household data isolation
- Shared list with natural-language input
- Household memory: `ProductPreference`, `BrandPreference`, `SubstitutionPolicy`, `RetailerPreference`, `PriceSensitivity`, `ConveniencePreference` — typed, versioned, inspectable and editable in the UI
- `QuoteProvider` interface, with SuperMCP as its first implementation
- Branch-level price index for Shufersal + Rami Levy near the household, from the transparency feed
- **Deterministic total-cost optimizer** — pure, no I/O, no LLM, fully unit-tested
- Travel model: distance, round-trip time, ₪/km, optional parking, configurable value of time
- LLM for: list parsing, ambiguity questions, substitution suggestions, explanations. **Never for arithmetic.**
- Cart preparation: Shufersal wishlist + universal deep links
- Structured shopping-run events, queryable
- Mobile-first PWA
- Terraform for all infrastructure

**Deliberately out**
- Checkout, payment, and any irreversible action
- Retailers beyond Shufersal and Rami Levy for execution
- Native iOS/Android builds — PWA first, wrap later if the workflow proves itself
- WhatsApp
- Real-time stock guarantees — quotes are estimates and say so
- Pharmacy, pet, baby-specialist, electronics
- Our own national price database
- Recipes, meal planning, nutrition
- Visual polish beyond legibility

---

## AWS architecture

Personal AWS account, personal GitHub (`litansh`), `eu-central-1`. All Terraform.

```
Google ──► Cognito User Pool (Google IdP) ──► JWT
                                              │
PWA (S3 + CloudFront) ──► API Gateway (HTTP, JWT authorizer) ──► Lambda
                                                                  │
                          ┌───────────────────────────────────────┼──────────────┐
                          ▼                    ▼                  ▼              ▼
                     DynamoDB            Secrets Manager      SuperMCP      EventBridge
                (single table,           (retailer creds,      (MCP)        (nightly feed
                 PK = household)          per household)                      refresh)
                          │                                                      │
                          └──────────────── S3 (price snapshots, run events) ◄────┘
```

**Choices, and why — not because the services exist**

| Service | Why | Why not the alternative |
|---|---|---|
| **Cognito + Google IdP** | Multi-tenant sign-in is now in scope. Google federation is a checkbox; 50k MAU free | Rolling our own auth for a product handling retailer credentials is indefensible |
| **API Gateway HTTP API** | ~⅓ the cost of REST API; native JWT authorizer validates Cognito tokens with no code | ALB idles at ~$16/mo doing nothing |
| **Lambda** | Household shopping is bursty — a few runs a week. Idle cost is genuinely zero | Fargate costs ~$15–30/mo to sit still |
| **DynamoDB on-demand, single table** | Access is always "everything for household X". PK `HOUSEHOLD#<id>` gives tenant isolation in the key design, not in application logic. Zero idle cost | Aurora Serverless v2 has a ~$43/mo floor at 0.5 ACU — the single largest avoidable cost here |
| **S3 + CloudFront** | Static PWA. Pennies | Amplify Hosting adds a bill for a build pipeline GitHub Actions already does |
| **Secrets Manager** | Retailer credentials, per household, encrypted, IAM-scoped, audited. $0.40/secret/mo | SSM Parameter Store is cheaper but weaker on rotation and audit for real credentials |
| **EventBridge Scheduler** | One nightly job to refresh branch prices. Free at this volume | Step Functions is unnecessary until checkout orchestration exists |
| **CloudWatch** | Logs + a handful of alarms | — |
| **Not used:** Step Functions, ECS, Aurora, OpenSearch, AppSync | No current need. Revisit only when something specific demands it | |

**Cart automation runs at home, not in AWS.** Retailer sites returned HTTP 403 to datacenter egress during research. A small worker on a home machine handles browser sessions and receives work over a queue. AWS never holds a browser session and never sees a retailer password in transit beyond the encrypted secret.

### Estimated monthly cost

| Item | Assumption | Cost |
|---|---|---|
| Lambda | ~50k invocations, 512 MB | **$0** (free tier) |
| API Gateway HTTP | ~100k requests | ~$0.10 |
| DynamoDB on-demand | < 1 GB, low traffic | ~$0.30 |
| S3 + CloudFront | ~2 GB, ~5 GB egress | ~$0.60 |
| Cognito | < 50k MAU | **$0** |
| Secrets Manager | 4 secrets | ~$1.60 |
| CloudWatch | logs + alarms | ~$1.50 |
| EventBridge | 30 invocations/mo | **$0** |
| Route53 + ACM | 1 hosted zone | ~$0.50 |
| **Total** | | **≈ $5/month** |

Comfortably inside the $50 target, an order of magnitude under the $100 ceiling. Headroom is deliberate: it is what pays for scaling to other households, and for the fallback price index (~$15–25/mo) if SuperMCP disappears.

**What would break this budget, and the guardrails**
- Aurora Serverless instead of DynamoDB → +$43/mo. *Guardrail: no relational database until there is a query DynamoDB genuinely cannot serve.*
- Fargate for the API → +$15–30/mo. *Guardrail: Lambda until cold starts are a measured complaint, not an imagined one.*
- Ingesting the full national feed → +$15–25/mo. *Guardrail: index only branches near active households.*
- A budget alarm at $25/mo, and a hard billing alarm at $75.

---

## Key technical risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **SuperMCP is free, unversioned, no ToS, no SLA — and load-bearing** | 🔴 High | `QuoteProvider` seam; cache every response; daily CI health-check on a fixed basket; costed 2–3 week fallback to our own index (loses delivery terms) |
| 2 | **Product resolution silently wrong** — `בננה` → banana protein powder | 🔴 High | Never trust free text once a GTIN is known; assert a 3× cross-chain price gap as a resolution error, not a bargain; every new line confirmed once by a human, then remembered |
| 3 | **Cart automation breaks** — WAF fires on ordinary product names | 🟠 Med-High | Deep links are the default path and always work; wishlist automation is an enhancement that may fail without blocking the shop |
| 4 | **Bot protection blocks us** — three chains already 403'd | 🟠 Med | Automation runs at home on residential egress; AWS never drives a browser |
| 5 | **Stock is unknowable** — the feed has none | 🟠 Med | Present every total as an estimate; verify at cart build; never promise a price |
| 6 | **Multi-tenant data leak** | 🟠 Med | Household id in the partition key, derived from the JWT and never from the request body; enforced in one data-access layer with tests that attempt cross-household reads |
| 7 | Transparency feed schema drift | 🟡 Low | `il-supermarket-scraper` absorbs it; pin and upgrade deliberately |
| 8 | Hebrew/RTL correctness | 🟡 Low | RTL-first from the first screen, not retrofitted |

---

## Legal / ToS risks

| Activity | Standing |
|---|---|
| **Consuming transparency feeds** | ✅ **Clean.** Statutory public data, published under regulation for exactly this purpose. |
| **Rami Levy's public JSON API** | 🟡 Undocumented but unauthenticated and public. Low volume, cached, one household's traffic. |
| **Calling SuperMCP** | 🟡 No published terms. Cache aggressively, never poll, stay at plausible household volume. |
| **Automating a retailer account with the account holder's own credentials** | 🟠 **Almost certainly breaches the retailer's ToS.** Not a criminal matter in Israel — the Computer Law (1995) targets *unauthorised* access, and a family logging into its own account with its own password is authorised — but it is a contract breach whose realistic worst case is account suspension. Documented, accepted for a private family app, and re-evaluated before any other household is onboarded. |
| **Redistributing retailer catalogue data** | 🔴 Do not. Household-scoped use only. No public price API, no dataset publication. |
| **Storing other families' retailer credentials** | 🔴 The real threshold. Once household #2 exists we hold third-party retailer credentials, and this stops being a private project. **Gate: no non-family household gets cart automation until there is a written privacy policy, per-household encryption, and an explicit consent flow.** Comparison-only for other households is fine and carries none of this. |

---

## Security

- No credentials in Git, ever. Secrets Manager only, per household, per retailer.
- **No payment data. Ever.** The retailer keeps the card. We never see, store or transmit one.
- Least-privilege IAM per Lambda; no wildcard resource ARNs.
- Encryption at rest (DynamoDB, S3, Secrets Manager) and TLS in transit throughout.
- **Household isolation is a key-design property, not a query filter.** Household id comes from the verified JWT, never from a request body.
- Append-only audit log of every agent action, retained.
- Explicit human approval before any cart is prepared, and the human always completes payment.
- Browser sessions live only on the home worker, never in AWS, never in `/tmp` in plaintext — the mistake `israeli-grocery-saving-split` makes.
- Retailer credentials are optional per household. Comparison works fully without them.

---

## Phases and acceptance criteria

No phase passes because code exists. Each needs a demonstration.

**Phase 0 — Research** ✅ complete. *Accepted:* every data source verified live; BUILD WITH REDUCED SCOPE recommended on evidence.

**Phase 1 — Prove the rented layer** *(2 weeks, mostly measurement)*
Log the family's real weekly list; run it through SuperMCP; record every resolution error a human had to fix.
> **Accept when:** 3 real family lists have been run and ≥ 85% of lines resolved to the product the family meant, with every error catalogued. **If below 70%, the reduced scope is wrong — stop and re-plan.** This is a real gate.
> **Also baseline here, and it is the project's headline metric:** the **forgotten-item rate** — how many items per week the family buys on an unplanned top-up trip. Everything in Phase 2 is judged against this number.

**Phase 2 — Household + memory**
Cognito/Google sign-in, households, invites, the preference model, invoice bootstrap.
> **Accept when:** two members of household #1 sign in with Google, both edit one list, and the household's memory resolves a repeat line to a confirmed GTIN with no human input. A second household created in a test cannot read household #1's data — proven by an automated test that tries.

**Phase 3 — Optimizer**
Deterministic total-cost engine; travel model; explanations.
> **Accept when:** the optimizer is a pure function with ≥ 90% branch coverage; delivery, pickup and drive-yourself are compared on one honest axis; **cash cost and time-inclusive cost never appear merged in any output**; and a hand-worked basket matches the engine to the agora.

**Phase 4 — Real shop, deep links**
End-to-end on the household's actual weekly shop, ending in deep links.
> **Accept when:** the family does its **real** weekly shop through the app three weeks running, reports it took less effort than their current method, **and the forgotten-item rate has at least halved against the Phase 1 baseline.** If they quietly revert to the Shufersal app, that is the answer.

**Phase 5 — Cart preparation**
Shufersal wishlist automation on the home worker.
> **Accept when:** a 40-line list becomes a populated Shufersal wishlist, verified server-side, in 3 of 3 attempts — and when it fails, the app falls back to deep links without the family noticing.

**Phase 6 — Mobile polish, second household**
> **Accept when:** a family outside ours completes a shop unaided, on comparison only, under a written privacy policy.

**Phase 7 — Checkout automation**
> Not planned. Reconsider only if Phases 4–6 prove the workflow, and only ever with an explicit per-order human approval that cannot be defaulted on.

---

## First implementation step

**Not code — measurement.** Run the family's real list through SuperMCP for two weeks and record what it gets wrong. It costs nothing, produces the Phase 1 gate evidence, and seeds the preference store with confirmed mappings. If SuperMCP resolves a real family's real Hebrew list well, this whole plan holds. If it does not, we learn it in two weeks rather than three months.
