# Kaniti — shared rules for every agent in this repo

- The phone is the product: stores are used from the person's own device, in a WebView, as the person. No credentials or PII are stored by Kaniti; sessions live sealed in the API (ADR 0008).
- Never submit a store's login, send an SMS/e-mail, or create an account from a lab or a test. Labs abort non-GET requests.
- A Cloudflare challenge on a store is shown to the person untouched; nothing is injected while it is on screen.
- Before claiming a store works, prove it: `apps/mobile/e2e/store-health.mjs` (browser), `apps/mobile/maestro/connect-all.sh` (simulator). Before claiming prices work: `services/branch-prices/lab.mjs`.
- Simulator Metro (port 8082) never runs with `CI=1`; the build stamp in the Me header says which bundle is running.
- Commit as litansh on a branch and open a pull request with `ops/pr.sh` (it posts the PR to the Kaniti Telegram channel); the owner approves and merges. Never push to main, never merge. Deploy AWS with `AWS_PROFILE=personal-cfo` only (never the work account), after the PR is merged.
- Ops: `node ops/check.mjs` runs every check; `ops/repair.sh` runs the checks and, on failure, the repair sub-agents in `.claude/agents/`. Anything that needs a human goes to `ops/NEEDS-HUMAN.md`.
