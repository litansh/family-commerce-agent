# Kaniti agents — the charter

Adopted from adtech-lab's fleet design (`docs/agent-fleet.md`, `portable-agents.md`,
`orchestrator.md` there), applied to a grocery app.

## The organising principle

**One agent per decision loop with its own feedback signal — not one per screen or
department.** An agent exists only if it has all four: an input it can read, a decision
it makes, a measurable outcome attributable to that decision, and a guardrail that can
veto it regardless of outcome.

Every agent starts at stage 0 on the ladder and earns its way up:

| Stage | Name | Kaniti meaning |
|---|---|---|
| 0 | Observe | reads, reports, changes nothing (the health checks, the briefing) |
| 1 | Recommend | proposes; a person or the app applies it (the compare screen's options) |
| 2 | Shadow | computes what it would do and logs it next to what happened (purchase confirmation's match, before it resolves anything) |
| 3 | Bounded act | acts inside hard limits with a way back (fills a cart, never checks out; re-connects, never signs in) |
| 4 | Act | full autonomy inside guardrails (the ops repair agents: fix, prove, open a pull request the owner merges) |

## The loops

| Agent | Decides | Owns (the number) | Vetoed by | Stage |
|---|---|---|---|---|
| **Coverage** | which stores and branches are offered for this address | stores offered per household; branches within 12 km | never offers a store that cannot deliver or be reached | 3 |
| **Resolver** | which product a line means, per store | lines resolved with a barcode; corrections per 100 lines | the family's own confirmation always wins ("this one") | 3 |
| **Optimizer** | cheapest / fastest / split / drive | cash saved vs the single-store baseline; coverage of the list | never sums cash and time; never offers below 90 % coverage | 1 |
| **Connection keeper** | whether a store is still connected, and when to ask for a re-connect | connected stores that stay connected across 30 days; false "needs re-connect" = 0 | three agreeing looks and the store's sign-in on screen; a challenge or block is never "out" | 3 |
| **Store link** | how the store's sign-in is reached and what is prefilled | first-try connect rate per store; false "connected" = 0 | never submits, never solves a challenge, never stores PII | 3 |
| **Order agent** | how the chosen option becomes the store's cart | lines added / lines chosen; time to a full cart | never checks out — payment is the store's | 3 |
| **Purchase confirmation** | whether the family actually bought, and what | carts confirmed from history / carts filled; unconfirmed after 48 h | a match needs half the lines on or after the cart's day; a "no" from the family beats any match | 2 → 3 |
| **Memory** | what to suggest and which brand to pick first | suggestions accepted; forgotten items caught | learns only from confirmed purchases, never from an abandoned cart | 3 |
| **In-store prices** | which branches to index and how often | branches priced per household; index age | a thin price file (< 500 barcodes) is never shown | 3 |
| **Ops orchestrator** | what is broken and which repair agent to send | checks green / checks run; hours from a store change to a fix | a repair pushes only after the same lab proves it; anything needing a person goes to NEEDS-HUMAN.md | 4 |
| **Shopper** | whether the whole product still works for a real family's week | checks green of 13; the cheapest total, the split saving, the substitutes named | never orders; a failing check goes to the repair agents, never to the family | 0 |
| **Store scout** | which storefronts exist for our addresses, which are new, which Kaniti cannot connect yet | storefronts connectable / storefronts delivering | never adds a store by itself; a mapping change is a pull request | 0 |
| **App designer** | how a screen serves the one decision it exists for | seconds to a decision; reports of confusion = 0 | never drops a promise-keeping element; design is approved before code | 1 |
| **Briefing** | the single next thing worth doing | the earliest broken funnel stage | never acts; sends every day; "could not look" is negative, never zero | 0 |

Conflicts are real and stay visible: the optimizer wants the cheapest split, the order
agent wants one cart; memory wants to learn fast, confirmation wants certainty. Merging
any pair would hide the trade-off. Integrity-type rules (no PII, no submitting logins,
no checkout) are not weighed against anything — they are not in the same units.

## Hot path and cold path

The family's phone is the hot path: it reads recipes, indexes and memory; it never
reasons. Reasoning lives in the cold path — the ops run on this Mac, the nightly
refresher, the repair agents — which produce recipes, indexes and fixes for the hot path
to apply. A store change is met by the cold path within a day, not by the phone at
checkout.

## The funnel the briefing watches

```
households → address set → a store connected → a compare run → a cart filled → a purchase confirmed
```

The briefing reports the earliest stage that is broken, and only that one; a stage it
could not observe stops the diagnosis there and says so.

## The daily run

`ops/repair.sh` at 06:40 (launchd `com.kaniti.ops`): checks → repair if red → briefing → store scout → review of open PRs → product review → the fleet (`ops/fleet.sh`, one agent at a time through the backlog). Everything ends in a pull request the owner merges; CI deploys and proves production after the merge. The owner is asked only for what a lab may not do: a real order, a locked account, a store account.
