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

Start here if you are catching up:

| Document | What it answers |
|---|---|
| [`docs/WHAT-WE-PROMISE.md`](docs/WHAT-WE-PROMISE.md) | **The nine promises to a family, and how to tell each is kept. This is the product** |
| [`docs/CONTEXT.md`](docs/CONTEXT.md) | The whole thing in one page: where every piece lives |
| [`CLAUDE.md`](CLAUDE.md) | The rules every contributor and agent works under |
| [`docs/AGENTS.md`](docs/AGENTS.md) · [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md) | The fleet: who decides what, how a report becomes an assignment |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | The worklist, split one file per agent under `docs/backlog/` |
| [`docs/adr/`](docs/adr/) | The decisions that shaped it, 0001 to 0011 |

Background, still true but written before the app existed:

| Document | What it answers |
|---|---|
| [`docs/product-landscape.md`](docs/product-landscape.md) | What exists, what doesn't, and the BUILD decision |
| [`docs/basket-economics.md`](docs/basket-economics.md) | **Measured savings at real family scale — ₪247/week** |
| [`docs/data-sources.md`](docs/data-sources.md) | Every data source, verified live |
| [`docs/retailer-integration-matrix.md`](docs/retailer-integration-matrix.md) | Per-retailer feasibility |
| [`docs/architecture-v0.md`](docs/architecture-v0.md) | Layers, domain model, connectors, mobile |

## Principles

- **LLMs interpret. Deterministic code decides.** Prices, totals and optimization are tested code, never prompts.
- **Reuse before build.** Rent the price layer; own the family layer.
- **Never complete a payment.** The agent prepares; a human checks out.
- **Cash cost and time cost are shown separately.** Time has no objective monetary value.

## What is built today

Kaniti is a phone app plus a small AWS backend. A family keeps one list; Kaniti prices it at every
store that delivers to their address, says which way to buy it is cheapest or fastest, fills that
store's own cart from the phone, and learns from what they actually bought.

| Piece | Where | What it does |
|---|---|---|
| Phone app | `apps/mobile` (Expo / React Native) | the list, the compare, connecting stores, filling carts, reading order history |
| API | `apps/api` (Lambda `fca-api`) | the compare, memory, sealed store sessions, in-store prices |
| Domain | `packages/domain` | the optimizer: cheapest, fastest, split, coverage. Pure, tested, no network |
| Connectors | `services/retailer-connectors` | the pricing provider, the chains' own catalogues, delivery windows |
| Branch prices | `services/branch-prices` | the chains' published price files, for "what if we drive there" |
| Ops and agents | `ops/`, `.claude/agents/` | the daily checks, the repair agents, the pull requests |

**The promises are the product**: `docs/WHAT-WE-PROMISE.md` lists nine, each with how to tell it is
kept. A broken promise is a bug even when every test passes.

**Two rules shape everything else.** Every store action has a ladder of independent flows, so one
failing hands over to the next ([ADR 0010](docs/adr/0010-every-flow-has-a-fallback.md)); and a
chain's own site is called from the person's device or the ops Mac, never from our servers, because
chains answer a data centre with a block page ([ADR 0011](docs/adr/0011-store-calls-run-on-the-device.md)).

## Running the app

Three ways to run the same app, for three different jobs.

### On your phone, through Expo Go — the everyday way

```bash
cd apps/mobile
npm run tunnel          # expo start --tunnel, serves on port 8081
```

Scan the QR code with the camera; Expo Go opens Kaniti. The tunnel means the phone does not have to
be on the same network. **This is the only way to test what a family actually meets**: stores are
used from the person's own device, in a WebView, as the person, so connecting a store and filling a
cart only work here and on a real device.

Leave it running. Edits reload on the phone in a second or two, so most of the day's work needs no
rebuild. The build stamp in the Me screen's header says which bundle the phone is running — check it
when something looks stale.

### On the iOS simulator — for the automated flows

```bash
cd apps/mobile
./maestro/run.sh                 # boots a simulator, builds once, runs the order flow
REBUILD=1 ./maestro/run.sh       # after a native change (a new package, an icon, a permission)
./maestro/connect-all.sh         # every store's connect flow, a screenshot each
```

The simulator needs a **development build**, not Expo Go: Kaniti stores sessions in the keychain, and
Expo Go cannot carry that entitlement. `run.sh` builds it with ad-hoc local signing, so no Apple
account is needed, and reuses the build until you pass `REBUILD=1`.

The simulator has **its own Metro on port 8082**, with the test family's sign-in baked in, so it
never disturbs the phone's tunnel on 8081. One rule, learned the hard way: **never start the
simulator's Metro with `CI=1`** — that turns off file watching and the simulator quietly runs a
stale bundle while you edit.

