# Backlog — everything the owner asked for, and where it stands

The orchestrator's worklist. Each line names the promise it serves (docs/WHAT-WE-PROMISE.md),
the agent that owns it, and its state. An agent picks a line, reproduces the gap in a lab,
fixes it, proves it, and opens a pull request that names the line. Done lines stay, struck.

## Reported by the owner, 13 September 2026 — the orchestrator's directive
Everything below was seen by the owner using the app on a real phone, or measured against the
provider from the ops Mac the same night. Each line names the agent that owns it. These come before
anything else in this file: they are what a family meets.

## Where the lines live

The worklist is split one file per agent, so two agents working at once never edit the same file:

| Agent | File |
|---|---|
| api-fixer | [docs/backlog/api-fixer.md](backlog/api-fixer.md) |
| store-recipe-fixer | [docs/backlog/store-recipe-fixer.md](backlog/store-recipe-fixer.md) |
| price-portal-fixer | [docs/backlog/price-portal-fixer.md](backlog/price-portal-fixer.md) |
| sim-flow-fixer | [docs/backlog/sim-flow-fixer.md](backlog/sim-flow-fixer.md) |
| product-qa | [docs/backlog/product-qa.md](backlog/product-qa.md) |
| app-designer | [docs/backlog/app-designer.md](backlog/app-designer.md) |
| nobody yet | [docs/backlog/unassigned.md](backlog/unassigned.md) |

An agent reads its own file and only writes there. A line that turns out to belong to someone else is
moved by the orchestrator, who also keeps this page and the promises in step.
