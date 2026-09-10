# ADR 0008 — Connect a store: one flow, three platforms, nothing kept but the session

**Status:** accepted · 2026-09-10 · supersedes the "use the app" dead end on the web in ADR 0007

## Context

Kaniti (formerly Kanili) ships as three apps from one Expo codebase: web (CloudFront), iOS and
Android (EAS). The product owner's bar for connecting a store: **plug and play.**

1. If the person already has a saved password on the device, use it — no typing.
2. If they have an account but no saved password, find another way in: SMS code, phone sign-in,
   e-mail link — whatever that store offers without a password.
3. If they have no account at that store, offer to create one, and fill everything Kaniti
   already knows into the store's form.
4. Kaniti keeps **no PII and no passwords**. It acts *as the person* at the store, with a session
   the store issued and can revoke.

What the platforms allow (verified in `apps/mobile/e2e/store-lab.mjs` and `login-api-lab.mjs`):

| Capability | Web | iOS / Android |
|---|---|---|
| Store's own page inside Kaniti | ✗ stores forbid framing | ✓ WebView |
| Device password autofill on the store's page | ✗ (autofill is per-origin) | ✓ Face ID / Google |
| Read the store's session after sign-in | ✗ | ✓ (cookie manager in a dev build; JS cookies in Expo Go) |
| Store reachable from AWS (eu-central-1) | Shufersal ✓, Rami Levy ✓, Wolt ✓, Hatzi Hinam ✓; stor.ai chains (Victory, Carrefour, Keshet, Mahsanei HaShuk, Tiv Taam) ✗ 403 | same |

## Decision

One `connect` flow, decided per store × platform by a **ladder** — the first rung that works wins,
and every rung ends in the same place: a verified store session held by Kaniti's cloud.

```
rung 1  device      (native)  store login in a WebView; OS autofills the password, or the SMS code
                              lands on the keyboard. The signed-in session is captured and sent to
                              the cloud (ADR 0007), so ordering is identical on every platform.
rung 2  cloud-otp   (all)     the person gives a phone / e-mail; the cloud asks the store to send
                              its one-time code; the person types the code into Kaniti; the cloud
                              finishes the sign-in. Nothing to remember, no password anywhere.
rung 3  cloud-pw    (all)     for stores with password-only sign-in: e-mail + password typed once
                              into Kaniti, forwarded over TLS, used for one sign-in, discarded.
                              The password never touches storage or logs.
rung 4  create      (all)     no account: Kaniti opens the store's own sign-up with everything it
                              knows filled in (name, e-mail, phone, delivery address — on native
                              via the WebView; on the web as one-tap copy of each value), and the
                              person finishes on the store's page. Then rung 1–3 as usual.
```

Platform rules:
- **Native** starts at rung 1 and falls to 2/3 only if the WebView cannot verify a session.
- **Web** starts at rung 2 (or 3 where the store has no OTP). Stores that block AWS have no web
  rung: the web shows exactly that, offers the phone app, and keeps ordering by deep link.
- "Already signed in" is never assumed: every rung ends with the store's own signed-in check.
- **Nobody can block the device rung.** On the phone, Kaniti *is* the person's own browser session
  on the person's own network — the store sees exactly what it sees when the person shops. That
  is the product's guarantee. For stores that gate their sign-in behind a captcha or block
  datacenters (verified 2026-09-10: Rami Levy → 422 "recaptcha" without a widget token; Wolt
  loads hCaptcha; stor.ai chains send a `recaptchaHash` and 403 AWS), **ordering itself also runs
  on the phone**, in the same WebView, with the store's own endpoints — the cloud only keeps the
  session so the family's other devices can start an order.

What each store's sign-in actually needs (captured with every non-GET request aborted, so no
SMS, e-mail or account was ever created):

