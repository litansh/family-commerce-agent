# Needs the owner

## This Mac cannot push the repo: GitHub answers 403 to `litanshamir` (2026-10-07)
`git push -u origin ops/2026-10-07-health` fails with `Permission to litansh/family-commerce-agent.git
denied to litanshamir` (HTTP 403). `gh auth status` shows the keyring login is the account
`litanshamir`, not `litansh`, and the branch has never reached origin, so every WIP commit on it
(the Rami Levy cart work, and today's price-portal fixes `73cd806`, `feb193d`) exists only on this
Mac, and `ops/pr.sh` cannot open a PR. Needs: the owner to sign this Mac in as `litansh`
(`gh auth login`, or add `litanshamir` as a collaborator) and then `git push -u origin ops/2026-10-07-health`.
**Still true 2026-10-10** (`git push --dry-run` → the same 403). `gh auth status` now shows `litansh`
signed in too, but inactive; `gh auth switch --user litansh` is a one-line fix the owner can make
(the orchestrator did not switch the owner's active account on its own). The branch now carries
eleven days of work, including today's cart-lab fix (`2c736c6`) and api-fixer's compare timing
(`5f4261f`, `192a06c`), none of it reviewable until it is pushed. **Still true 2026-10-11** (same 403;
the branch now also carries the chaos typo/mixed fix `951bd26`). **Still true 2026-10-12** (same 403;
`litanshamir` still the active `gh` account). **Still true 2026-10-14** (same 403). A second branch is
ready too: `ops/2026-10-14-check-sleep` (`e636334`, made from main, the check.mjs sleep fix only). Its PR body is
`~/.kaniti/pr/ops-2026-10-14-check-sleep.md`. After `gh auth switch --user litansh`, run: `git switch ops/2026-10-14-check-sleep &&
ops/pr.sh "ops/check.mjs: budgets count awake seconds" ~/.kaniti/pr/ops-2026-10-14-check-sleep.md`. **Still true 2026-10-15** (same 403).

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
chains (וולט מרקט, טיב טעם) when called alone, so this is the session, not load. **Still true on
2026-10-10**: the nightly run's `refresh-deals.mjs` and `refresh-branches.mjs` both died on
`CredentialsProviderError: Your session has expired`, and the deals check reads "8 deals across 1
chain(s): וולט מרקט" and "3/8 pictured" (the deals-pictures rung `914c64e` writes through the API but
had only Wolt's 8 deals to picture). No sub-agent was sent: there is nothing to fix in code.
**Still true 2026-10-11** (`aws sts get-caller-identity`: session expired; deals 40 across 1 chain).
**Still true 2026-10-12** (session expired; deals 25 across 2 chains, קרפור + וולט מרקט, 4/25 pictured).
**Still true 2026-10-14** (session expired; deals 40 across 2 chains, קרפור + וולט מרקט, 38/40 pictured).
A credential that does not expire every few
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

**2026-10-10, measured from the ops Mac (`services/shopping-agent/lab-compare-timing.mjs`), the sync
route cannot fit a week's list in 26 s, and only a budget decision fixes that.** The phone's real path
(the `/compares` job) answered the chaotic list live in 65.6 s with 3 options. Only the sync `/quote`
route, which the ops checks use, fails. Stages for the week for five: barcode pass 2.4 s, then the
words pass (`quoteWithFallback` asks again by words for every pinned line some store lacks: 35 of
39 lines, because thin Wolt venues lack nearly everything) 17-20 s, then substitutes, which may run
until 27 s by design (`substitutesMs`). So the shopper ends at 27 s or later whenever the substitutes
use their share, and the check's cutoff is 26 s: 28.3 s today. For the chaotic list (48 lines to
quote after branch `ops/2026-10-07-health`), the barcode pass took 5.8 s and the words pass for 40
lines took 21-39 s (72 s once under `service_busy`), so the 26 s try aborts and the answer is
503 `stores_slow`. chaos.mjs then retries once after 8 s: 26 + 8 + 26 = the 60.7 s in the report.
What does not work: capping the words pass (tried; without it Rami Levy prices 21 of 51 and every
store falls under the 90 % coverage floor, so 0 options); running it beside the barcode pass (the
provider slowed the barcode pass from 2.4 s to 9 s and the pair took as long); splitting it into
parallel chunks (16-21 s against 16-48 s for one call, and 6 chunks get `service_busy`).
Choices for the owner: (a) the ops checks measure the job, as the phone does, and the sync route
stays a smoke test; (b) the sync route skips the words pass and the substitutes for lists over N
lines, and the checks accept fewer alternatives there (promise 3 on that route only); (c) the
substitutes' catalogue searches start beside the words pass (saves about 4-5 s, not measured under
load). The check's cutoff stays where it is.

