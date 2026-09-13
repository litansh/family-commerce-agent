# Needs the owner

## A full week's basket still fails to quote (docs/BACKLOG.md, api-fixer)
The urgent evidence (2026-09-13) had two parts. Search — `searchProducts('טופו')`/`('שוקולד')`
erring or taking 20-30s — is fixed and proven in PR api/search-fallback-ladder (a bounded retry on
the vendor's `internal_error`, Rami Levy's own catalogue as a second rung, per-line budgets in
`/resolve`). The second part — the 39-line shopper's `quoteBasket` call itself, not search — is
not fully fixed, and needs a judgment call before touching it further:

What was found: `optimize_delivery` for the 39-line week's basket answers `internal_error` after
44-57s (reproduced twice, from this Mac, against the live vendor); the first 20 lines fail this
way, the last 19 succeed in 46.8s. Our own client aborts every call at 22s, so in production we
never even see the vendor's real answer (success or error) - every attempt within the background
job's 110s budget dies to our own timeout, and the family gets `stores_slow` for a basket the
vendor might have priced if we had waited. Confirmed live both ways: the sync `/quote` route and
the phone's real async `/compares` job (the actual path the app uses) both end in `stores_slow` for
this exact basket.

Why this needs a person, not a mechanical fix: raising the provider's per-call timeout enough for
the vendor to answer (~50-60s) leaves very little slack under the API Lambda's 120s hard ceiling
(`infrastructure/terraform/app/main.tf`) for the rest of the compare (substitutes, images, coupons,
etas) - and if the Lambda itself gets killed mid-attempt, a compare is left `pending` forever
instead of a clean `stores_slow`, which is worse for the family, not better. Raising the Lambda's
own timeout is an infra change (`terraform.yml`'s plan-then-apply-on-merge), a cost/latency
tradeoff, not a code update. A bounded retry-on-`internal_error` is wired into `quoteBasket` now
(this PR) as a safe, no-regression step, in case some fraction of these are genuinely transient -
it does not by itself fix this specific reproduced basket, which failed the same way on retry.

Needs: a decision on the budget redesign (how much of the Lambda's 120s the quote gets vs. the
rest of the compare, whether the Lambda timeout itself should grow, and what a mid-job kill should
leave behind instead of a silent `pending`) before api-fixer touches the retry/timeout constants
again.

**Still a near miss even after this PR's image-clock fix**: product-qa's new `ops/test-cart.mjs`
check ("the compare itself answers well inside the gateway cutoff") caught the full 39-line shopper
cart's `/quote` call at 27.7s against the ~29s cutoff, 2026-09-13 — the image lookup no longer adds
its own 20s on top, but the rest of the pipeline alone is already this close for a real week's list.
This check now runs daily (`ops/check.mjs`'s `shopper`) and will go red the day this tips into
another outage; it does not fix the underlying budget question above.

## Victory / Mahsanei HaShuk / H. Cohen price files (docs/BACKLOG.md, price-portal-fixer)
The backlog line says laibcatalog.co.il's postback form "answered no files" for Victory and
Mahsanei HaShuk. A prior WIP already moved the reader off that form onto the site's newer JSON
API (`services/branch-prices/src/portals.ts`, `laibPortal`: `GET /webapi/api/getfiles?edi=<chainId>`),
which its own `/mshuk/index.html` page uses — but nobody had proven it against the live site before
that landed on main. It doesn't work either: `node --experimental-strip-types
services/branch-prices/lab.mjs` shows `victory branches 0`, `mahsanei-hashuk branches 0`,
`h-cohen branches 0`.

What price-portal-fixer checked (2026-09-13, from an Israeli residential IP, not a datacenter -
so this isn't the Hatzi Hinam-style block):
- The JSON API answers `200 []` for all three correct 13-digit chain IDs (confirmed correct: the
  front page's own `<select name="...chain">` lists exactly these three values, and browsing the
  chain's file folder directly 403s rather than 404s, so the folder exists). Any other ID, or the
  chain+sub-chain / chain+branch codes the same page also exposes, gets a `400 FilesRootPath is
  invalid` instead - so the endpoint is alive and the chain IDs are right; it just has nothing to
  list.
- The classic ASP.NET postback form (`__VIEWSTATE`/`__EVENTVALIDATION`, a real search submit) gives
  the same answer: an empty results table for all three chains, every file type, with the date
  field both defaulted to today and left blank.

Two independent routes into the same vendor, both saying nothing is published, is a vendor-side
gap: either the chains have stopped filing under this portal or it is mid-migration. Nothing in our
request is wrong, so there is nothing left to try from here.

Needs: someone to check laibcatalog.co.il's file listing for Victory or Mahsanei HaShuk in a real
browser (or wait a few days and re-run the lab, in case this is a migration in progress) and say
whether the files moved elsewhere. Until then this stays off; `laibPortal` fails soft (an empty
branch list, no crash), so it costs nothing to leave connected.

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
