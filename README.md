# Family Commerce Agent

A household purchasing agent for Israel. Grocery is domain #1.

**Status: Phase 0 (research) complete — recommendation is BUILD WITH REDUCED SCOPE. No application code yet.**

## The short version

Israel already has at least eight grocery price-comparison products, and a free MCP service that
resolves products across 16 chains, prices a whole basket per address, and knows every storefront's
verified delivery terms. Building another price engine would mean arriving ninth.

What no product in this market has: **memory of what a particular family actually buys**, an honest
**drive-vs-collect-vs-deliver** cost model, and **not having to re-type 60 items**. That is what this builds.

## Documents

| Document | What it answers |
|---|---|
| [`docs/product-landscape.md`](docs/product-landscape.md) | What exists, what doesn't, and the BUILD decision |
| [`docs/data-sources.md`](docs/data-sources.md) | Every data source, verified live |
| [`docs/retailer-integration-matrix.md`](docs/retailer-integration-matrix.md) | Per-retailer feasibility + review of `israeli-grocery-saving-split` |
| [`docs/mvp-proposal.md`](docs/mvp-proposal.md) | Journey, scope, AWS cost, risks, phase gates |
| [`docs/architecture-v0.md`](docs/architecture-v0.md) | Layers, domain model, connectors, mobile, multi-tenancy |

## Principles

- **LLMs interpret. Deterministic code decides.** Prices, totals and optimization are tested code, never prompts.
- **Reuse before build.** Rent the price layer; own the family layer.
- **Never complete a payment.** The agent prepares; a human checks out.
- **Cash cost and time cost are shown separately.** Time has no objective monetary value.

## Credits

- [`OpenIsraeliSupermarkets/israeli-supermarket-scarpers`](https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers) — 37 chain adapters for the statutory price feeds
- [SuperMCP](https://supermcp.web.app) — free canonical catalogue, delivery terms and basket pricing
- [`katzboaz/israeli-grocery-saving-split`](https://github.com/katzboaz/israeli-grocery-saving-split) (MIT) — household preference schema and hard-won retailer failure catalogue
