/**
 * Rami Levy's own stock, per online branch. Its public catalogue answers every item with
 * `available_in`: the online branches that carry it. An item the family's branch does not carry is
 * "out of stock" at the store's checkout - which for a family equals "does not exist" - so the compare
 * checks it before offering the line (promise 9: what Kaniti says is what the store shows).
 *
 * The branch, in order: the one the store itself chose for the family's delivery address (the phone
 * reports it from the cart flow and the API keeps it on the household); the nearest online branch to
 * the family's home (the refresher geocodes the branch list nightly); the online branch in the family's
 * city; the site's default. Unknown stock (the store did not answer) drops nothing.
 */
const SITE = 'https://www.rami-levy.co.il';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
export const RAMI_LEVY_DEFAULT_BRANCH = 331;

export interface RamiLevyBranch { readonly id: number; readonly name: string; readonly city: string; readonly street?: string; readonly houseNumber?: number; readonly lat?: number; readonly lng?: number }

/** The nearest online branch to the family, in kilometres. Branches without a position are skipped. */
export function nearestBranch(branches: readonly RamiLevyBranch[], at: { lat: number; lng: number }): RamiLevyBranch | undefined {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  let best: RamiLevyBranch | undefined; let bestKm = Infinity;
  for (const b of branches) {
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') continue;
    const dLat = rad(b.lat - at.lat), dLng = rad(b.lng - at.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(at.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(h));
    if (km < bestKm) { bestKm = km; best = b; }
  }
  return best;
}

/** A quoted line as the stock check needs it. */
export interface StockLine { readonly lineId: string; readonly gtin?: string }

const norm = (s: string) => s.replace(/['"׳״]/g, '').replace(/\s+/g, ' ').replace(/יי/g, 'י').trim();

/** Which online branch serves a city, from the site's own branch list. */
export function branchForCity(branches: readonly RamiLevyBranch[], city: string | undefined): number | undefined {
  if (!city) return undefined;
  const c = norm(city);
  const hit = branches.find((b) => norm(b.city) === c) ?? branches.find((b) => norm(b.name) === c);
  return hit?.id;
}

/** The lines the branch carries, from `available_in`; lines the catalogue did not answer for are kept (unknown is not "no"). */
export function dropUnavailable<T extends StockLine>(lines: readonly T[], branch: number, availableIn: ReadonlyMap<string, readonly number[]>): { kept: T[]; dropped: T[] } {
  const kept: T[] = []; const dropped: T[] = [];
  for (const l of lines) {
    const av = l.gtin ? availableIn.get(l.gtin) : undefined;
    if (av && !av.includes(branch)) dropped.push(l); else kept.push(l);
  }
  return { kept, dropped };
}

export class RamiLevyStock {
  #branches: { at: number; list: RamiLevyBranch[] } | undefined;
  readonly #timeoutMs: number;
  constructor(timeoutMs = 6000) { this.#timeoutMs = timeoutMs; }

  async branches(): Promise<RamiLevyBranch[]> {
    if (this.#branches && Date.now() - this.#branches.at < 86_400_000) return this.#branches.list;
    const res = await fetch(`${SITE}/api/stores`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(this.#timeoutMs) });
    const j = (await res.json()) as { stores?: { data?: { internet_store_id?: number | null; name?: string; city?: string; street?: string; home_number?: number }[] } };
    const list = (j.stores?.data ?? []).filter((s) => typeof s.internet_store_id === 'number').map((s) => ({ id: s.internet_store_id as number, name: s.name ?? '', city: s.city ?? '', ...(s.street ? { street: s.street } : {}), ...(typeof s.home_number === 'number' ? { houseNumber: s.home_number } : {}) }));
    if (list.length) this.#branches = { at: Date.now(), list };
    return list;
  }

  /** `available_in` per barcode, in batches; a failed batch answers nothing for its barcodes. */
  async availableIn(gtins: readonly string[], branch: number): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const codes = [...new Set(gtins.filter(Boolean))];
    for (let i = 0; i < codes.length; i += 40) {
      const slice = codes.slice(i, i + 40);
      try {
        const res = await fetch(`${SITE}/api/catalog?`, { method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json', 'user-agent': UA }, body: JSON.stringify({ store: branch, items: slice.join(','), itemsBy: 'barcode', size: slice.length }), signal: AbortSignal.timeout(this.#timeoutMs) });
        const j = (await res.json()) as { data?: { barcode?: string | number; available_in?: number[] }[] };
        for (const it of j.data ?? []) if (it.barcode != null && Array.isArray(it.available_in)) out.set(String(it.barcode), it.available_in);
      } catch { /* unknown, not "no" */ }
    }
    return out;
  }
}
