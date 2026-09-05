# Retailer Integration Matrix

**Date:** 2026-09-05
**Status:** Phase 0

Feasibility per retailer, and the detailed review of `israeli-grocery-saving-split` that the brief asked for.

---

## Matrix

| Retailer | Price data | Product catalog | Live stock | Delivery fee | Delivery slots | Cart automation | Checkout feasibility | Auth complexity | MVP |
|---|---|---|---|---|---|---|---|---|---|
| **Rami Levy** | ✅ Cerberus hourly (verified) + **public unauth JSON API** | ✅ GS1 attrs, synonyms, branch availability | ⚠️ `available_in` branch array | ✅ SuperMCP verified, ₪35.90, no minimum | ⚠️ site only | ⚠️ session cart, undocumented | 🔴 not attempted | 🟡 email + password | ✅ **yes** |
| **Shufersal** | ✅ open Azure blobs, no auth (verified) | ✅ unauth search JSON, `P_` codes | ✅ **`stockLevelStatus`** — only live stock found | ✅ SuperMCP, no minimum | ⚠️ site only, auth'd | ✅ **wishlist API proven working** | 🟡 wishlist → cart is a native feature | 🟡 email + password, **WAF present** | ✅ **yes** |
| **Carrefour IL** | ✅ own portal | ✅ via SuperMCP | ❌ | ✅ ₪200 min, ₪15 pickup | ❌ | 🔴 unknown | 🔴 unknown | 🔴 unknown | ⚠️ price-only |
| **Yochananof** | ✅ Cerberus | ✅ via SuperMCP | ❌ | ✅ via SuperMCP | ❌ | 🟡 Prutah? unverified | 🔴 unknown | 🔴 **site 403'd all probes** | ❌ |
| **Victory** | ✅ Cerberus | ✅ via SuperMCP | ❌ | ✅ ₪250 min; also 6 Wolt fronts at ₪70 | ❌ | 🟡 Prutah? unverified | 🔴 unknown | 🔴 **site 403'd all probes** | ❌ |
| **Tiv Taam** | ✅ Cerberus | ✅ via SuperMCP | ❌ | ✅ ₪300 min | ❌ | 🔴 unknown | 🔴 unknown | 🔴 unknown | ❌ |
| **Keshet Teamim** | ✅ Cerberus | ✅ **documented Prutah REST API** | ⚠️ `branch.isActive` | ✅ ₪350 min | ❌ | ✅ **proven** — Angular `Cart.addLine` | 🟡 plausible | 🔴 **phone + SMS OTP — cannot be automated** | ❌ |
| **Hazi Hinam** | ✅ Cerberus | ✅ via SuperMCP | ❌ | ✅ ₪500 min | ❌ | 🔴 unknown | 🔴 unknown | 🔴 unknown | ❌ |
| **Osher Ad** | ✅ Cerberus | ✅ via SuperMCP | ❌ | ⚠️ | ❌ | 🔴 Next.js, unexplored | 🔴 unknown | 🔴 unknown | ❌ |
| **Machsanei Hashuk** | ✅ Cerberus | ✅ via SuperMCP | ❌ | ✅ via Wolt, ₪70 | ❌ | 🔴 | 🔴 | 🔴 | ❌ |
| **Quik / Yahalomim Bitan** | ✅ | ✅ via SuperMCP | ❌ | ✅ ₪200 min | ❌ | 🔴 | 🔴 | 🔴 | ❌ |
| **Wolt Market + Wolt fronts** | ✅ in scraper | ✅ via SuperMCP | ⚠️ Wolt is near-real-time | ✅ ₪70 min, 10 fronts at this address | ⚠️ on-demand | 🔴 no consumer API | 🔴 | 🔴 | ⚠️ price-only |
| **Super-Pharm / Good Pharm** | ✅ in scraper | ✅ | ❌ | ❌ | ❌ | 🔴 | 🔴 | 🔴 | ❌ out of domain |

✅ works / verified · ⚠️ partial · 🟡 plausible, cost known · 🔴 unknown or blocked

### Reading the matrix

**Price and delivery data is close to a solved problem for every chain in the country** — that column is almost entirely green, for free, because of the transparency law and SuperMCP. Coverage is not the constraint.

**Cart automation is the constraint.** Exactly two retailers have a proven working path, and both proofs come from one hobby project.

