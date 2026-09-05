# ADR 0002 — The optimizer is a pure function, and the LLM never does arithmetic

**Status:** accepted · 2026-09-05

## Context
The prior art in this space (`israeli-grocery-saving-split`) puts basket arithmetic and the split
decision inside an LLM prompt. It works until it silently doesn't, and no test can be written
against it.

## Decision
`optimize()` takes quotes and household constants and returns ranked options. No I/O, no network,
no clock, no LLM. Money is integer agorot end to end — never a float.

The LLM parses language, asks clarifying questions, proposes substitution candidates, and renders
explanations from numbers it did not compute.

## Consequences
- 20 unit tests today, including a purity test asserting identical output for identical input.
- A float-rounding bug (`1.005 * 100` is `100.49999…`) was caught by a test before it could lose an
  agora on a real basket.
- Every strategy carries an `explanation` object of raw numbers, so explainability is a data
  structure rather than a prompt instruction.