| Store | Sign-in | Captcha | From AWS | Web rung | Sign-up asks for |
|---|---|---|---|---|---|
| Shufersal | e-mail + password (`j_spring_security_check`) | none | ✓ | password | first/last name, ID number, mobile, e-mail, birth date, password |
| Hatzi Hinam | e-mail-or-ID + password (`/proxy/Login`) | optional token, accepted empty | ✓ (verified from here; AWS to confirm on deploy) | password | name, ID number, mobile, e-mail; address; password (3 steps) |
| Rami Levy | e-mail → SMS/voice code (`/api/v2/site/auth/login`) | reCAPTCHA v2, required | ✓ | — (phone) | e-mail + code |
| Wolt | e-mail → link (`/v3/users/email_login`), or phone → SMS/WhatsApp/call | hCaptcha | ✓ | — (phone) | e-mail or phone |
| Victory, Carrefour, Keshet, Mahsanei HaShuk, Tiv Taam | e-mail + password or SMS (`/v2/retailers/{id}/sessions`) | reCAPTCHA hash, required | ✗ 403 | — (phone) | per chain |

What Kaniti stores, per household and store, in one DynamoDB row `HOUSEHOLD#<hid> / SESSION#<store>`:
the cookie jar (and any bearer token) **encrypted with AES-256-GCM** under a key that exists only
in the API Lambda's environment, plus `method`, `connectedAt`, `lastVerifiedAt`. It does not store
phone numbers, e-mails, passwords, ID numbers or names given during connect; the OTP challenge
row (`CHALLENGE#<id>`) lives 10 minutes and carries only what the store needs to finish the
exchange, then expires by TTL.

## API

```
GET    /households/{hid}/stores/connections                → { [store]: { connected, method, since } }
POST   /households/{hid}/stores/{store}/connect            { method:'otp'|'password', phone?, email?, password? }
                                                            → { challengeId, sentTo } | { connected:true }
POST   /households/{hid}/stores/{store}/connect/verify     { challengeId, code } → { connected:true }
POST   /households/{hid}/stores/{store}/session            { cookies:[...], userAgent } (native capture) → { connected }
DELETE /households/{hid}/stores/{store}/connection
POST   /households/{hid}/stores/{store}/import             → { orders, products } (history through the session)
```

Drivers live in `services/cloud-connectors/src/drivers/`, one per store, behind one interface
(`StoreDriver`): `startOtp`, `verifyOtp`, `passwordLogin`, `signedIn`, `orderHistory`. A driver
that a store's platform does not support simply omits the method; the API turns that into the
next rung on the ladder. Request shapes come from `login-api-lab.mjs`, which records what each
store's own page sends and **aborts every non-GET request**, so the lab never sends an SMS or
creates anything.

## Amendment, same day — the cloud rung is dead for grocery, the phone is the product

A probe Lambda in eu-central-1 fetched each store the way the drivers do (2026-09-10 21:50 IDT):
Shufersal served a 441-byte S3 block page instead of its login (ADR 0007's "does not block
datacenters" no longer holds), Hatzi Hinam, Rami Levy and Victory answered Cloudflare's
"Just a moment" 403, and only Wolt's token endpoint replied. The live smoke test of the new
routes accordingly returned `502 unavailable` for both password drivers.

So: **no store has a web rung.** The drivers stay (they work from any residential network and
are the shape a future on-device relay would use), but the app offers no cloud sign-in. The web
is for the list, the compare and the approval; connecting and ordering happen on the phone,
where nobody can tell Kaniti from the person. Development effort goes to the phone app first.

## Consequences

- The web app can connect Shufersal and Hatzi Hinam without the phone. Rami Levy, Wolt and the
  stor.ai chains connect on the phone (captcha widgets and datacenter blocks), and the web says so
  in one line with a hand-off to the app; ordering there stays by deep link until the phone connects.
- The home-Mac worker (ADR 0007's fallback) becomes optional for every store the cloud can reach;
  its session file format is unchanged.
- One place owns "is this store connected": the cloud row. The device-local `fca.linked` flag
  remains a cache of it.
- Password rung: the password transits the API once. It is never written to DynamoDB or logs and
  the connect handler redacts request bodies. A later hardening step can move the login exchange
  into a separate Lambda with no log retention.
