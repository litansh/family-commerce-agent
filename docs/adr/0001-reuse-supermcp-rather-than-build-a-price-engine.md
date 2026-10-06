# ADR 0001 — Reuse SuperMCP rather than build a price engine

**Status:** accepted · 2026-09-05

## Context
The brief proposed building a canonical product model, a price/availability engine and a
delivery-aware basket optimizer. Live testing found the first two already exist, free and
unauthenticated: SuperMCP resolves 16 chains under one GTIN, prices a 36-line basket per address,
and carries manually verified delivery terms with source URLs and dates.

Israel also has at least eight consumer price-comparison products already.

## Decision
Rent the price layer. Build the household layer. SuperMCP is the first `QuoteProvider`.

We do **not** use its `splitOrder` or its ranking — our optimizer owns those, so the household's
own constants apply and the logic stays testable.

## Consequences
- Weeks of ingestion and delivery-terms work avoided.
- A free, unversioned service with no ToS or SLA is load-bearing. Mitigated by the
  `QuoteProvider` seam, caching every response as a regression fixture, and a costed 2–3 week
  fallback to `il-supermarket-scraper` (which reaches price parity but not delivery-terms parity).
- If SuperMCP's resolution quality is poor on real family lists, this decision is wrong. That is
  what the Phase 1 gate measures.
