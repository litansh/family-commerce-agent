# ADR 0004 — Extract ideas from israeli-grocery-saving-split; do not fork it

**Status:** accepted · 2026-09-05

## Context
`katzboaz/israeli-grocery-saving-split` (MIT) is the closest prior art. It is ~2,200 lines of
Markdown prompts for the Claude Code runtime, single-family, single-machine, depending on a paid
MCP and an unofficial WhatsApp protocol bridge.

## Decision
Extract ideas. Do not fork or vendor the code.

**Taken:** the preference-store schema (canonical name → confirmed GTIN, `order_count`,
`unit_hint`, seasonality), the suggestion-ranking algorithm, the write-on-success rule, the
invoice-bootstrap trick, the retailer endpoint documentation, and the failure catalogue.

**Left:** all code, WhatsApp, Salai, prompt-resident business logic, plaintext secrets in `/tmp`,
and the single-tenant architecture — which conflicts directly with the multi-household product now
in scope.

## Consequences
Credited in the README. Its failure catalogue saved real time: Shufersal's WAF rejecting its own
product names, and `בננה` resolving to banana-flavoured protein powder, are both now defended
against in code.
