# Needs the owner

## The ops Mac's AWS session (personal-cfo) has expired, so מבצעים has had no second rung (2026-10-04)
`services/branch-prices/refresh-deals.mjs` read 480 named deals across 8 chains from the chains' own
files this morning and then failed to write them: `CredentialsProviderError: Your session has
expired` (same for `aws logs`). CATALOG#PROMOS_FILES has a two-day TTL, and the script ran only on a
green day (none since 2026-09-12; fixed on branch `ops/2026-10-03-api-500-503`, it now runs every
day before the checks). Meanwhile the provider's own `get_promotions` returns 200 of 200 from Wolt
Market (checked 03:58Z, with and without a city), so /deals shows one chain. Needs: the owner to sign
in again on the ops Mac (`aws login --profile personal-cfo`) and run
`AWS_PROFILE=personal-cfo node --experimental-strip-types services/branch-prices/refresh-deals.mjs`
once; the deals check goes green as soon as it writes. **Still true on 2026-10-05**: `aws sts
get-caller-identity` answers "Your session has expired", and /deals still shows 33 deals across 2
chains (וולט מרקט, טיב טעם) when called alone, so this is the session, not load. A credential that does not expire every few
hours for this one DynamoDB write (a narrowly scoped role for the ops Mac) is an infrastructure
decision for the owner, not something an agent should create.


## The AWS account's Lambda concurrency limit is 10 (docs/backlog/api-fixer.md, 2026-10-03)
`aws lambda get-account-settings` reports `ConcurrentExecutions: 10` (a new account's default; the
usual limit is 1000). During the 03:42Z health run fca-api peaked at 10 concurrent and was
**throttled 4 times** (CloudWatch `Throttles`, 03:40–03:45Z), while `ops/check.mjs` ran shopper,
topup, chaos, search and deals in parallel and each compare holds an instance for 20–40 s. A
throttled call is a 503 from API Gateway before any Kaniti code runs. Two families comparing at once
plus the nightly jobs would reach the same ceiling. Needs: the owner to request a quota increase in
Service Quotas (Lambda → Concurrent executions, eu-central-1) on the personal account. It is an
account request, not a code or terraform change.
**Reproduced again 2026-10-05 without CloudWatch** (session expired): 16 parallel `GET /me` calls
from the ops Mac got four 503s in 0.3 s with API Gateway's own `{"message":"Service Unavailable"}` -
the same body and time as the search check's three 503s at 03:46Z. Every red API row that morning
(search, quote, shopper, chaotic compare) answered green when its check ran alone. The checks now run
the API checks one after another (branch `ops/2026-10-03-api-500-503`), so they stop crying wolf;
the cap itself still needs this quota request.

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

## ~~Victory / Mahsanei HaShuk / H. Cohen price files~~ — resolved, the vendor's migration finished
Earlier the same day (docs/BACKLOG.md, price-portal-fixer) the JSON API and the classic postback
form both answered "nothing published" for all three laibcatalog chains — a vendor-side gap, noted
here as needing a person to re-check in a few days in case it was mid-migration. Re-run a few hours
later (2026-09-13, same day, same code, same Israeli residential IP): `node --experimental-strip-types
services/branch-prices/lab.mjs` now shows `victory branches 70`, `mahsanei-hashuk branches 71`,
`h-cohen branches 5`, and a live basket priced at Victory (סיטי אחד העם, 4254 barcodes, 738 promos).
Checked each chain's `priceFile`/`promoFile` directly for a real branch: all three return today's
files (`PriceFull7290696200003-001-001-20260913-...`, and the equivalent for the other two chains).
Nothing in `portals.ts` changed between the two checks — the migration this note guessed at finished
on its own. No further action; `laibPortal` needs no code change.

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

## The store's own catalogue as a second price source in the compare (docs/backlog/api-fixer.md)
The line asks for Rami Levy's catalogue to price a storefront the provider lacks or is slow on,
"its catalogue already answers the API" — true when checked from this Mac, not from the API Lambda.
ADR 0011 (accepted 2026-09-13, the same night, from measurements) found the opposite: a Lambda
calling `rami-levy.co.il/api/catalog` gets the same block page a data centre always gets. The image
resolver already lives with this (`services/product-images/src/index.ts#tryRamiLevySearch` is called
from the API today, and its own comment says it answers a block page there; the phone's `remember()`
call is what actually fills that cache). A price source for the *compare* needs the same shape, and
does not exist yet: something that runs on the phone or the ops Mac, prices the storefront there,
and writes it somewhere the API can read as a cache — not a new Lambda-side call to the chain, which
would only repeat the measured block.

Needs: a decision on where this runs (phone, at compare time — but a compare must answer whether or
not that store's own app is open, so it cannot depend on the phone being on that store's site; or
the ops Mac, but its nightly run knows branches and prices, not a live per-basket quote) and what
"lacks a store or is slow" should degrade to in the meantime (today: the storefront is rejected and
missing from the compare, which is honest but not the second rung this line asks for).

## Alarms → Telegram, verified with a real alarm (docs/backlog/api-fixer.md)
The backlog line asks for the CloudWatch-alarm-to-Telegram path (`apps/api/src/alerts.ts`,
`infrastructure/terraform/app/alarms.tf`) to be proven with a real alarm — a genuine state change
through the live SNS topic, landing in the owner's Telegram chat. `alerts.ts` had no test coverage
at all before this session; `apps/api/test/alerts.test.ts` (new, 4 cases, mocked `fetch`) now covers
the handler's own logic — a real `AlarmName`/`NewStateValue`/reason renders correctly, no token/chat
means silence, a failed Telegram send never throws (must not crash the Lambda over an alarm the
owner never sees), and the 3900-char cap holds.

What this does not, and cannot, prove: whether a real CloudWatch alarm firing in production actually
reaches Telegram end to end. Every `aws`/AWS SDK call attempted in this sandboxed, unattended run
needed an approval that never came (the same restriction noted above for the branch-list write) —
there is no way from here to publish a real SNS message or check the live Telegram chat.

Needs: the owner, or the ops Mac's own AWS session, to trip a real alarm (or publish a test message
to the `alerts` SNS topic directly) and confirm it lands in the Kaniti Telegram channel.
