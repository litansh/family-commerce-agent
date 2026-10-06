/**
 * Where each chain publishes its price files, and how to read the listing.
 *
 *   shufersal   its own portal; links into Azure blob storage (slow to list, ~30 s)
 *   cerberus    publishedprices.co.il, one login per chain (username, no password):
 *               Rami Levy, Keshet Teamim, Tiv Taam, Osher Ad, Yohananof
 *   hazi-hinam  a static page of blob links (no Stores file: branches come from elsewhere)
 *   carrefour   a page that embeds the day's file list as JSON
 *   laib        laibcatalog.co.il (Victory, Mahsanei HaShuk, H. Cohen): the page's newer UI
 *               (/mshuk/index.html) calls a JSON API (`/webapi/api/getfiles?edi=<chainId>`)
 *               that is built to carry every file of every chain, and the classic ASP.NET
 *               postback form on the front page is the same data by another route - but as of
 *               2026-09-13 both answer zero files, for all three chains, every date, every file
 *               type (ops/NEEDS-HUMAN.md): a vendor-side gap, not a request we have wrong.
 *
 * Everything here is a plain fetch: no browser, no account of ours.
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
  /** The latest full promotions file for one branch (club prices, multi-buys); undefined if the chain publishes none. */
  promoFile(storeId: string): Promise<PriceFileRef | undefined>;
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
    async promoFile(storeId) {
      const html = (await getBytes(`${base}?catID=4&storeId=${Number(storeId)}`, fetchImpl, {}, 120_000)).toString('utf8');
      const refs = links(html).filter((u) => /\/PromoFull\d+/.test(u)).map((url) => ({ chain: 'shufersal', storeId, url, name: /\/(PromoFull[^?]+)/.exec(url)?.[1] ?? url }));
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
    async promoFile(storeId) {
      const files = (await session.dir('PromoFull')).map((f) => f.fname).filter((n) => { const s = storeIdOf(n); return !!s && sameStoreId(s, storeId); });
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

const hz = (storeId: string, name: string, address: string, city: string, lat: number, lng: number): Branch => ({ chainId: '7290700100008', subChainId: '000', storeId, name, address, city, lat, lng });
export const HAZI_HINAM_BRANCHES: Branch[] = [
  hz('100', 'שרונים', 'הרקון 2', 'הוד השרון', 32.132791, 34.901797),
  hz('101', 'אם המושבות', 'ראשון לציון 1', 'פתח תקווה', 32.100134, 34.875234),
  hz('102', 'המרכבה', 'המרכבה 31', 'חולון', 32.010676, 34.808097),
  hz('103', 'הכישור', 'הכישור 22', 'חולון', 32.004699, 34.803763),
  hz('105', 'הלח"י', 'הלח"י 16', 'ראשון לציון', 31.989214, 34.762468),
  hz('106', 'הכשרת היישוב', 'הכשרת היישוב 3', 'ראשון לציון', 31.99036, 34.768398),
  hz('107', 'שוק משה לוי', 'משה לוי 8', 'ראשון לציון', 31.986406, 34.772592),
  hz('108', 'רחובות', 'דרך הים 1', 'רחובות', 31.894985, 34.79339),
];

export function haziHinamPortal(fetchImpl: typeof fetch = fetch): Portal {
  const page = async () => (await getBytes('https://shop.hazi-hinam.co.il/Prices', fetchImpl)).toString('utf8');
  return {
    chain: 'hazi-hinam', brand: 'חצי חינם',
    async stores() {
      // No Stores file on the portal; the shop's own branch API has every branch with coordinates -
      // but it answers 403 to datacenters, so from AWS the list below (read from that API on
      // 2026-09-11; the chain has eight branches and opens one every few years) stands in.
      try {
        const raw = (await getBytes('https://shop.hazi-hinam.co.il/proxy/api/Branches', fetchImpl, { accept: 'application/json', referer: 'https://shop.hazi-hinam.co.il/' })).toString('utf8');
        const live = parseHaziHinamBranches(raw);
        if (live.length) return live;
      } catch { /* fall through to the known list */ }
      return HAZI_HINAM_BRANCHES;
    },
    async priceFile(storeId) {
      const html = await page();
      const refs = [...html.matchAll(/href="(https:\/\/[^"]+\/(PriceFull[^"/]+\.gz))"/g)].map((m) => ({ chain: 'hazi-hinam', storeId, url: m[1]!, name: m[2]! })).filter((r) => { const s = storeIdOf(r.name); return !!s && sameStoreId(s, storeId); });
      return newest(refs);
    },
    async promoFile(storeId) {
      const html = await page();
      const refs = [...html.matchAll(/href="(https:\/\/[^"]+\/(PromoFull[^"/]+\.gz))"/g)].map((m) => ({ chain: 'hazi-hinam', storeId, url: m[1]!, name: m[2]! })).filter((r) => { const s = storeIdOf(r.name); return !!s && sameStoreId(s, storeId); });
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
    async promoFile(storeId) {
      const { path, files } = await page();
      const refs = files.filter((x) => /^PromoFull/.test(x.name) && (() => { const s = storeIdOf(x.name); return !!s && sameStoreId(s, storeId); })()).map((x) => ({ chain: 'carrefour', storeId, name: x.name, url: `${base}/${path}/${x.name}` }));
      return newest(refs);
    },
    download: (ref) => getBytes(ref.url, fetchImpl),
  };
}

// --- laibcatalog (Victory, Mahsanei HaShuk, H. Cohen) ------------------------

export const LAIB_CHAINS: Record<string, { chainId: string; brand: string }> = {
  'victory': { chainId: '7290696200003', brand: 'ויקטורי' },
  'mahsanei-hashuk': { chainId: '7290661400001', brand: 'מחסני השוק' },
  'h-cohen': { chainId: '7290455000004', brand: 'ח. כהן' },
};

export interface LaibFile { readonly branch: string; readonly name: string; readonly type: string; readonly date: string }

/**
 * `GET /webapi/api/getfiles?edi=<chainId>` → `[{ branchNumber, fileName, fileType, fileDate, fileSize }]`.
 * `fileType` is one of price, pricefull, promo, promofull, stores (lower case); the Stores file is branch 0.
 */
export function parseLaibFiles(json: string): LaibFile[] {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(data)) return [];
  return (data as { branchNumber?: number | string; fileName?: string; fileType?: string; fileDate?: string }[])
    .filter((f) => typeof f.fileName === 'string' && f.fileName)
    .map((f) => ({ branch: String(f.branchNumber ?? ''), name: f.fileName!, type: String(f.fileType ?? '').toLowerCase(), date: String(f.fileDate ?? '') }));
}

export function laibPortal(chain: string, fetchImpl: typeof fetch = fetch): Portal {
  const meta = LAIB_CHAINS[chain];
  if (!meta) throw new Error(`no laibcatalog chain for ${chain}`);
  const base = 'https://laibcatalog.co.il';
  // The listing is the whole chain (a few hundred entries); one fetch serves every branch of a refresh.
  let listing: { at: number; files: LaibFile[] } | undefined;
  const files = async (): Promise<LaibFile[]> => {
    if (listing && Date.now() - listing.at < 10 * 60_000) return listing.files;
    const raw = (await getBytes(`${base}/webapi/api/getfiles?edi=${meta.chainId}`, fetchImpl, { accept: 'application/json' })).toString('utf8');
    listing = { at: Date.now(), files: parseLaibFiles(raw) };
    return listing.files;
  };
  const url = (name: string) => `${base}/webapi/${meta.chainId}/${name}`;
  return {
    chain, brand: meta.brand,
    async stores() {
      const latest = newest((await files()).filter((f) => f.type === 'stores' || f.type === 'storesfull'));
      return latest ? parseStores(decodeXml(await getBytes(url(latest.name), fetchImpl))) : [];
    },
    async priceFile(storeId) {
      const refs = (await files()).filter((f) => f.type === 'pricefull' && (() => { const s = storeIdOf(f.name) ?? f.branch; return !!s && sameStoreId(s, storeId); })());
      const pick = newest(refs);
      return pick ? { chain, storeId, name: pick.name, url: url(pick.name) } : undefined;
    },
    async promoFile(storeId) {
      const refs = (await files()).filter((f) => f.type === 'promofull' && (() => { const s = storeIdOf(f.name) ?? f.branch; return !!s && sameStoreId(s, storeId); })());
      const pick = newest(refs);
      return pick ? { chain, storeId, name: pick.name, url: url(pick.name) } : undefined;
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
    ...Object.keys(LAIB_CHAINS).map((c) => laibPortal(c, fetchImpl)),
  ];
}