**2026-10-12, unchanged, and nothing on the branch fixes it** (api-fixer, backlog line `206f5a2`): from the Mac, with the
branch code, the chaotic list ended in 503 at 25-26 s in 4 of 4 runs. Each time the words pass for 46 lines ran into the provider's
22 s abort. The shopper took 26.5 s once and got a 503 once. The orchestrator re-ran the three checks at 04:04Z, and production
(main) was worse: the clean compare also gave 0 options at 54.7 s, and the flaky-item rows (טופו, שוקולד) came back unresolved.
The provider was answering `service_busy` this morning. Choices (a)/(b)/(c) above are still the owner's call.

**2026-10-15, unchanged** (api-fixer, `7ac36b0`): the 03:44Z run had shopper red (the compare past the cutoff) and chaos red (the typo row, and the chaotic list 503 at 60.8 s). The orchestrator's re-run at about 03:50Z: shopper green at 31 s, which was luck on a quiet provider. Chaos was still red on three rows. The typo row needs 951bd26 deployed, so the push 403 has to be fixed first. The 'same item twice' row is new today: it used to pass on null vs null (both בננות lines dropped), and api-fixer made it require a real match. So it now honestly reads BAD until the same deploy. The chaotic 503 is still choice (a)/(b)/(c).

**2026-10-16, unchanged** (api-fixer): the 06:30Z run had shopper red, with the compare past the cutoff over an 85 s run, Mac awake. The other 26 rows were ok. Re-runs of `ops/test-cart.mjs` against production, a minute apart with the same code: 07:09Z gave `/quote` 27.1 s, red (32.3 s with the whole call, ₪911, 3 options). 07:09:45Z gave 20.1 s, green (24.4 s with the call, ₪911, 3 options). The same list swings 7 s between runs. That is the provider, not a regression: the branch is not deployed, so production runs main. An earlier `check.mjs --only shopper` re-run at 06:51Z gave no verdict, because the Mac was in maintenance sleep on battery with the lid closed (DarkWake 45 s every 2-5 min). No code change. Choices (a)/(b)/(c) are still the owner's call. The cutoff stays at 26 s.

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

## 2026-10-09 — the ops Mac sleeps during the nightly checks (store-recipe-fixer)

The 2026-10-09 `stores` failure (wolt, mahsanei-hashuk "no verdict in 120 s (stuck at load)", lab
~20 min against a 600 s budget) was the Mac sleeping, not the stores. The lid is closed
(`AppleClamshellState = Yes`) and it runs on battery, so macOS DarkWakes for ~45 s every 10-20 min
(`pmset -g log`) and sleeps again, even with `caffeinate -i` and Owly's idle-sleep assertion. Both
stores load in ~1 s when the Mac is awake (3/3 rounds each). Today's runs took 1048 s, 1647 s and
1641 s of wall time, which is mostly sleep; the last one never got WebKit launched (180 s launch
timeout). `store-health.mjs` now measures the sleep and gives a store that failed while the Mac
slept one second look, but no lab can finish inside 600 s while the machine is asleep.

Needs: the owner to keep the ops Mac awake for the nightly run. Either keep it on the charger with
the lid open, or run `sudo pmset -c sleep 0` (plus `sudo pmset -b sleep 0` if it must work on
battery), or let `ops/repair.sh` run under `caffeinate -s` (only holds while on AC power).

**Still true 2026-10-14 (store-recipe-fixer).** The `stores`, `cart`, `history`, `prices` and
`chaos` rows that have read `unknown` since 2026-10-13 were this sleep again. No store and no code
caused them. `pmset -g log` shows the Mac on battery and in Deep Idle from 08:00 to 11:05, with only
2-45 s DarkWakes. Each hung run ended exactly on a DarkWake: 08:30:25 + 846 s = 08:44:30, and
09:16:24 + 1023 s = 09:33:27 (the orchestrator's `caffeinate -dims` was taken at 09:16:24, the
Mac slept anyway at 09:16:48, and caffeinate's assertions are logged "ClientDied" at 09:33:28).
caffeinate cannot hold the Mac on battery. The machine is not otherwise to blame: the installs on
10-12 and 10-14 were WhatsApp and the Claude desktop app, not WebKit or macOS, and Playwright's
WebKit build is unchanged. Once the Mac was woken (on AC at 11:05), the same code passed
`check.mjs --only stores,cart,history` in 145 s. `check.mjs` now counts awake seconds and labels a
sleep-hit row, but the checks only *finish* if the Mac stays awake. Needs: the same as above.
`sudo pmset -b sleep 0` (or the charger with the lid open) before 06:40.
