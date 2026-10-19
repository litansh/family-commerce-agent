# Kaniti ops — the bots that keep the stores working

Stores change without notice: a new consent sheet, an advertisement layer, a
Cloudflare challenge, a moved login, a renamed price file. The product has to
stay on top of them without a person noticing. This directory is that loop.

## What runs

| Check | What it proves | Where |
|---|---|---|
| `recipes` | every store recipe string still parses | node |
| `unit` | every package's tests | node |
| `stores` | each of the 9 stores: page loads, no Cloudflare block/challenge, its own sign-in on screen, the detector says logged-out, the sign-up filler finds fields | WebKit, iPhone emulation, this network |
| `cart` | Rami Levy's guest cart recipe adds real lines | WebKit |
| `history` | every store's order-history recipe posts, logged out; field mapping matches a mocked order shaped as that store's own API ships it | WebKit |
| `prices` | the price-transparency portals answer and price a basket at nearby branches | node, portals |
| `api` | sign in as the test family, get a quote with options (and the in-store view) | the live API |
| `sim` (`--sim`) | the iOS simulator connect flow for all 9 stores and the order flow | Xcode simulator + Maestro |

`node ops/check.mjs [--sim] [--only a,b]` runs them (browser checks in parallel), prints a table and writes `~/.kaniti/health/latest.json`.

## What repairs

`ops/repair.sh` runs the checks and, when something is red, starts a headless
Claude Code run (`claude -p`) as the orchestrator. It dispatches the sub-agents in
`.claude/agents/`:

- `store-recipe-fixer` — a store changed its site (login, consent, detector, cart)
- `price-portal-fixer` — a chain changed its price portal
- `sim-flow-fixer` — a simulator flow went red (geometry, stale bundle, a screen)
- `api-fixer` — API, tests, recipe guard

Each agent must reproduce in the labs, fix, and prove it with the same labs; the
orchestrator re-runs the failed checks, commits, and opens a pull request. Anything
that needs a human (a locked account, a portal behind a login) is written to
`ops/NEEDS-HUMAN.md`.

The daily launchd job (`com.kaniti.ops`, `ops/install.sh`) is gone with the retirement
(ADR 0012): there is no production to repair. `ops/repair.sh` still runs by hand for the
labs. Logs: `~/.kaniti/health/run-*.log`.

## What the phones report

Every store screen on a phone reported load errors, HTTP 4xx/5xx and Cloudflare
guards to the API (`import-history` log events with `diag`); `alarms.tf` turned those into a
CloudWatch alarm that e-mailed the owner the same hour. The API, the alarm and the Lambda behind
it are torn down (ADR 0012); the phone code still sends the reports, to an endpoint that no
longer answers.

## Deploying

Nothing deploys any more (ADR 0012). While the stack was live, a merge to `main` ran typecheck, unit tests, the recipe guard and the app typecheck, built the API, updated `fca-api`, `fca-branch-prices` and `fca-alerts` through the `fca-github-deploy` OIDC role (`deploy.yml`) and proved production with `ops/api-health.mjs` and both shopper carts; `npm run deploy:web` synced the web build to the bucket. `deploy.yml`, `logs.yml`, the deploy role and the `deploy:web` script are gone. A merge to `main` runs `ci.yml` (tests) only.

## Terraform from GitHub

`.github/workflows/terraform.yml`: a pull request that touches `infrastructure/terraform/app/**` gets a plan as a PR comment; the merge to main applies it through the `fca-github-terraform` OIDC role, with the state in S3 (`fca-tfstate-437075214009`, `backend.tf`). After the teardown (ADR 0012) the stack holds only that role and its policy; the next pull request forgets them and the owner deletes them by hand, after which the workflow itself goes. No laptop needs AWS credentials for any of this. Infrastructure changes are pull requests like everything else. Every plan, on the PR and again right before the apply, goes through `ops/plan-guard.mjs`: a destroy or forget must be named in `ops/plan-guard.allow` (`destroy <address>` / `forget <address>`), the shared OIDC provider and the state bucket are never destroyed, and the apply applies that guarded plan file, not a fresh one (ADR 0012).
## Agents on every pull request

`.github/workflows/agents-review.yml`: the product-qa agent reviews each PR against the promises with the diff and the tests it can run on Linux, and posts one review comment. The key is the repository secret `ANTHROPIC_API_KEY`; without it the review skips with a notice. The SSM path (`/fca/anthropic-key` through the `fca-github-review` role, `ops/secrets.sh`) went with the AWS stack (ADR 0012). Add `[skip-agents]` to a PR title to skip it (docs-only PRs).

## Who decides

Every decision goes through the agent that owns it: presentation → app-designer, promises → product-qa, stores → store-recipe-fixer, price files → price-portal-fixer, simulator → sim-flow-fixer, API and rules → api-fixer. The orchestrator routes and, when agents disagree, decides; the decision is written into the PR body.

## A red check never reaches the owner

`ops/pr.sh` opens the PR, then watches its checks. A red check is handed to the api-fixer agent on the same branch (the failing log verbatim, the workflow's own commands to reproduce), pushed, and watched again, up to three times. The Telegram post carries the final state; a PR is announced for approval only once its checks are green.

## The backlog

`docs/BACKLOG.md` is the orchestrator's worklist: every ask the owner made, the promise it serves, the owning agent, its state. One PR per line. `ops/pr-review.sh <n>` reviews a PR from this Mac with the local login (no key in GitHub needed); `ops/pr.sh` calls it after opening a PR and the daily run covers any open PR without a review.
