# E2E review — three lenses on the live site

**How it runs:** `KANILI_E2E_TOKEN=<id token> npx playwright test` in `apps/mobile`. Playwright drives the live site at phone width as a person would — sign-in, Home, aisle, sub-aisle, product sheet, search — asserting the mechanics (products render, sub-aisle switches keep the grid, ≥80% of pictures paint, the sheet opens) and applying three checks on every screen: no lingering skeletons, at least one tappable action, no stray English on a Hebrew screen. Each screen is captured to `e2e/shots/` for the judgement calls below.

**Latest run:** 3/3 passing. The first runs reproduced the owner's two reports exactly (blank grid after a sub-aisle tap; missing pictures) before any fix.

## Lens 1 — graphic designer

| Screen | Finding | Status |
|---|---|---|
| Aisle | Sub-aisle chip row clipped at the top; chips looked cut off | fixed — fixed-height row, vertically centred |
| Product sheet | Title in display size overflowed the frame for long product names | fixed — 22pt title, wraps, brand beneath |
| Product sheet | Nine rows of the same "₪11.74" — visual noise that hides the one fact (one store is cheaper) | fixed — identical prices collapse into one row listing the stores; cheapest highlighted |
| Home | Large empty field under the aisle grid for a new household | fixed — connect-and-import card; "usual shop" hero appears once memory exists |
| Home | Household name in Latin beside Hebrew title looks foreign | open — the name is what the family typed; consider a Hebrew placeholder in setup |
| Cards | Photos at 96pt read well; a few products fall back to the aisle glyph | acceptable — progressive loading now fills most within seconds |

## Lens 2 — UX

| Finding | Status |
|---|---|
| Tapping a sub-aisle wiped the grid to skeletons for up to 15 s — read as "it disappeared" | fixed — the previous grid stays, dimmed, with a thin progress bar; one fetch per (aisle, sub) |
| Pictures blocked the whole response; a slow image host made the grid wait | fixed — the grid returns with cached pictures only; the rest arrive via `/images` with a 12 s budget |
| A failed image lookup was remembered for 30 days | fixed — misses retry after a day; timeouts are not 404s |
| Intro could be skipped before it was understood | fixed — each stage must be played to unlock Next; Skip appears only after a first complete viewing |
| Search and aisles rank generically | fixed — ranked for the household: bought first, then their brands, then availability |

## Lens 3 — the person who downloaded it to do one thing

*"Show me my usual shop, tell me what I forgot, and buy it from wherever is cheapest without me opening six apps."*

- **Usual shop in one tap** — yes, once memory exists. Before that, the Home card says exactly what to do (connect Shufersal, import history). Honest gap: until the first import, the app is a nice catalogue.
- **What I forgot** — yes, the amber "שכחתם משהו?" strip, from purchase rhythm.
- **Cheapest across stores** — yes at compare time; on a product sheet you see every store's price and which is cheapest.
- **Order without opening the retailer** — built; gated on the one-time session link on the home Mac. Until then: deep links.
- **Feels like an app** — tab bar, photo grid, phone frame on web, Hebrew by default, language dropdown. What still separates it from Shufersal's app: no promotions surface yet (the catalogue's promotions feed is noisy — whisky and laptop stands from Wolt Market — and needs filtering to groceries before it earns a place on Home).

## What the test does not cover yet
- The ordering worker (needs a real retailer session).
- Native gestures and haptics (web run).
- Visual regression — screenshots are reviewed by eye, not diffed.
