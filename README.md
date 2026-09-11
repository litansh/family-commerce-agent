# Family Commerce Agent

A household purchasing agent for Israel. Grocery is domain #1.

**Status: live.** Kaniti (קניתי) — web at https://d3lykvs28o7qrc.cloudfront.net · backend on AWS (Cognito, DynamoDB, Lambda, API Gateway) · Expo app for iOS/Android (EAS config in `apps/mobile`). Phases 0–4 done; store connection ladder (ADR 0008) built; Phase 5 (prepared carts) next.

## The short version

Israel already has at least eight grocery price-comparison products, and a free MCP service that
resolves products across 16 chains, prices a whole basket per address, and knows every storefront's
verified delivery terms. Building another price engine would mean arriving ninth.

What no product in this market has: **memory of what a particular family actually buys** — so the shop is
complete and nobody pays makolet prices for the thing they forgot — and **not having to re-type 40 items**.

Measured on this household's real 36-line weekly basket: the same list costs **₪836 at Rami Levy and ₪1,083
at Shufersal** — a ₪247 spread, ~₪12,800/year, on chain choice alone.

## Documents

| Document | What it answers |
|---|---|
| [`docs/product-landscape.md`](docs/product-landscape.md) | What exists, what doesn't, and the BUILD decision |
| [`docs/basket-economics.md`](docs/basket-economics.md) | **Measured savings at real family scale — ₪247/week chain spread** |
| [`docs/data-sources.md`](docs/data-sources.md) | Every data source, verified live |
| [`docs/retailer-integration-matrix.md`](docs/retailer-integration-matrix.md) | Per-retailer feasibility + review of `israeli-grocery-saving-split` |
| [`docs/mvp-proposal.md`](docs/mvp-proposal.md) | Journey, scope, AWS cost, risks, phase gates |
| [`docs/architecture-v0.md`](docs/architecture-v0.md) | Layers, domain model, connectors, mobile, multi-tenancy |

## Principles

- **LLMs interpret. Deterministic code decides.** Prices, totals and optimization are tested code, never prompts.
- **Reuse before build.** Rent the price layer; own the family layer.
- **Never complete a payment.** The agent prepares; a human checks out.
- **Cash cost and time cost are shown separately.** Time has no objective monetary value.

## Onboarding: learn from where you already shop

Setup asks where the family usually orders and whether they prefer delivery, pickup or whichever
is cheaper. Once a chain is linked (below), **Import past orders** has the worker read the account's
order history through the retailer's own account pages, resolve each product to a barcode, and
replay the orders into memory *dated* — so "your usuals" and purchase rhythms exist before the
first shop. Nothing imported is marked confirmed; the family still says "yes, that one" once.

## Connecting a store (ADR 0008)

Kaniti is three apps from one codebase — web, iOS, Android — and connecting a store is one
ladder on all of them. The first rung that works wins, and every rung ends in a session the
store issued, sealed in Kaniti's cloud. **Nothing a person types is kept**: no password, phone,
ID number or name.

| Rung | Where | What the person does |
|---|---|---|
| device | iOS / Android | The store's own login in a WebView; Face ID or Google fills the saved password, or the SMS code lands on the keyboard. The session is then sent to the cloud, so every device in the family sees the store as connected. **Nobody can block this rung** — on the phone Kaniti *is* the person's own browser on the person's own network. |
| cloud | none today | Built and tested, but from AWS every grocery store answers with a block page or a Cloudflare challenge (verified 2026-09-10), so the app offers no cloud sign-in. |
| create | all | "No account?" shows exactly what the store's sign-up asks for, with everything Kaniti knows ready to copy (or typed in for you on the phone), and opens the store's own page. |

On the web every store says "connect from your phone" in one line, and the connection shows up
on the web by itself once the phone has done it. The phone app is where the product lives.

### Connection groups (`apps/mobile/src/lib/stores.ts`)

Nine stores, five platforms. A store is a platform recipe plus its own facts; a fix to a platform
fixes every chain on it. Each recipe is syntax-checked (`npm run check:recipes -w @fca/mobile`) and
its sign-in detector is proven "not signed in" on the logged-out page, side menu open, by
`e2e/detector-lab.mjs` (9/9).

