# Needs the owner

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
