/**
 * Live delivery estimates from Wolt's public venue feed for a point on the map.
 *
 * Wolt shows, per venue, an estimate in minutes and a range ("45-55") that
 * moves with the day, the hour and the load — exactly the "Wolt is fast now,
 * the chains deliver in windows" difference a family wants to see next to the
 * price. The feed is public, needs no account, and answers from AWS.
 *
 * SuperMCP names a Wolt storefront `wolt-<venue slug>`, so matching is a
 * string join on the slug.
 */
export interface WoltEta {
  readonly slug: string;
  readonly name: string;
  /** Typical minutes until delivery, as Wolt shows it. */
  readonly minutes: number;
  /** "45-55", as Wolt shows it. */
  readonly range?: string;
  readonly online: boolean;
  readonly delivers: boolean;
}

interface FrontFeed { sections?: { items?: { venue?: { slug?: string; name?: string; estimate?: number; estimate_range?: string; online?: boolean; delivers?: boolean } }[] }[] }

/** Parse the feed's venues into estimates, one per slug (the feed repeats venues across sections). */
export function parseWoltFront(feed: FrontFeed): Record<string, WoltEta> {
  const out: Record<string, WoltEta> = {};
  for (const s of feed.sections ?? []) {
    for (const it of s.items ?? []) {
      const v = it.venue;
      if (!v?.slug || typeof v.estimate !== 'number' || out[v.slug]) continue;
      out[v.slug] = { slug: v.slug, name: v.name ?? v.slug, minutes: v.estimate, ...(v.estimate_range ? { range: v.estimate_range } : {}), online: v.online !== false, delivers: v.delivers !== false };
    }
  }
  return out;
}

const cache = new Map<string, { at: number; etas: Record<string, WoltEta> }>();

/**
 * The pages a grocery venue can be listed on. The front page carries only a few "featured" markets
 * (Wolt Market, Tiv Taam); the chains' venues - Victory, Mahsanei HaShuk, Shufersal, Carrefour - are
 * on the grocery category page only, so both are read and merged (the front page wins on a repeat).
 * Read from a residential and an AWS address alike; the feed needs no account.
 */
const PAGES = ['/v1/pages/front', '/v1/pages/venue-list/category-grocery'] as const;

/** Estimates around (lat, lng), cached five minutes per ~100 m cell. Empty on any failure — never blocks a quote. */
export async function woltEtasNear(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<Record<string, WoltEta>> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.etas;
  const page = async (path: string): Promise<Record<string, WoltEta>> => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetchImpl(`https://restaurant-api.wolt.com${path}?lat=${lat}&lon=${lng}`, { headers: { accept: 'application/json', 'app-language': 'he', platform: 'Web' }, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!res.ok) return {};
      return parseWoltFront((await res.json()) as FrontFeed);
    } catch { return {}; }
  };
  const pages = await Promise.all(PAGES.map(page));
  const etas: Record<string, WoltEta> = {};
  for (const p of pages) for (const [slug, e] of Object.entries(p)) if (!etas[slug]) etas[slug] = e;
  if (Object.keys(etas).length > 0) cache.set(key, { at: Date.now(), etas });
  return etas;
}

/** The estimate for a SuperMCP storefront id (`wolt-<slug>`), if Wolt lists that venue near the address. */
export function etaForStorefront(storefrontId: string, etas: Record<string, WoltEta>): WoltEta | undefined {
  if (!storefrontId.startsWith('wolt-')) return undefined;
  return etas[storefrontId.slice('wolt-'.length)];
}

export interface WoltOpenStatus {
  readonly isOpen: boolean;
  /** When a closed venue next opens, wall-clock `YYYY-MM-DDTHH:mm` as Wolt states it (the venue's own zone, never converted). */
  readonly nextOpen?: string;
  /** Wolt's own words, e.g. "נפתח ביום יום שני בשעה 07:00". */
  readonly text?: string;
}

interface VenueDynamic { venue?: { delivery_open_status?: { is_open?: boolean; next_open?: string; value?: string } } }

/** `2026-09-14T07:00:00+03:00` → `2026-09-14T07:00`. */
const localMinute = (iso: string): string | undefined => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(0, 16) : undefined);

/** Parse the venue page's open status. Undefined when the page does not say. */
export function parseWoltVenueDynamic(page: VenueDynamic): WoltOpenStatus | undefined {
  const s = page.venue?.delivery_open_status;
  if (!s || typeof s.is_open !== 'boolean') return undefined;
  const next = typeof s.next_open === 'string' ? localMinute(s.next_open) : undefined;
  return { isOpen: s.is_open, ...(next ? { nextOpen: next } : {}), ...(s.value ? { text: s.value } : {}) };
}

const openCache = new Map<string, { at: number; status: WoltOpenStatus }>();

/** When a closed Wolt venue reopens, from its venue page; cached an hour per slug. Undefined on any failure. */
export async function woltNextOpen(slug: string, lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<WoltOpenStatus | undefined> {
  const hit = openCache.get(slug);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.status;
  const status = await (async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetchImpl(`https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/${encodeURIComponent(slug)}/dynamic/?lat=${lat}&lon=${lng}`, { headers: { accept: 'application/json', 'app-language': 'he', platform: 'Web' }, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!res.ok) return undefined;
      return parseWoltVenueDynamic((await res.json()) as VenueDynamic);
    } catch { return undefined; }
  })();
  if (status) openCache.set(slug, { at: Date.now(), status });
  return status;
}