| Group | Stores | Sign in | Cart |
|---|---|---|---|
| stor.ai | Victory, Carrefour/Bitan, Keshet Teamim, Mahsanei HaShuk, Tiv Taam | side-menu login: SMS code (Victory) or password | per-item deep links |
| Rami Levy (Nuxt) | Rami Levy | e-mail → SMS/voice code | native recipe, **verified live** |
| Wolt | Wolt Market + the chains' Wolt storefronts | e-mail link / phone code | per-item deep links; live delivery minutes on compare |
| Shufersal (Hybris) | Shufersal | e-mail + password (Face ID) | native recipe |
| Hatzi Hinam (proxy) | Hatzi Hinam | e-mail-or-ID + password | native recipe |


```bash
npm test                                   # unit tests incl. the cloud drivers (fake fetch)
cd apps/mobile && npx expo export --platform web --output-dir dist && npx playwright test e2e/connect.spec.ts   # the web flow, API mocked
node --experimental-strip-types e2e/store-lab.mjs      # every store's phone login page in WebKit (the device rung)
node --experimental-strip-types e2e/login-api-lab.mjs  # what each store's page sends on sign-in — every non-GET aborted
```

The home-Mac worker below is now a fallback for ordering at stores the cloud cannot reach.

## Ordering through the home worker (fallback)

Retailers have no ordering API, so a small worker on the family's own Mac can do the retailer
work with the family's own session. It never stores a password: you sign in once in a window it
opens, the session is kept encrypted under `~/.kaniti` (or an existing `~/.kanili`), and reused
until the retailer expires it.

```bash
source ~/.kaniti/env                      # worker AWS profile + queue (written by Terraform apply)
export KANITI_HOUSEHOLD=<your household id>   # shown in the app header menu
npm run link  -w @fca/order-worker        # one-time: sign in to Shufersal in the window that opens
npm start     -w @fca/order-worker        # leave running; it waits for orders from the app
```

An order moves `queued → connecting → filling_cart → choosing_slot → awaiting_approval`, then
stops. The app shows the retailer's real total and one button. Only after **Approve** does the
worker place the order, with a token the API minted on approval. Every step leaves a screenshot
in `services/order-worker/trace/`.

## AWS spend guard

`infrastructure/terraform/bootstrap` puts a $50/month budget on the account with alerts at 50%, 80%,
forecasted-100% and actual-100%, plus an independent CloudWatch billing alarm. It is applied once, by hand,
before any product infrastructure exists:

```bash
cd infrastructure/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars   # set alert_email
AWS_PROFILE=personal-cfo terraform init && terraform apply
```

## Credits

- [`OpenIsraeliSupermarkets/israeli-supermarket-scarpers`](https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers) — 37 chain adapters for the statutory price feeds
- [SuperMCP](https://supermcp.web.app) — free canonical catalogue, delivery terms and basket pricing
- [`katzboaz/israeli-grocery-saving-split`](https://github.com/katzboaz/israeli-grocery-saving-split) (MIT) — household preference schema and hard-won retailer failure catalogue

## Running it

```bash
npm install
npm test          # 20 unit tests, no network
npm run shop -- --list examples/weekly.json --address "your address, city"
```

`npm run resolve -- --list examples/weekly-brands.json --address "…"` shows, per line, what we'd buy and what
else the family could have — compared on **price per 100ml/100g**, not sticker price. A line that names a brand
(`"brand": "תנובה"`) always gets that brand; cheaper rivals are shown, never swapped in.

`npm run shop` is the **Phase 1 measurement instrument**. It prices your real list, ranks the
options with our own optimizer, and writes the whole run to `runs/` — which is simultaneously the
resolution-accuracy evidence for the Phase 1 gate, a regression fixture, and the seed corpus for
the preference store.

### First measurement — 2026-09-05, 36-line basket, Ramat Gan

```
Option A — רמי לוי אונליין      items ₪800.30 + fee ₪35.90  =  ₪836.20   coverage 100%
Option B — ויקטורי אונליין      items ₪878.80 + fee ₪35.90  =  ₪914.70   coverage 92%
                                ⚠ not available: פמפרס, מגבונים לחים, שקיות זבל

RESOLUTION  27/36 acceptable (75%)  ·  gate 85%, floor 70%
            3 exact · 24 generic default · 9 suspect
```

**75% sits between the floor and the gate.** The reduced scope holds, and the preference store is
necessary rather than optional: without confirmed barcodes, a quarter of the list is guessed.
Nine lines (`סלמון`, `חזה עוף`, `בננות`, …) vary 3–7× across chains, which the optimizer flags as
a probable resolution error rather than a bargain.
