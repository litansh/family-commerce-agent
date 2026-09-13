# ADR 0011 — A chain's own site is called from the person's device, never from our servers

**Status:** accepted (orchestrator, 13 September 2026, from measurements taken that night).

## Context
Kaniti reads the chains' own sites for the things only they know: which branch serves an address,
what that branch stocks, a product's picture, an order's history. Some of those calls were made from
the API Lambda. Production says they cannot be:

| Call | From this Mac | From the API Lambda (eu-central-1) |
|---|---|---|
| Rami Levy `/api/stores` | JSON in 183 ms | an HTML page — `branch-stock-skipped: Unexpected token '<'` |
| Rami Levy `/api/catalog` by name | products in ~200 ms | same shape of block (the by-name image source never answers) |
| the pricing provider, 3-line basket | under 1 s | 77 s, and `internal_error` in bursts |

Chains serve data centres differently from phones, and they are right to: a phone is a customer, a
data centre is a scraper. Kaniti's whole design already agrees with them (ADR 0008): the person's
own device, the person's own session, as the person.

## Decision
**No call to a chain's own site is made from the API or any Lambda.** Such a call runs in one of two
places, and its result is cached where everyone can read it:

1. **The person's device** — the phone, in the app or its WebView, as the person. This is the first
   choice for anything about *this* family: their branch, their basket, their order history, and a
   picture for a line they typed. The phone posts what it learned to the API, which keeps it for the
   household and for the next phone.
2. **The ops Mac** — for anything about *everyone*: branch lists, branch geocoding, price files,
   promotions. The nightly run writes them to the table or the bucket, and the API only reads.

The API may still call the pricing provider (it is an API, not a shop), with the politeness rules of
ADR 0010: bounded concurrency, a bounded retry, a per-line budget.

## Consequences
- The by-name image source moves from the API to the phone; the API's copy is a cache, not a fetcher.
- Branch stock: the phone reports the branch the store chose; the branch list and its geocoding move
  to the ops Mac, and the API reads the cached row (the refresher's own attempt is a Lambda and is
  therefore expected to fail — it must be treated as best-effort, never as the source of truth).
- Any new rung that reads a chain names in its pull request where it runs, and why that place can.
- A call that must come from a data centre needs an egress a chain does not treat as one; nothing
  in Kaniti needs that today, and adding one is a decision for the owner, not for an agent.
