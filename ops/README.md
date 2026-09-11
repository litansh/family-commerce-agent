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
orchestrator re-runs the failed checks, commits, and pushes `origin main`. Pushing
is deploying for the phone app (Metro tunnel / OTA); the API deploys with
Terraform, which the person runs. Anything that needs a human (a locked account, a
portal behind a login, an expired AWS session) is written to `ops/NEEDS-HUMAN.md`.

`ops/install.sh` schedules `ops/repair.sh` every morning at 06:40 on this Mac
(launchd, `com.kaniti.ops`); `launchctl start com.kaniti.ops` runs it now. Logs:
`~/.kaniti/health/run-*.log`. A macOS notification says healthy / repaired / still unhealthy.

## What the phones report

Every store screen on a phone reports load errors, HTTP 4xx/5xx and Cloudflare
guards to the API (`import-history` log events with `diag`). `infrastructure/terraform/app/alarms.tf`
turns those into a CloudWatch alarm that e-mails the owner, so a store breaking for real
families is known the same hour, not the next morning.

## Deploying

CI deploys. A merge to `main` runs typecheck, unit tests, the recipe guard and the app typecheck; then builds the API, updates `fca-api`, `fca-branch-prices` and `fca-alerts` through the GitHub OIDC role (`fca-github-deploy`, in Terraform `ci.tf`), and proves production with `ops/api-health.mjs` and both shopper carts. The result is posted to the channel. Secrets in the repo: `KANITI_E2E_EMAIL`, `KANITI_E2E_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

## Terraform from GitHub

`.github/workflows/terraform.yml`: a pull request that touches `infrastructure/terraform/app/**` gets a plan as a PR comment; the merge to main applies it through the `fca-github-terraform` OIDC role, with the state in S3 (`fca-tfstate-<account>`, `backend.tf`). Secrets reach Terraform as `TF_VAR_*` from the repository secrets; non-secret variables live in committed `*.auto.tfvars`. One local apply created the bucket and the roles and migrated the state; after that no laptop needs AWS credentials for the stack. Infrastructure changes are pull requests like everything else.
