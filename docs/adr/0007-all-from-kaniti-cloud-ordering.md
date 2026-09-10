# ADR 0007 — All from Kaniti: phone login, cloud ordering, no home worker

**Status:** accepted · 2026-09-06

## Context
The ordering worker was placed on a home machine for two reasons: retailer sites were assumed to
block datacenter IPs, and the retailer session had to live somewhere trusted. The product owner
wants the entire experience inside Kaniti on the phone — no Mac, no home computer.

Two facts, verified 2026-09-06:
1. **Shufersal does not block datacenter IPs.** `GET /online/he/my-account/orders` from a
   datacenter returns the normal login page, not a Cloudflare/Incapsula/Akamai challenge. So an
   authenticated session can be *used* from AWS.
2. **Shufersal Online has no passwordless login.** The OTP the user reached is *club-member
   identification* (for club prices); it does not create a signed-in Online session — every
   `/my-account/*` page redirected to `/login`. Online sign-in is email+password or Facebook only.

## Decision
"All from Kaniti" is built as:
- **Phone (native app) captures the session.** A WebView opens Shufersal Online's login; iOS/Android
  autofill (Face ID) fills the saved password, or the person uses Facebook — one tap, no typing.
  After login the app reads the site's cookie jar (native cookie manager can read httpOnly cookies)
  and POSTs it, encrypted in transit, to the API.
- **AWS stores the session** encrypted (per household, per retailer) and **runs the ordering
  server-side** — read history, build the cart via the retailer's own endpoints, read the review
  total, place on approval. No home worker.
- The Playwright home worker remains only as a fallback/for retailers that *do* block datacenter IPs
  (Victory, Yochananof did in earlier probes).

## Consequences
- **Reading httpOnly cookies requires the native app**, so this path is gated on an EAS build →
  Apple Developer + Google Play accounts. The plain mobile web browser cannot capture the session.
- Kaniti cannot invent a login Shufersal does not offer: the one-time auth is email+password
  (autofilled) or Facebook. That is a tap on the phone, not a typed password, but a password must
  exist once.
- No per-family home machine — the model scales to other households, which the home worker never did.
- Cloud ordering is cheap (Lambda/Fargate, bursty) and keeps the whole experience in the app.
