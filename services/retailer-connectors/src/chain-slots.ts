/**
 * The chains' delivery windows, read from a chain's own site without a session.
 *
 * Wolt answers in minutes; a chain delivers in windows the family picks at
 * checkout, so "how fast" for a chain is its earliest window still open for
 * ordering. Rami Levy publishes its windows for an address to anyone (the same
 * `supply/get-supply-date` call its checkout makes, after the site's own
 * city/street autocomplete), so that one is measured here. Shufersal's
 * `timeSlot/preselection/getHomeDeliverySlots` answers `{}` until an address
 * is in a signed-in session, and the stor.ai chains (Carrefour, Quik, Yeinot
 * Bitan, Tiv Taam, Hatzi Hinam, Victory online) need a branch from a session
 * — those stay "windows, time unknown" until the phone reads them.
 *
 * Never invent a time: a window is reported only when the chain listed it as
 * orderable (`active`) and it has not started yet.
 */
export interface ChainWindow {
  /** The earliest window the chain still takes orders for, wall-clock `YYYY-MM-DDTHH:mm` (the chains publish local times). */
  readonly earliest: string;
  readonly windowHours: number;
  /** `HH:mm` the window ends. */
  readonly until: string;
}

/** The parts of a household address a chain's address form asks for. */
export interface ChainAddress { readonly city?: string; readonly street?: string; readonly number?: string }

/** Wall-clock now in Israel as `YYYY-MM-DDTHH:mm`, comparable as a string with the chains' local times. */
export function nowInIsrael(at: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)) p[x.type] = x.value;
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}`;
}

const HHMM = /^\d{2}:\d{2}$/;
const hours = (from: string, to: string): number => { const [fh, fm] = from.split(':').map(Number); const [th, tm] = to.split(':').map(Number); return Math.round((((th! * 60 + tm!) - (fh! * 60 + fm!)) / 60) * 10) / 10; };

interface RamiSlot { readonly fromHour?: string; readonly toHour?: string; readonly date?: string; readonly active?: boolean }

/**
 * Rami Levy's `supply/get-supply-date` answer: `{ data: { 'YYYY-MM-DD': [slot, …] } }`, each slot with
 * `fromHour`/`toHour` and `active` (false when the store no longer takes orders for it, or is full).
 * The earliest active window that starts after `now`, or undefined.
 */
export function parseRamiLevySupply(answer: unknown, now: string): ChainWindow | undefined {
  const days = (answer as { data?: unknown } | undefined)?.data;
  if (!days || typeof days !== 'object' || Array.isArray(days)) return undefined;
  let best: ChainWindow | undefined;
  for (const [date, slots] of Object.entries(days as Record<string, unknown>)) {
    if (!Array.isArray(slots)) continue;
    for (const s of slots as RamiSlot[]) {
      const day = s.date ?? date;
      if (s.active !== true || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !HHMM.test(s.fromHour ?? '') || !HHMM.test(s.toHour ?? '')) continue;
      const earliest = `${day}T${s.fromHour}`;
      if (earliest <= now) continue;
      if (!best || earliest < best.earliest) best = { earliest, until: s.toHour!, windowHours: hours(s.fromHour!, s.toHour!) };
    }
  }
  return best;
}

const RL_SITE = 'https://www.rami-levy.co.il';
const RL_API = 'https://www-api.rami-levy.co.il/api/v2/site';
const RL_HEADERS = { accept: 'application/json', origin: RL_SITE, referer: `${RL_SITE}/he`, 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' };

async function call(url: string, fetchImpl: typeof fetch, body?: unknown): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(url, body === undefined ? { headers: RL_HEADERS, signal: ctl.signal } : { method: 'POST', headers: { ...RL_HEADERS, 'content-type': 'application/json;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) return undefined;
    return await res.json();
  } catch { return undefined; } finally { clearTimeout(t); }
}

const cache = new Map<string, { at: number; ttl: number; window: ChainWindow | undefined }>();

/**
 * Rami Levy's earliest orderable delivery window for a street address: the site's own city and street
 * autocomplete give the ids, `get-supply-date` the windows. Cached an hour per address (ten minutes
 * when nothing came back). Undefined on any failure — never blocks a quote.
 */
export async function ramiLevyWindow(addr: ChainAddress, fetchImpl: typeof fetch = fetch, now: string = nowInIsrael()): Promise<ChainWindow | undefined> {
  const city = addr.city?.trim(); const street = addr.street?.trim(); const number = addr.number?.trim() ?? '';
  if (!city || !street) return undefined;
  const key = `rami-levy|${city}|${street}|${number}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.window;
  const window = await (async () => {
    const cities = (await call(`${RL_SITE}/api/address-autocomplete/city?q=${encodeURIComponent(city)}`, fetchImpl)) as { data?: { city_id?: number; city_name?: string }[] } | undefined;
    const c = cities?.data?.find((x) => x.city_name === city) ?? cities?.data?.[0];
    if (!c?.city_id) return undefined;
    const streets = (await call(`${RL_SITE}/api/address-autocomplete/street?q=${encodeURIComponent(street)}&city_id=${c.city_id}`, fetchImpl)) as { data?: { street_id?: number; street_name?: string }[] } | undefined;
    const s = streets?.data?.find((x) => x.street_name === street) ?? streets?.data?.[0];
    if (!s?.street_id) return undefined;
    const supply = await call(`${RL_API}/supply/get-supply-date`, fetchImpl, {
      only_area_availability: false, city_id: c.city_id, street_id: s.street_id, street_name: s.street_name, home_num: number, entrance: '', is_save_request: false,
      user_id: null, name: null, email: null, city: c.city_name, street: s.street_name, street_number: number, showStreet: 0,
    });
    return parseRamiLevySupply(supply, now);
  })();
  cache.set(key, { at: Date.now(), ttl: window ? 60 * 60_000 : 10 * 60_000, window });
  return window;
}

/** The earliest published window for a chain storefront, where a chain publishes one without a session; undefined otherwise. */
export async function chainWindow(storefrontId: string, addr: ChainAddress, fetchImpl: typeof fetch = fetch): Promise<ChainWindow | undefined> {
  if (/^rami-levy/.test(storefrontId)) return ramiLevyWindow(addr, fetchImpl);
  return undefined;
}