Flows live in `apps/mobile/maestro/*.yaml` and screenshots land in `maestro/shots/`.

### On the web — for a quick look at a screen

```bash
cd apps/mobile && npm run web
```

Fine for layout and copy. Stores cannot be connected here: a browser tab is not the person's phone.

## Checking it works

```bash
npm test                       # the unit tests: domain, services, API, app. No network
npm run typecheck
node ops/check.mjs             # every check against production, including the labs
node ops/check.mjs --only search,api,cart
```

`ops/check.mjs` is the honest one: it asks production for a real family's basket, drives the store
labs in a real browser, and prices real branches. It also reports each **ladder** (ADR 0010) and goes
red when one is down to a single working rung.

The labs it drives are worth knowing on their own:

| Lab | What it proves |
|---|---|
| `apps/mobile/e2e/cart-recipe-lab.mjs` | a store's cart recipe really fills that store's basket |
| `apps/mobile/e2e/store-health.mjs` | every store's sign-in page is reachable and the detector is honest |
| `apps/mobile/e2e/history-lab.mjs` | each store's order-history reader still maps its fields |
| `services/branch-prices/lab.mjs` | the chains' price files still parse, branch by branch |
| `ops/chaos.mjs` | the whole flow under abuse: typos, emoji, a barcode that exists nowhere, quantity 90 |

Nothing in any lab ever submits a login, creates an account, or completes a payment.

## The agents

Kaniti is worked on by a small fleet of agents, one per area, described in
[`docs/AGENTS.md`](docs/AGENTS.md) with the routing in
[`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md). Each has a charter in `.claude/agents/` and its own
worklist in `docs/backlog/<agent>.md`.

```bash
ops/lanes.sh                   # the fleet, two lanes side by side, each lane serial
FLEET_TASK="…" ops/fleet.sh api-fixer     # one agent on one job
ops/check.mjs && ops/repair.sh            # the daily run: check, repair, brief, then the fleet
ops/unblock.sh                            # merge main into any pull request that has drifted
```

Every change is a pull request, posted to the Kaniti Telegram channel for approval. Nobody pushes to
main, and nobody deploys from a laptop: a merge runs the tests, deploys the three Lambdas through a
GitHub OIDC role, and proves production with the shopper's carts.

## Setting up a new Mac

```bash
npm install
brew install watchman maestro openjdk          # simulator flows
npx playwright install webkit                  # the store labs
mkdir -p ~/.kaniti
printf 'KANITI_E2E_EMAIL=…\nKANITI_E2E_PASSWORD=…\n' > ~/.kaniti/e2e.env
printf 'TELEGRAM_BOT_TOKEN=…\nTELEGRAM_CHAT_ID=…\n' > ~/.kaniti/telegram.env
```

Both files stay out of git. AWS credentials are deliberately **not** needed: deploys and Terraform
run in CI through OIDC, and production logs are read with
`gh workflow run logs.yml -f minutes=30 -f pattern='"event":"quote"'`.

## The measuring instruments

```bash
npm run shop -- --list examples/weekly.json --address "your address, city"
npm run resolve -- --list examples/weekly-brands.json --address "…"
```

`shop` prices a real list and writes the whole run to `runs/`, which doubles as regression fixtures.
`resolve` shows, per line, what Kaniti would buy and what else the family could have, compared on
price per 100 ml or 100 g rather than sticker price. A line that names a brand always gets that
brand; cheaper rivals are shown, never swapped in.

### First measurement — 2026-09-05, 36-line basket, Ramat Gan

```
Option A — רמי לוי אונליין      items ₪800.30 + fee ₪35.90  =  ₪836.20   coverage 100%
Option B — ויקטורי אונליין      items ₪878.80 + fee ₪35.90  =  ₪914.70   coverage 92%
                                ⚠ not available: פמפרס, מגבונים לחים, שקיות זבל
```

That ₪247 spread on chain choice alone, about ₪12,800 a year, is why the product exists. A later
39-line run splits the basket across two stores for ₪838 against ₪980 at the best single store.

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

## Credits

- [`OpenIsraeliSupermarkets/israeli-supermarket-scarpers`](https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers) — 37 chain adapters for the statutory price feeds
- [SuperMCP](https://supermcp.web.app) — free canonical catalogue, delivery terms and basket pricing
- [`katzboaz/israeli-grocery-saving-split`](https://github.com/katzboaz/israeli-grocery-saving-split) (MIT) — household preference schema and hard-won retailer failure catalogue
