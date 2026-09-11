/**
 * Where each chain publishes its price files, and how to read the listing.
 *
 *   shufersal   its own portal; links into Azure blob storage (slow to list, ~30 s)
 *   cerberus    publishedprices.co.il, one login per chain (username, no password):
 *               Rami Levy, Keshet Teamim, Tiv Taam, Osher Ad, Yohananof
 *   hazi-hinam  a static page of blob links (no Stores file: branches come from elsewhere)
 *   carrefour   a page that embeds the day's file list as JSON
 *
 * Victory / Mahsanei HaShuk (laibcatalog.co.il, an ASP.NET postback form) are not
 * read yet. Everything here is a plain fetch: no browser, no account of ours.
 */
import { decodeXml, parseStores, sameStoreId, type Branch } from './xml.ts';

export interface PriceFileRef {
  readonly chain: string;
  readonly storeId: string;
  readonly name: string;
  readonly url: string;
}

export interface Portal {
  /** Kaniti's store id where the chain has one; otherwise a slug of its own. */
  readonly chain: string;
  readonly brand: string;
  /** The chain's branches, from its Stores file. Empty when the chain publishes none. */
  stores(): Promise<Branch[]>;
  /** The latest full price file for one branch. */
  priceFile(storeId: string): Promise<PriceFileRef | undefined>;
  download(ref: PriceFileRef): Promise<Buffer>;
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const withTimeout = (ms: number) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };

async function getBytes(url: string, fetchImpl: typeof fetch, headers: Record<string, string> = {}, ms = 90_000): Promise<Buffer> {
  const t = withTimeout(ms);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, ...headers }, signal: t.signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { t.done(); }
}

/** Newest by the date-time stamp in the file name (…-YYYYMMDD-HHMMSS). */
const newest = <T extends { name: string }>(refs: T[]): T | undefined => [...refs].sort((a, b) => stamp(b.name).localeCompare(stamp(a.name)))[0];
const stamp = (name: string) => /(\d{8}-\d{4,6})/.exec(name)?.[1] ?? '';
/** "PriceFull7290027600007-001-756-20260911-030000.gz" → "756". */
export const storeIdOf = (name: string): string | undefined => /^(?:PriceFull|Price|PromoFull|Promo)\d+-\d+-(\d+)-/.exec(name)?.[1];

// --- Shufersal ---------------------------------------------------------------