**Bot protection is real and already blocking us.** `keshet-teamim.co.il`, `victoryonline.co.il` and `yochananof.co.il` returned HTTP 403 or connection failure to plain HTTPS requests with a normal browser User-Agent. Any cart automation must run from a real browser, on residential egress — which means a machine at home, not a Lambda in `eu-central-1`. That is an architectural constraint, not a detail.

**SMS OTP is a hard stop.** Keshet cannot be automated end-to-end without a human reading a text message. Chains that use OTP are structurally unsuitable for an autonomous agent.

### MVP retailer choice: **Shufersal + Rami Levy**, and it is not close

Chosen on data accessibility, automation feasibility and household usefulness — not brand size.

- **Rami Levy** — the *only* retailer with a public unauthenticated JSON API carrying GS1 attributes, curated synonyms and branch availability. Verified working. No delivery minimum, ₪35.90 fee. Consistently the cheapest delivered total in every test basket run during this research.
- **Shufersal** — the *only* verified live-stock signal in the country, a fully open price portal with no login, the widest coverage, and the **only retailer with a native feature that turns a prepared list into a cart** (`wish-list-2-cart`). That single feature is why Shufersal is the right first execution target.

Every other chain still appears in **price comparison** through SuperMCP at zero integration cost. Two retailers for *execution*, sixteen for *comparison*.

---

## Cart automation: the three strategies, ranked

**1. Native list-import — preferred, and the reason Shufersal is first**

Shufersal's `/online/he/my-account/personal-area/wish-list-2-cart/{listId}` is a **product feature Shufersal built for its own users**: a saved list converts to a cart in one click. The agent populates a list; the human opens it, reviews, converts, and checks out.

This is the Instacart pattern arrived at independently, and it is strictly better than driving a cart:
- the human is structurally at the payment step — not by our discipline, but by the design of the flow
- it uses the retailer's own supported feature rather than fighting it
- `israeli-grocery-saving-split` confirms carts populated by automation **do not survive session close, while wishlists do**

**2. Deep links — the honest fallback, and it should ship in the MVP**

Rami Levy returns per-item deep links today: `https://www.rami-levy.co.il/he/online/search?item=7290004131074`. SuperMCP returns these in every priced line, for free, with no automation at all.

A list of deep links is not as good as a prepared cart. It is also unbreakable, ToS-clean, needs no stored credentials, and works on every retailer. **It must be the MVP's default, with automation as an enhancement** — otherwise a WAF change on a Tuesday leaves the family unable to shop.

**3. Full browser automation — last resort, home-hosted, human-approved**

Proven to work, and proven fragile. Requires: a real browser, residential egress, stored retailer credentials, and a human at checkout.

---

## Failure catalogue (from `israeli-grocery-saving-split`, hard-won)

Worth more than most of that repo's code, because each line is a week someone else already lost.

**Shufersal**
- WAF rejects ordinary product names — an apostrophe in `תפוצ'יפס` triggers `תווים לא חוקיים` (HTTP 426) on the auto-save retry. *A supermarket's WAF fires on its own product names.*
- Wishlist names containing `/` cause an HTTP 500.
- **Cart contents added by automation are lost on session close. Wishlists persist.**
- `document.cookie` is incomplete — httpOnly cookies (`JSESSIONID`, `XSRF-TOKEN`) must be exported from the browser for any curl-based call.
- Wishlist writes are CSRF-protected and must originate from a page context.
- Hebrew cannot be typed through the automation driver; values must be set via JS and an `input` event dispatched.

**Keshet / Prutah**
- SMS OTP cannot be automated.
- A delivery-options dialog blocks the first cart add and needs a human.
- Prices and availability are per-branch; the branch ID is baked into every URL.

**General**
- Free-text Hebrew resolution fails in ways that are expensive and quiet: `בננה` resolved to *banana-flavoured protein powder*. **A 3× price gap between chains for the same line is almost always a resolution error, not a bargain** — a cheap, high-value invariant to assert in our optimizer.
- Passing a GTIN instead of free text removes this class of bug entirely. **This is the strongest possible argument for the preference store**: its whole job is accumulating confirmed GTINs so the family's words stop being guessed at.

---

## Review: `katzboaz/israeli-grocery-saving-split`

MIT licensed · last commit 2026-04-27 · ~304 KB, of which ~2,200 lines are Markdown and the only executable code is `scripts/install.sh` and a ~50-line `poll.sh`.

### What it actually is

