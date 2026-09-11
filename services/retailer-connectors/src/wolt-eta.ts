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

/** Estimates around (lat, lng), cached five minutes per ~100 m cell. Empty on any failure — never blocks a quote. */
export async function woltEtasNear(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<Record<string, WoltEta>> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.etas;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetchImpl(`https://restaurant-api.wolt.com/v1/pages/front?lat=${lat}&lon=${lng}`, { headers: { accept: 'application/json', 'app-language': 'he', platform: 'Web' }, signal: ctl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return {};
    const etas = parseWoltFront((await res.json()) as FrontFeed);
    cache.set(key, { at: Date.now(), etas });
    return etas;
  } catch { return {}; }
}

/** The estimate for a SuperMCP storefront id (`wolt-<slug>`), if Wolt lists that venue near the address. */
export function etaForStorefront(storefrontId: string, etas: Record<string, WoltEta>): WoltEta | undefined {
  if (!storefrontId.startsWith('wolt-')) return undefined;
  return etas[storefrontId.slice('wolt-'.length)];
}
