# Needs the owner

## Automatic confirmation — a real order at Rami Levy (docs/BACKLOG.md, product-qa)
The backlog line asks for "verified end to end on a real order at Rami Levy": a cart Kaniti fills
on the phone, checked out by the family, then auto-confirmed from Rami Levy's own order history
with no tap. product-qa cannot do this itself — CLAUDE.md and its charter forbid ordering or
submitting a store login from a lab or a test.

What product-qa did instead: the matcher behind this (`apps/mobile/src/lib/pending.ts`,
`confirmFromHistory`/`sameProduct`) had zero test coverage anywhere, including the real substitution
that once broke the *memory* side of this (`packages/domain/test/memory.test.ts`: a confirmed Tnuva
bag delivered as a Yotvata carton). Added `apps/mobile/test/pending.test.ts`, wired into `npm test`,
covering that same substitution plus the day-boundary and per-store isolation rules. All pass.

What is still open: whether it fires for real, on a real phone, against Rami Levy's actual order
history response shape (`www-api.rami-levy.co.il/api/v3/site/orders`) — the field names in
`historyJs` (apps/mobile/src/lib/stores.ts) are the best reading of the site's bundle, unconfirmed
against a live order. Needs: the owner (or a phone connected as the test family) to place one real
order through Kaniti at Rami Levy and check the Orders tab confirms it without a tap. If the field
names are off, the phone's `diag` in the `history:` postMessage (posted to the API log) says exactly
how.