Not an application. **Two Claude Code skills** — `superme` (retailer automation) and `superme-order` (WhatsApp live session) — plus a scheduled polling task. The "code" is natural-language instructions to an LLM, embedded in Markdown.

### Architecture

```
WhatsApp (phones) ↔ whatsapp-bridge (Go, whatsmeow) → messages.db (SQLite)
                                                          ↓ Monitor polls every 8s
                                                    Claude Code + skills
                                        ├→ Salai MCP (HTTP) → price catalogues
                                        └→ browser-use → Shufersal + Keshet
```

Runs entirely on one always-awake Mac. All state in `~/.claude/` JSON files and `/tmp`.

### Data sources
Salai (paid MCP) for pricing. Direct browser/REST against Shufersal and Keshet for carts. No use of the transparency feed at all.

### Product matching
Delegated wholly to Salai's resolver, with a local `item_mappings` cache accumulating confirmed GTINs. The documentation is candid that free-text Hebrew resolution is the main source of error and that GTINs are the fix.

### Session / auth model
Shufersal: email + password typed into the page, cookies exported to `/tmp/superme_cookies.json` in plaintext. Keshet: phone + human-relayed SMS OTP, Bearer token to `/tmp/superme_keshet_token.txt` in plaintext. `superme close` deletes them. Credentials are passed as slash-command arguments.

### Weaknesses

1. **All logic lives in prompts.** Price arithmetic, the split decision and quantity handling are LLM instructions in Markdown. Nothing is unit-testable and nothing is deterministic — the exact failure mode the brief's §16 warns against.
2. **Plaintext secrets in `/tmp`.** Session cookies and Bearer tokens world-readable on a shared machine.
3. **WhatsApp bridge is an unofficial protocol reimplementation** carrying a real ban risk to a personal account, and requiring a machine that never sleeps.
4. **Two retailers**, both individually hand-coded to DOM and framework internals.
5. **No delivery-fee or travel modelling** — it splits on item price alone, which the `split_order` finding shows is often the wrong answer once a second delivery fee lands.
6. **Single-tenant by construction.** One group JID, one preference file, one machine.
7. **No tests, no CI.**

### Reusable code
Effectively none. It targets a different runtime, is prose not code, and its logic layer is the part we most need to be deterministic.

### Reusable ideas — substantial

1. **The preference-store schema.** `item_mappings` (canonical name → GTIN, `confirmed`, `order_count`, `last_ordered_at`, `unit_hint`), `default_quantities`, `global_defaults`, seasonality flags, and explicit *learning rules* stating which event writes which field. This is a real design and a genuine head start on our §7 model.
2. **Suggestion ranking** — `confirmed` → not seasonal → `order_count ≥ 2` → not already on today's list → top 5 per category, with automatic threshold relaxation on a cold start. Simple, deterministic, and directly implementable.
3. **"Only write on success."** An abandoned session writes nothing; `last_order_timestamp` advances only on a completed order. Prevents the memory poisoning that would otherwise accumulate.
4. **The bootstrap trick** — seed the preference store by extracting line items from past retailer invoices. Solves the cold-start problem that otherwise makes the first five weeks useless.
5. **The failure catalogue above.**
6. **Retailer internals** — Shufersal's wishlist endpoints and the Prutah API shape, documented from working code.

### Decision: **EXTRACT IDEAS ONLY — do not fork, do not reuse**

**Why not fork.** There is almost nothing to fork. It is a prompt library for a CLI runtime, aimed at a single family on a single always-on Mac, with a paid MCP dependency we have already decided against and a WhatsApp bridge we have already decided against. Forking would inherit its single-tenant shape — directly at odds with the multi-household, Google-sign-in product now in scope — and its prompt-resident business logic, which is exactly what our optimizer must not be.

**Why not ignore it.** Its preference schema is the best household-memory model found anywhere in this landscape, commercial products included, and its failure catalogue is real operational knowledge about Shufersal and Keshet that would otherwise cost weeks to rediscover.

**What we take:** the preference-store schema as the starting point for our domain model (re-expressed as typed, versioned, per-household records), the suggestion-ranking algorithm, the write-on-success rule, the invoice-bootstrap trick, the failure catalogue, and the retailer endpoint documentation.

**What we leave:** all of the code, WhatsApp, Salai, prompt-resident business logic, `/tmp` secrets, and the single-machine single-family architecture.

Credit it in our README. It is good work aimed at a different target.
