/**
 * Hatzi Hinam's own stock. A guest session - two GET calls, no login, no browser (`/` sets
 * `H_UUID`, `/proxy/init` sets `H_Authentication`; confirmed live, 2026-09-13, from this Mac) -
 * answers a barcode lookup with `IsInStock`, the same field the cart recipe already checks at fill
 * time (apps/mobile/src/lib/stores.ts).
 *
 * Not wired into the compare (ADR 0011: no call to a chain's own site runs from the API or any
 * Lambda). This class is meant for the ops Mac's nightly refresher - the same place Rami Levy's own
 * branch list and geocoding are moving to - to write a cached stock row the API only reads; it is
 * not yet called from there. It also does not yet pick the family's own branch: no branch-selecting
 * call was found in a GET-only probe (`getItemByBarkod` ignored every branch query param tried), so
 * it answers for whichever branch the guest session defaults to. Unknown stock (no answer, or the
 * wrong branch) should drop nothing wherever this ends up wired in.
 */
const SITE = 'https://shop.hazi-hinam.co.il';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/** A quoted line as the stock check needs it. */
interface StockLine { readonly lineId: string; readonly gtin?: string }

const cookiesOf = (res: Response): string[] => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter((c): c is string => !!c);
  return raw.map((c) => c.split(';')[0] ?? '').filter((c) => c && !c.endsWith('='));
};

export class HaziHinamStock {
  #session: { at: number; cookie: string } | undefined;
  readonly #timeoutMs: number;
  constructor(timeoutMs = 6000) { this.#timeoutMs = timeoutMs; }

  /** The guest session cookie jar, bootstrapped once and reused for every item lookup. */
  async #jar(): Promise<string> {
    if (this.#session && Date.now() - this.#session.at < 30 * 60_000) return this.#session.cookie;
    const home = await fetch(`${SITE}/`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(this.#timeoutMs) });
    const jar1 = cookiesOf(home);
    const init = await fetch(`${SITE}/proxy/init`, { headers: { 'user-agent': UA, accept: 'application/json', cookie: jar1.join('; ') }, signal: AbortSignal.timeout(this.#timeoutMs) });
    const cookie = [...jar1, ...cookiesOf(init)].join('; ');
    this.#session = { at: Date.now(), cookie };
    return cookie;
  }

  /** `IsInStock` per barcode, for the guest session's own branch; a failed lookup answers nothing for that barcode. */
  async inStock(gtins: readonly string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    const cookie = await this.#jar();
    const codes = [...new Set(gtins.filter(Boolean))];
    const lookup = async (bc: string) => {
      try {
        const res = await fetch(`${SITE}/proxy/api/item/getItemByBarkod/${encodeURIComponent(bc)}`, { headers: { accept: 'application/json', 'user-agent': UA, cookie }, signal: AbortSignal.timeout(this.#timeoutMs) });
        const j = (await res.json()) as { IsOK?: boolean; Results?: { Item?: { IsInStock?: boolean } } };
        const item = j.IsOK ? j.Results?.Item : undefined;
        if (item && typeof item.IsInStock === 'boolean') out.set(bc, item.IsInStock);
      } catch { /* unknown, not "no" */ }
    };
    // No batch endpoint found (unlike Rami Levy's /api/catalog) - one call per barcode, a few at a time.
    for (let i = 0; i < codes.length; i += 8) await Promise.all(codes.slice(i, i + 8).map(lookup));
    return out;
  }
}

/** The lines the branch carries; lines the lookup did not answer for are kept (unknown is not "no"). */
export function dropUnavailableHaziHinam<T extends StockLine>(lines: readonly T[], inStock: ReadonlyMap<string, boolean>): { kept: T[]; dropped: T[] } {
  const kept: T[] = []; const dropped: T[] = [];
  for (const l of lines) {
    const st = l.gtin ? inStock.get(l.gtin) : undefined;
    if (st === false) dropped.push(l); else kept.push(l);
  }
  return { kept, dropped };
}
