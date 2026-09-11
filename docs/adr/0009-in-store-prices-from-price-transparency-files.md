# 0009 — "And if we drive there?": in-store prices from the chains' published price files

Date: 2026-09-11. Status: accepted, first version live in the compare screen.

## Why

The compare screen prices a list at every online storefront that delivers to
the family. The user asked for one more column: what the same list costs if
they drive to the grocery store themselves. In Israel that is often the real
choice (Osher Ad and the discount branches have no delivery at all), and the
answer is public: the price-transparency law makes every chain publish, per
branch, a full price list every day.

## Where the files are

| Chain | Portal | Listing | Stores file | Notes |
|---|---|---|---|---|
| Shufersal | prices.shufersal.co.il | HTML, ~30 s a page | yes, city as CBS code | links into Azure blob storage |
| Rami Levy, Keshet Teamim, Tiv Taam, Osher Ad, Yohananof | url.publishedprices.co.il (Cerberus) | login per chain, no password; JSON dir | yes; Rami Levy in UTF-16LE, city as CBS code | one cookie jar + CSRF token |
| Carrefour | prices.carrefour.co.il | file list embedded in the page | yes | download `<date>/<name>` |
| Hatzi Hinam | shop.hazi-hinam.co.il/Prices | static links | **none** | branches unknown until we read them from its site |
| Victory, Mahsanei HaShuk | laibcatalog.co.il | ASP.NET postback form | — | not read yet |

All of it is plain HTTPS from AWS, no account of ours, no browser.

## Design

- `services/branch-prices`: readers for the portals, the XML (any encoding,
  gzipped or not, either tag case), the CBS settlement-code map (open data,
  because two chains publish a city as a number), geocoding through Nominatim,
  and pricing a list at a branch by barcode. Weighed goods are skipped: a
  per-kilo price is not a line on the list.
- A refresher Lambda (`apps/api/src/refresh.ts`, 15 min, 2 GB) runs nightly
  and when a household first asks. Per household: the chains' branches in the
  family's city (name or CBS code), geocoded once and cached in S3, the two
  nearest per chain within 12 km, and each one's price file turned into a
  small `barcode → [agorot, name]` index in S3 (`index/<chain>/<store>.json`).
  The row `HOUSEHOLD#<hid> / BRANCHES` records the branches and when they
  were indexed.
- The quote route only reads: `drive: { status, branches[] }` with, per branch,
  the items subtotal, the covered lines, the distance, the driving minutes and
  the fuel cost (`costPerKm` × road factor 1.3 × two ways). Cash and driving are
  shown side by side and never summed into a single number, in keeping with
  ADR 0003's rule about time. A branch that prices under 60 % of the list is
  not shown: it would mean a second trip.
- The first quote after an address is set answers `pending` and kicks the
  refresher; the next compare shows the branches.

## Measured (Tel Aviv centre, 2026-09-11)

Five chains priced a test basket at real branches within 2.5 km: Shufersal
Shli Ichilov, Rami Levy Esther HaMalka, Carrefour City Pinkas, Tiv Taam Maze,
Osher Ad Tel Aviv. Shufersal's portal is the slow one (20–30 s per listing);
everything else answers in under a second.

## Not yet

Victory/Mahsanei HaShuk (postback form), Hatzi Hinam branches (no Stores
file), promotions (PromoFull files: club prices and multi-buys would lower the
in-store total further), and a per-household car cost instead of the default
₪2.50/km.
