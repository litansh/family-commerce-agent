/**
 * A picture for a line the family typed, fetched from the chain's own catalogue — from this phone.
 *
 * The API cannot do this: the chains answer a data centre with a block page and a phone with JSON
 * (ADR 0011). So the phone asks, uses what it gets, and posts it back so the API can keep it for the
 * household and for the next phone. A failure is silent: a drawn glyph is a small loss, an error
 * message about pictures is a bigger one.
 */
const CATALOG = 'https://www.rami-levy.co.il/api/catalog?';
const IMG = 'https://img.rami-levy.co.il';

export interface StoreImage { readonly url: string; readonly gtin?: string; readonly productName?: string }

/** The chain's picture for a name, with the barcode it belongs to when the chain gives one. */
export async function imageByName(name: string, signal?: AbortSignal): Promise<StoreImage | undefined> {
  const q = name.trim();
  if (q.length < 2) return undefined;
  try {
    const res = await fetch(CATALOG, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json' },
      body: JSON.stringify({ q, size: 5 }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return undefined;
    const d = (await res.json()) as { data?: { barcode?: string | number; name?: string; images?: { small?: string; trim?: string } }[] };
    const hit = (d.data ?? []).find((r) => r.images?.small ?? r.images?.trim);
    const path = hit?.images?.small ?? hit?.images?.trim;
    if (!path) return undefined;
    return {
      url: path.startsWith('http') ? path : `${IMG}${path}`,
      ...(hit?.barcode != null ? { gtin: String(hit.barcode) } : {}),
      ...(hit?.name ? { productName: hit.name } : {}),
    };
  } catch {
    return undefined;
  }
}
