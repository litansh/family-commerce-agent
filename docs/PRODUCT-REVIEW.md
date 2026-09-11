# Kaniti — product review and the agents that keep it working

Date: 2026-09-11. The promise: one list, the whole picture of what the family can buy and where, the cheapest way (one cart or a split) or the fastest, a memory that suggests after a few cycles, and a purchase that Kaniti knows really happened. Integration must be plug-and-play; once a store is connected it stays connected; when it cannot, the app says exactly what to do.

## The flow, agent by agent

| # | Agent | What it does | Where it lives | State today |
|---|---|---|---|---|
| 1 | **Coverage** | Which stores serve this address (online storefronts, Wolt venues, physical branches near home) | API `quote` (SuperMCP `list_delivery_options`), `services/branch-prices` refresher | Online + Wolt live; branches built, awaits `terraform apply` |
| 2 | **Resolver** | Each list line → the right product per store: memory first, then barcode, then search | API `resolve`, `@fca/memory-store` | Live |
| 3 | **Optimizer** | Every way to buy the list: one store, a split across two, pickup, drive; cash and time never summed; coupons applied | `@fca/domain` optimizer, API `quote` | Live; "fast" ranking uses Wolt's live ETA, chains count as windows |
| 4 | **Connection keeper** | Keeps each connected store's session warm from the phone, refreshes the sealed cloud copy, and turns a lapsed session into a guided 20-second re-connect instead of a silent drop | `apps/mobile/src/SessionKeeper.tsx`, `lib/linked.ts`, Me screen | Built today |
| 5 | **Store link** | The store's own sign-in inside Kaniti: OS autofill, SMS code, e-mail prefilled, sign-up form filled; Cloudflare challenges shown to the person untouched | `screens/StoreLink.tsx`, `lib/stores.ts` recipes | 9/9 stores verified in the simulator today |
| 6 | **Order agent (on device)** | Fills the store's cart from the chosen option, in the store's own site, one store at a time; deep links where no recipe exists | `screens/OrderOnDevice.tsx`, per-platform `cartJs` | Rami Levy verified live (guest and signed in); Shufersal/Hatzi Hinam recipes unverified; stor.ai and Wolt by deep links |
| 7 | **Purchase confirmation** | The store's own order history is read from the phone (at connect time and on every keep-alive visit): the memory learns from what was really bought, a cart Kaniti filled is confirmed by matching it to a store order (barcode or name, same day or later, most of the lines) with no tap, and the Orders tab lists the real purchases per store. The "did you buy?" card remains only as the fallback for a store whose history cannot be read | `lib/stores.ts` `historyJs` (Rami Levy, stor.ai chains, Wolt, Hatzi Hinam; Shufersal in StoreLink), `lib/pending.ts`, `SessionKeeper`, API `HISTORY#<store>` + `GET history` | Built today; Rami Levy / stor.ai / Hatzi Hinam recipes report the store's response shape to the log so the first real account tunes them |
| 8 | **Memory & suggestions** | What the family really buys, which brands, what they forgot | `@fca/memory-store`, API `suggest`, home aisles | Live |
| 9 | **In-store prices** | "And if we drive there?" from the chains' published price files | `services/branch-prices`, refresher Lambda | Built; needs `terraform apply` |
| 10 | **Ops orchestrator** | Daily: every check against the real stores from a residential network; on failure, repair sub-agents fix, prove with the labs, push | `ops/`, `.claude/agents/` | Built today; scheduled 06:40 on this Mac |
| 11 | **Phone signals** | Every store screen reports load errors, 4xx/5xx and Cloudflare guards; CloudWatch alarms e-mail the owner | API log + `alarms.tf` | Built; needs `terraform apply` |

## What is solid

- The compare screen: prices at every storefront that delivers, splits, coupons, Wolt live ETA, and now the in-store column.
- Connecting a store on the phone: nine stores reach their own sign-in, no false "connected", detector needs two agreeing looks, guest greetings and mid-transition pages no longer fool it.
- Rami Levy ordering end to end, verified with a real account.
- A simulator loop that is honest again (Metro watch mode was silently off for hours; fixed and documented).

## What is fragile or missing

1. **Cart recipes beyond Rami Levy.** Shufersal (account locked at the store, needs their customer service), Hatzi Hinam (recipe written, unverified), stor.ai chains and Wolt (deep links per item — works, but the person taps "add" per item). The store-recipe-fixer agent owns this; each needs a test account at the store.
2. **Order-history recipes need a first real account each.** Rami Levy, the stor.ai chains and Hatzi Hinam recipes were written from the stores' own web code (the endpoints are known); the exact field names of an order arrive in the API log from the first connected phone and may need one adjustment. Wolt and Shufersal were verified earlier.
3. **Delivery windows** for the chains (part 1 of the ETA work) — needs a saved address on the person's Rami Levy account, or Kaniti filling the store's address form.
4. **Victory / Mahsanei HaShuk in-store prices** — their portal is a postback form that answered "no files"; online prices are unaffected.
5. **Distribution:** the phone runs through Expo Go and a tunnel. TestFlight needs the Apple Developer Program (shamirlitan@gmail.com); Android after iOS.
6. **Cloudflare on the phone:** the challenge is now the person's to click; whether Victory serves a challenge or a flat block on a given network is Cloudflare's call — the guard reports either, the alarm counts them.

## Rules every agent follows

See `CLAUDE.md` at the repo root: the phone is the product, no PII, never submit a store login from a lab, prove with the labs before claiming, push to deploy the app, Terraform is the person's to apply.
