# ADR 0005 — Region is data on the household, not a code path

**Status:** accepted · 2026-09-05

## Context
The product started as an Israeli family tool and is now meant for any family anywhere. The
price layer is Israel-only today (a free, complete national feed); nowhere else has an equivalent.
The shared list, household memory and the forgetting check depend only on the household.

## Decision
A household carries an ISO country code. A `Region` record derived from it supplies currency,
locale, text direction, distance unit and whether pricing exists. The API resolves price providers
through a registry keyed by region; a region without providers still serves the list, memory and
suggestions, and answers priced requests with 422 and a plain message rather than an error.

The domain stays currency-agnostic: money is integer minor units everywhere, formatted at the edge.
The app reads language and direction from the region rather than hard-coding right-to-left.

## Consequences
- Adding a country is one registry entry plus a strings table — no domain change.
- Most of the product works globally on day one; only the comparison is gated, and says so.
- Israel remains the only region with real prices until a second provider exists. That is honest,
  and it keeps the price-comparison scope from expanding ahead of the data.