export function shufersalPortal(fetchImpl: typeof fetch = fetch): Portal {
  const base = 'https://prices.shufersal.co.il/FileObject/UpdateCategory';
  const links = (html: string) => [...html.matchAll(/href="(https:\/\/[^"]+\.gz\?[^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  return {
    chain: 'shufersal', brand: 'שופרסל',
    async stores() {
      const html = (await getBytes(`${base}?catID=5&storeId=0`, fetchImpl, {}, 120_000)).toString('utf8');
      const url = links(html).find((u) => /\/Stores\d+/.test(u));
      return url ? parseStores(decodeXml(await getBytes(url, fetchImpl))) : [];
    },
    async priceFile(storeId) {
      const html = (await getBytes(`${base}?catID=2&storeId=${Number(storeId)}`, fetchImpl, {}, 120_000)).toString('utf8');
      const refs = links(html).filter((u) => /\/PriceFull\d+/.test(u)).map((url) => ({ chain: 'shufersal', storeId, url, name: /\/(PriceFull[^?]+)/.exec(url)?.[1] ?? url }));
      return newest(refs);
    },
    download: (ref) => getBytes(ref.url, fetchImpl),
  };
}

// --- Cerberus (publishedprices.co.il) ----------------------------------------

export const CERBERUS_CHAINS: Record<string, { user: string; brand: string }> = {
  'rami-levy': { user: 'RamiLevi', brand: 'רמי לוי' },
  'keshet-teamim': { user: 'Keshet', brand: 'קשת טעמים' },
  'tiv-taam': { user: 'TivTaam', brand: 'טיב טעם' },
  'osher-ad': { user: 'osherad', brand: 'אושר עד' },
  'yohananof': { user: 'yohananof', brand: 'יוחננוף' },
};

/** A logged-in Cerberus session: cookie jar plus the page's CSRF token. */
class Cerberus {
  #cookie = '';
  #token = '';
  readonly #fetch: typeof fetch;
  readonly user: string;
  constructor(user: string, fetchImpl: typeof fetch) { this.user = user; this.#fetch = fetchImpl; }

  async #req(path: string, init: { method?: string; body?: URLSearchParams } = {}): Promise<Response> {
    const t = withTimeout(60_000);
    try {
      const res = await this.#fetch(`https://url.publishedprices.co.il${path}`, {
        method: init.method ?? 'GET', redirect: 'manual', signal: t.signal,
        headers: { 'user-agent': UA, cookie: this.#cookie, ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        ...(init.body ? { body: init.body.toString() } : {}),
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const kv = c.split(';')[0]!; const k = kv.split('=')[0]!;
        this.#cookie = this.#cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat([kv]).join('; ');
      }
      return res;
    } finally { t.done(); }
  }
  static tokenOf(html: string): string { return /name="csrftoken"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''; }

  async login(): Promise<void> {
    if (this.#token) return;
    const t = Cerberus.tokenOf(await (await this.#req('/login')).text());
    await this.#req('/login/user', { method: 'POST', body: new URLSearchParams({ r: '', username: this.user, password: '', csrftoken: t }) });
    this.#token = Cerberus.tokenOf(await (await this.#req('/file')).text());
    if (!this.#token) throw new Error(`cerberus ${this.user}: login failed`);
  }
  async dir(search: string): Promise<{ fname: string; size: number }[]> {
    await this.login();
    const body = new URLSearchParams({ sEcho: '1', iColumns: '5', sColumns: ',,,,', iDisplayStart: '0', iDisplayLength: '2000', mDataProp_0: 'fname', mDataProp_1: 'typeLabel', mDataProp_2: 'size', mDataProp_3: 'ftime', mDataProp_4: '', sSearch: search, bRegex: 'false', cd: '/', csrftoken: this.#token });
    const res = await this.#req('/file/json/dir', { method: 'POST', body });
    const data = (await res.json().catch(() => ({}))) as { aaData?: { fname: string; size: number }[] };
    return data.aaData ?? [];
  }
  async file(name: string): Promise<Buffer> {
    await this.login();
    const res = await this.#req(`/file/d/${name}`);
    if (!res.ok) throw new Error(`cerberus ${this.user}: ${name} HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function cerberusPortal(chain: string, fetchImpl: typeof fetch = fetch): Portal {
  const meta = CERBERUS_CHAINS[chain];
  if (!meta) throw new Error(`no cerberus login for ${chain}`);
  const session = new Cerberus(meta.user, fetchImpl);
  return {
    chain, brand: meta.brand,
    async stores() {
      const latest = newest((await session.dir('Stores')).map((f) => ({ name: f.fname })));
      return latest ? parseStores(decodeXml(await session.file(latest.name))) : [];
    },
    async priceFile(storeId) {
      const files = (await session.dir('PriceFull')).map((f) => f.fname).filter((n) => { const s = storeIdOf(n); return !!s && sameStoreId(s, storeId); });
      const pick = newest(files.map((name) => ({ name })));
      return pick ? { chain, storeId, name: pick.name, url: `https://url.publishedprices.co.il/file/d/${pick.name}` } : undefined;
    },
    download: (ref) => session.file(ref.name),
  };
}

// --- Hatzi Hinam ---------------------------------------------------------------

/** `{ Results: { Branches: [{ Code, Name, Address: "street, city", Latitude, Longitude }] } }` → branches. */
export function parseHaziHinamBranches(json: string): Branch[] {
  let data: { Results?: { Branches?: { Code?: number | string; Name?: string; Address?: string; Latitude?: number; Longitude?: number; IsActive?: boolean }[] } };
  try { data = JSON.parse(json) as typeof data; } catch { return []; }
  return (data.Results?.Branches ?? []).filter((b) => b.Code !== undefined && b.IsActive !== false).map((b) => {
    const address = (b.Address ?? '').trim();
    const parts = address.split(',').map((x) => x.trim()).filter(Boolean);
    // "הרקון 2, הוד השרון" → city after the comma; without one the whole address is left for the city match.
    const city = parts.length > 1 ? parts[parts.length - 1]! : address;
    return { chainId: '7290700100008', subChainId: '000', storeId: String(b.Code), name: b.Name ?? '', address: parts.length > 1 ? parts.slice(0, -1).join(', ') : address, city, ...(typeof b.Latitude === 'number' && typeof b.Longitude === 'number' ? { lat: b.Latitude, lng: b.Longitude } : {}) };
  });
}

export function haziHinamPortal(fetchImpl: typeof fetch = fetch): Portal {
  const page = async () => (await getBytes('https://shop.hazi-hinam.co.il/Prices', fetchImpl)).toString('utf8');
  return {
    chain: 'hazi-hinam', brand: 'חצי חינם',
    async stores() {
      // No Stores file on the portal; the shop's own branch API has every branch with coordinates.
      const raw = (await getBytes('https://shop.hazi-hinam.co.il/proxy/api/Branches', fetchImpl, { accept: 'application/json', referer: 'https://shop.hazi-hinam.co.il/' })).toString('utf8');
      return parseHaziHinamBranches(raw);
    },
    async priceFile(storeId) {
      const html = await page();
      const refs = [...html.matchAll(/href="(https:\/\/[^"]+\/(PriceFull[^"/]+\.gz))"/g)].map((m) => ({ chain: 'hazi-hinam', storeId, url: m[1]!, name: m[2]! })).filter((r) => { const s = storeIdOf(r.name); return !!s && sameStoreId(s, storeId); });
      return newest(refs);
    },
    download: (ref) => getBytes(ref.url, fetchImpl),
  };
}

// --- Carrefour -----------------------------------------------------------------

/** The page embeds `const path = 'YYYYMMDD'; const files = [...]`. */
export function parseCarrefourPage(html: string): { path: string; files: { name: string }[] } {
  const path = /const path = '([^']+)'/.exec(html)?.[1] ?? '';
  const raw = /const files = (\[[\s\S]*?\]);/.exec(html)?.[1] ?? '[]';
  let files: { name: string }[] = [];
  try { files = JSON.parse(raw) as { name: string }[]; } catch { files = []; }
  return { path, files };
}

export function carrefourPortal(fetchImpl: typeof fetch = fetch): Portal {
  const base = 'https://prices.carrefour.co.il';
  const page = async () => parseCarrefourPage((await getBytes(`${base}/`, fetchImpl)).toString('utf8'));
  return {
    chain: 'carrefour', brand: 'קרפור',
    async stores() {
      const { path, files } = await page();
      const f = files.find((x) => /^Stores/.test(x.name));
      return f ? parseStores(decodeXml(await getBytes(`${base}/${path}/${f.name}`, fetchImpl))) : [];
    },
    async priceFile(storeId) {
      const { path, files } = await page();
      const refs = files.filter((x) => /^PriceFull/.test(x.name) && (() => { const s = storeIdOf(x.name); return !!s && sameStoreId(s, storeId); })()).map((x) => ({ chain: 'carrefour', storeId, name: x.name, url: `${base}/${path}/${x.name}` }));
      return newest(refs);
    },
    download: (ref) => getBytes(ref.url, fetchImpl),
  };
}

/** Every chain we can read in-store prices for. */
export function allPortals(fetchImpl: typeof fetch = fetch): Portal[] {
  return [
    shufersalPortal(fetchImpl),
    ...Object.keys(CERBERUS_CHAINS).map((c) => cerberusPortal(c, fetchImpl)),
    carrefourPortal(fetchImpl),
    haziHinamPortal(fetchImpl),
  ];
}
