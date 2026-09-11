# Kaniti — shared rules for every agent in this repo

- **Every decision goes through the agent that owns it; the orchestrator routes and, when two agents disagree, decides.** How something is presented → app-designer (a design proposal before code). Whether a promise holds → product-qa. A store's site → store-recipe-fixer. Price files → price-portal-fixer. Simulator flows → sim-flow-fixer. API, tests, rules → api-fixer. Nobody, the owner's assistant included, hand-fixes what an agent owns without recording the decision in the PR body (which agent, what was weighed, why). A change is a pull request; the agents review it before a person does.
- The product is `docs/WHAT-WE-PROMISE.md`: eight promises to a family, each with how to tell it is kept. A broken promise is a bug even when every test passes; never weaken a promise to make a check pass.

- The phone is the product: stores are used from the person's own device, in a WebView, as the person. No credentials or PII are stored by Kaniti; sessions live sealed in the API (ADR 0008).
- Never submit a store's login, send an SMS/e-mail, or create an account from a lab or a test. Labs abort non-GET requests.
- A Cloudflare challenge on a store is shown to the person untouched; nothing is injected while it is on screen.
- Before claiming a store works, prove it: `apps/mobile/e2e/store-health.mjs` (browser), `apps/mobile/maestro/connect-all.sh` (simulator). Before claiming prices work: `services/branch-prices/lab.mjs`.
- Simulator Metro (port 8082) never runs with `CI=1`; the build stamp in the Me header says which bundle is running.
- Commit as litansh on a branch and open a pull request with `ops/pr.sh` (it posts the PR to the Kaniti Telegram channel); the owner approves and merges. Never push to main, never merge. Deploying is CI's job: a merge to main runs the tests, deploys the three Lambdas through the GitHub OIDC role, and proves production with the shopper carts (`.github/workflows/ci.yml`). Infrastructure changes are still `terraform apply` with `AWS_PROFILE=personal-cfo` (never the work account).
- Ops: `node ops/check.mjs` runs every check; `ops/repair.sh` runs the checks and, on failure, the repair sub-agents in `.claude/agents/`. Anything that needs a human goes to `ops/NEEDS-HUMAN.md`.
