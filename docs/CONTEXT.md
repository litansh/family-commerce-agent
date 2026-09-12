# Kaniti in one page — read this, then `node ops/find.mjs "<your question>"`

Kaniti (קניתי) is a family grocery app: one list, compared across every store that delivers to the
family's address (and the branches they could drive to), then bought at the stores' own sites from
the family's phone. The promises are `docs/WHAT-WE-PROMISE.md`; the rules are `CLAUDE.md`; the
worklist is `docs/BACKLOG.md`. Nothing else needs reading before you start.

## Where things are (read only the file your task names)
| Area | Files | Lab / proof |
|---|---|---|
| Phone app (Expo, RN) | `apps/mobile/src/screens/*.tsx` (Options = the compare, Home, Me, StoreLink, List), `src/ui.tsx` (tokens, `Button`, `Chip`, `Header`), `src/lib/i18n.ts` (every string, Hebrew + English), `src/lib/api.ts`, `src/lib/stores.ts` (per-store recipes: login, signed-in detector, cart, history), `src/SessionKeeper.tsx` (keeps sessions warm, reads history), `src/lib/pending.ts`, `src/lib/linked.ts` | `apps/mobile/e2e/store-health.mjs`, `apps/mobile/maestro/*.yaml` on the simulator (Metro 8082, never `CI=1`) |
| API (Lambda `fca-api`) | `apps/api/src/index.ts` (routes; the quote route builds the compare), `branches.ts` (in-store prices), `refresh.ts`, `alerts.ts`, `providers.ts` | `node ops/api-health.mjs`, `node ops/test-cart.mjs [--short]` |
| Domain (pure) | `packages/domain/src/optimizer.ts` (cheap / fast / split / partial legs / missing estimate), `size.ts`, `types.ts` | `npm test -w packages/domain` |
| Providers | `services/retailer-connectors/src/supermcp.ts` (SuperMCP quote and catalogue), `wolt-eta.ts`; `services/shopping-agent/src/{quote-with-fallback,substitutes}.ts` | unit tests next to each |
| Store sessions in the cloud | `services/cloud-connectors/src/*` (drivers, sealed sessions, history import) | `apps/api` tests |
| In-store prices | `services/branch-prices/src/{portals,xml,geo,cbs,index}.ts` | `node services/branch-prices/lab.mjs` |
| Infra | `infrastructure/terraform/app/*.tf` (Lambdas, table `fca-main`, alarms, CI roles); `.github/workflows/{ci,deploy,terraform,agents-review}.yml` | CI on every PR; deploy after merge |
| Ops | `ops/check.mjs` (all checks), `ops/repair.sh` (orchestrator), `ops/qa.sh`, `ops/pr.sh` (branch → PR → CI → Telegram), `ops/fleet.sh` (agents, one at a time), `ops/find.mjs` (retrieval) | `node ops/check.mjs --only <check>` |

## Facts that are not in the code
- Stores: Rami Levy (own site), stor.ai chains (Victory, Carrefour, Keshet, Mahsanei HaShuk, Tiv Taam), Wolt venues, Hatzi Hinam, Shufersal (owner's account locked at the store). Sessions live in the phone's WebView; the cloud keeps a sealed copy (ADR 0008).
- The compare answers in ~15–23 s; API Gateway cuts at 30 s; the provider call has 22 s, the whole quote 26 s, then `503 stores_slow`.
- Test family: `~/.kaniti/e2e.env`; Telegram: `~/.kaniti/telegram.env`; AWS: profile `personal-cfo`, region `eu-central-1`, only through CI for deploys.
- No Anthropic key exists anywhere; agents run on this Mac's Claude login. Usage is a budget: one agent at a time, cheap models for mechanical work, retrieval before reading, WIP committed as you go.

## How to work cheaply (this is a rule, not advice)
1. Read this page and your charter. Do not read transcripts, `node_modules`, screenshots you were not sent, or whole directories.
2. Ask `node ops/find.mjs "<words>"` and open only the files it names, only the ranges you need (`sed -n`).
3. After every proven step: `git add -A && git commit -m "WIP: <what>" && git push -u origin <branch>`. A stopped run must lose nothing.
4. One pull request per backlog line, through `ops/pr.sh`; the body names the line, the agent, and the proof.
