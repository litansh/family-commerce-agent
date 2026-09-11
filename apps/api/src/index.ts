/**
 * The API. One Lambda, one router, every route behind Cognito.
 *
 *   GET  /me                                   who am I, which households
 *   POST /households                           { name, address }
 *   POST /households/{hid}/invites             → { code }
 *   POST /invites/{code}/accept
 *   GET  /households/{hid}/memory
 *   POST /households/{hid}/memory/confirm      { phrase, gtin, productName, brand? }
 *   POST /households/{hid}/memory/shop         { bought: PurchasedLine[] }
 *   POST /households/{hid}/suggest             { lines }   → what did we forget
 *   POST /households/{hid}/resolve             { lines }   → brand/size choices per line
 *   POST /households/{hid}/quote               { lines, address?, pickup? } → ranked options
 *
 * Authorisation is one call, `requireMember`, and it happens before any
 * household data is touched. Everything after it is scoped by construction:
 * the memory repository is built for that household id and cannot address
 * another.
 */

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  applyMemory,
  buildChoice,
  confirm,
  DEFAULT_CONSTANTS,
  optimize,
  recordShop,
  suggestMissing,
  type ListLine,
  type ProductChoice,
  type PurchasedLine,
  regionOf,
  normalizeBrand,
  importHistory,
  applyCoupons,
  type Coupon,
  type StorefrontQuote,
} from '@fca/domain';
import { DynamoMemoryRepository, VersionConflict } from '@fca/memory-store';
import { quoteWithFallback } from '@fca/shopping-agent';
import { etaForStorefront, woltEtasNear, type CatalogProvider, type Promotion } from '@fca/retailer-connectors';
import { callerOf, HttpError } from './auth.ts';
import { HouseholdStore } from './households.ts';
import { providersFor } from './providers.ts';
import { productDetail } from './product-detail.ts';
import { ImageResolver } from '@fca/product-images';
import { ImportStore, OrderStore, readRow, writeRow } from './orders.ts';
import { StoreSessionStore } from './store-sessions.ts';
import { ConnectFailed, driverFor, localPhone, type PastOrderRaw, type StoreSession } from '@fca/cloud-connectors';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';

/**
 * Rank catalogue candidates for one household: what they have bought first,
 * then brands they buy, then how widely the product is stocked. Memory-driven,
 * so the order sharpens with every completed shop.
 */
function rankForHousehold<T extends { gtin?: string; brand?: string; pricedAtChains: number }>(items: T[], memory: { products: Record<string, { gtin: string; brand?: string; orderCount: number }> }): T[] {
  const bought = new Map<string, number>();
  const brands = new Set<string>();
  for (const p of Object.values(memory.products)) { bought.set(p.gtin, p.orderCount); if (p.brand) brands.add(normalizeBrand(p.brand) ?? p.brand); }
  const score = (c: T) => (c.gtin && bought.has(c.gtin) ? 1000 + (bought.get(c.gtin) ?? 0) * 10 : 0) + (c.brand && brands.has(normalizeBrand(c.brand) ?? c.brand) ? 100 : 0) + c.pricedAtChains;
  return [...items].sort((a, b) => score(b) - score(a));
}

/** The store map: aisle → sub-aisles → catalogue queries. */
const AISLES: Record<string, { key: string; queries: string[] }[]> = {
  dairy: [
    { key: 'milk', queries: ['חלב 3%', 'חלב 1%', 'חלב בשקית', 'חלב ללא לקטוז', 'חלב סויה', 'חלב שקדים'] },
    { key: 'cheese', queries: ['גבינה צהובה', 'גבינה לבנה', 'קוטג', 'גבינת שמנת', 'גבינה בולגרית', 'מוצרלה', 'גבינת עיזים', 'פרמזן'] },
    { key: 'yogurt', queries: ['יוגורט', 'יוגורט ביו', 'מעדן', 'אקטימל', 'פרו', 'יוגורט יווני'] },
    { key: 'butter', queries: ['חמאה', 'מרגרינה', 'שמנת מתוקה', 'שמנת חמוצה', 'שמנת להקצפה'] },
    { key: 'eggs', queries: ['ביצים', 'ביצים חופש', 'ביצים אורגניות'] },
  ],
  produce: [
    { key: 'vegetables', queries: ['עגבניות', 'מלפפונים', 'בצל', 'תפוחי אדמה', 'גזר', 'פלפל', 'חסה', 'כרוב', 'ברוקולי', 'קישוא', 'חציל', 'בטטה', 'שום', 'כרובית'] },
    { key: 'fruit', queries: ['בננות', 'תפוחים', 'תפוזים', 'אבוקדו', 'לימון', 'ענבים', 'אבטיח', 'מלון', 'תותים', 'אגסים', 'קלמנטינות', 'מנגו'] },
    { key: 'herbs', queries: ['פטרוזיליה', 'כוסברה', 'שמיר', 'נענע', 'בזיליקום', 'בצל ירוק'] },
  ],
  bakery: [
    { key: 'bread', queries: ['לחם אחיד', 'לחם קל', 'לחם מלא', 'לחם כוסמין', 'לחם שיפון', 'לחם פרוס'] },
    { key: 'pita', queries: ['פיתות', 'לאפה', 'טורטיה', 'לחמניות', 'חלה', 'בייגלה'] },
    { key: 'pastry', queries: ['קרואסון', 'עוגה', 'עוגיות', 'בורקס', 'רוגלך'] },
  ],
  meat: [
    { key: 'chicken', queries: ['חזה עוף', 'כרעיים', 'שוקיים', 'כנפיים', 'פרגיות', 'שניצל עוף', 'עוף שלם'] },
    { key: 'beef', queries: ['בשר טחון', 'אנטריקוט', 'סטייק', 'צלי', 'אסאדו', 'קבב', 'המבורגר'] },
    { key: 'fish', queries: ['סלמון', 'טונה', 'דניס', 'אמנון', 'לברק', 'פילה דג', 'סרדינים'] },
    { key: 'deli', queries: ['נקניק', 'פסטרמה', 'נקניקיות', 'הודו מעושן', 'סלמי'] },
  ],
  pantry: [
    { key: 'rice_pasta', queries: ['אורז', 'פסטה', 'ספגטי', 'קוסקוס', 'פתיתים', 'בורגול', 'קינואה', 'אטריות'] },
    { key: 'canned', queries: ['רסק עגבניות', 'טונה בשמן', 'תירס', 'זיתים', 'שעועית', 'חומוס בשימורים', 'אפונה', 'מלפפון חמוץ'] },
    { key: 'oils', queries: ['שמן זית', 'שמן קנולה', 'חומץ', 'קטשופ', 'מיונז', 'חרדל', 'טחינה', 'סויה'] },
    { key: 'baking', queries: ['סוכר', 'קמח', 'מלח', 'אבקת אפייה', 'שוקולד למריחה', 'דבש', 'ריבה', 'שמרים'] },
    { key: 'breakfast', queries: ['קורנפלקס', 'גרנולה', 'שיבולת שועל', 'דגני בוקר', 'קפה נמס', 'קפה טורקי', 'תה', 'קקאו'] },
    { key: 'snacks', queries: ['במבה', 'ביסלי', 'חטיף', 'שוקולד', 'עוגיות', 'קרקרים', 'פיצוחים', 'תפוצ׳יפס'] },
    { key: 'legumes', queries: ['עדשים', 'חומוס יבש', 'שעועית לבנה', 'גרגרי חומוס'] },
  ],
  frozen: [
    { key: 'frozen_meals', queries: ['פיצה קפואה', 'שניצל תירס', 'מלאווח', 'בורקס קפוא', 'ג׳חנון'] },
    { key: 'frozen_veg', queries: ['ירקות קפואים', 'אפונה קפואה', 'צ׳יפס', 'תירס קפוא', 'שעועית ירוקה קפואה'] },
    { key: 'ice_cream', queries: ['גלידה', 'ארטיק', 'שלגון', 'קרטיב'] },
  ],
  drinks: [
    { key: 'water_soft', queries: ['מים מינרליים', 'קוקה קולה', 'ספרייט', 'סודה', 'פאנטה', 'משקה אנרגיה'] },
    { key: 'juice', queries: ['מיץ תפוזים', 'מיץ תפוחים', 'פריגת', 'מיץ ענבים', 'לימונדה'] },
    { key: 'hot', queries: ['קפה נמס', 'קפה טורקי', 'תה', 'תה ירוק', 'שוקו'] },
    { key: 'alcohol', queries: ['בירה', 'יין אדום', 'יין לבן', 'ערק', 'וודקה'] },
  ],
  baby: [
    { key: 'diapers', queries: ['חיתולים', 'פמפרס', 'האגיס', 'חיתולי שחייה'] },
    { key: 'wipes', queries: ['מגבונים', 'מגבונים לחים', 'קרם החתלה'] },
    { key: 'formula', queries: ['מטרנה', 'סימילאק', 'נוטרילון', 'דייסה לתינוקות', 'מחית'] },
  ],
  household: [
    { key: 'paper', queries: ['נייר טואלט', 'מגבות נייר', 'טישו', 'מפיות'] },
    { key: 'cleaning', queries: ['אקונומיקה', 'סבון כלים', 'טבליות למדיח', 'נוזל רצפות', 'מסיר שומנים', 'ספריי ניקוי'] },
    { key: 'laundry', queries: ['אבקת כביסה', 'ג׳ל כביסה', 'מרכך כביסה', 'מסיר כתמים'] },
    { key: 'bags', queries: ['שקיות אשפה', 'שקיות זיפ', 'נייר אפייה', 'נייר אלומיניום', 'ניילון נצמד'] },
    { key: 'personal', queries: ['שמפו', 'מרכך שיער', 'סבון גוף', 'משחת שיניים', 'מברשת שיניים', 'דאודורנט'] },
  ],
};
const households = new HouseholdStore(TABLE);
const images = new ImageResolver(TABLE);
const orders = new OrderStore(TABLE, process.env['ORDERS_QUEUE'] ?? '');
const imports = new ImportStore(TABLE, process.env['ORDERS_QUEUE'] ?? '');
const sessions = new StoreSessionStore(TABLE);

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export async function handler(event: Event): Promise<APIGatewayProxyResultV2> {
  // The browser's CORS preflight carries no token and must succeed without
  // one. API Gateway adds the Access-Control-* headers on the way out.
  if (event.requestContext.http.method === 'OPTIONS') return { statusCode: 204 };
  try {
    const caller = callerOf(event);
    const method = event.requestContext.http.method;
    const path = event.rawPath.replace(/\/+$/, '') || '/';
    const body = event.body ? (JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) as Record<string, unknown>) : {};
    const seg = path.split('/').filter(Boolean);

    // --- identity & households ------------------------------------------
    if (method === 'GET' && path === '/me') {
      return ok({ userId: caller.userId, email: caller.email, households: await households.listForUser(caller.userId) });
    }
    if (method === 'POST' && path === '/households') {
      const name = str(body['name'], 'name');
      const address = str(body['address'], 'address');
      const country = regionOf(typeof body['country'] === 'string' ? body['country'] : undefined).country;
      const created = await households.create(caller.userId, caller.email, name, address, country);
      const retailers = Array.isArray(body['retailers']) ? (body['retailers'] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;
      const fulfillment = (['delivery', 'pickup', 'either'] as const).find((f) => f === body['fulfillment']);
      const addressDetails = typeof body['addressDetails'] === 'object' && body['addressDetails'] ? (body['addressDetails'] as Record<string, unknown>) : undefined;
      const language = typeof body['language'] === 'string' ? body['language'] : undefined;
      return ok(await households.update(created.id, { ...(retailers ? { retailers } : {}), ...(fulfillment ? { fulfillment } : {}), ...(addressDetails ? { addressDetails } : {}), ...(language ? { language } : {}) }), 201);
    }
    if (method === 'POST' && seg[0] === 'invites' && seg[2] === 'accept' && seg[1]) {
      return ok(await households.acceptInvite(seg[1], caller.userId, caller.email));
    }

    // Address autocomplete: Israeli streets in Hebrew, via OpenStreetMap's
    // Nominatim. Verified means the geocoder found the street and number.
    if (method === 'GET' && path === '/geo/suggest') {
      const q = (event.queryStringParameters?.['q'] ?? '').trim();
      if (q.length < 3) return ok({ suggestions: [] });
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=il&accept-language=he&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'user-agent': 'kaniti/0.1 (contact: litansh@gmail.com)' } }).catch(() => null);
      if (!res?.ok) return ok({ suggestions: [] });
      const rows = (await res.json()) as { display_name: string; lat: string; lon: string; address?: Record<string, string> }[];
      const suggestions = rows.map((r) => {
        const a = r.address ?? {};
        const street = a['road'] ?? a['pedestrian'] ?? '';
        const number = a['house_number'] ?? '';
        const city = a['city'] ?? a['town'] ?? a['village'] ?? a['municipality'] ?? '';
        return { street, number, city, label: [street, number].filter(Boolean).join(' ') + (city ? `, ${city}` : ''), lat: Number(r.lat), lng: Number(r.lon), verified: !!street && !!number && !!city };
      }).filter((x) => x.street);
      return ok({ suggestions });
    }

    // --- everything below is scoped to one household ---------------------
    if (seg[0] !== 'households' || !seg[1]) throw new HttpError(404, 'not found');
    const hid = seg[1];
    await households.requireMember(hid, caller.userId); // the authorisation check
    const household = await households.get(hid);
    if (!household) throw new HttpError(404, 'household not found');
    const repo = new DynamoMemoryRepository(hid, TABLE);
    const rest = seg.slice(2).join('/');
    const region = regionOf(household.country);
    const providers = providersFor(region);
    const requirePricing = () => {
      if (!providers) throw new HttpError(422, `pricing is not available in ${region.country} yet`);
      return providers;
    };

    if (method === 'POST' && rest === 'invites') return ok(await households.createInvite(hid), 201);

    // --- connecting stores (ADR 0008) ------------------------------------
    // One ladder: a session captured on the phone, a one-time code, or a
    // password used once. Every rung ends in the store's own signed-in check
    // and a sealed session row. Bodies here are never logged.
    if (method === 'GET' && rest === 'stores/connections') return ok({ connections: await sessions.list(hid) });
    if (seg[2] === 'stores' && seg[3] && seg[4]) {
      const store = seg[3];
      const action = seg.slice(4).join('/');
      const driver = driverFor(store);
      const connected = (method: 'device' | 'otp' | 'password', session: StoreSession) => sessions.put(hid, store, session, method).then(() => ok({ connected: true, method }));
      const fail = (e: unknown): never => {
        if (e instanceof ConnectFailed) throw new HttpError(e.reason === 'unavailable' || e.reason === 'blocked' ? 502 : 401, e.reason);
        throw e;
      };
      if (method === 'POST' && action === 'connect') {
        const how = str(body['method'], 'method');
        if (how === 'otp') {
          if (!driver?.startOtp || !driver.verifyOtp || !driver.otp) throw new HttpError(422, 'no_otp');
          const target = driver.otp === 'phone' ? localPhone(str(body['phone'], 'phone')) : str(body['email'], 'email').trim().toLowerCase();
          if (!target) throw new HttpError(400, 'bad_phone');
          const challenge = await driver.startOtp(target).catch(fail);
          return ok({ challengeId: await sessions.putChallenge(hid, store, challenge), sentTo: challenge.sentTo });
        }
        if (how === 'password') {
          if (!driver?.passwordLogin) throw new HttpError(422, 'no_password');
          const session = await driver.passwordLogin(str(body['email'], 'email').trim(), str(body['password'], 'password')).catch(fail);
          return connected('password', session);
        }
        throw new HttpError(400, 'method must be otp or password');
      }
      if (method === 'POST' && action === 'connect/verify') {
        if (!driver?.verifyOtp) throw new HttpError(422, 'no_otp');
        const id = str(body['challengeId'], 'challengeId');
        const challenge = await sessions.takeChallenge(hid, store, id);
        const session = await driver.verifyOtp(challenge, str(body['code'], 'code').replace(/\D/g, '')).catch(fail);
        await sessions.dropChallenge(hid, id);
        return connected('otp', session);
      }
      if (method === 'POST' && action === 'session') {
        // The phone captured the store's cookie jar after a sign-in in its WebView.
        const cookies = arr<{ name?: string; value?: string; domain?: string; path?: string }>(body['cookies'], 'cookies')
          .filter((c) => typeof c.name === 'string' && typeof c.value === 'string')
          .map((c) => ({ name: c.name!, value: c.value!, ...(c.domain ? { domain: c.domain } : {}), ...(c.path ? { path: c.path } : {}) }));
        const tokens = body['tokens'] && typeof body['tokens'] === 'object' ? Object.fromEntries(Object.entries(body['tokens'] as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)])) : undefined;
        if (cookies.length === 0 && !tokens) throw new HttpError(400, 'no session in body');
        const session: StoreSession = { retailer: store, cookies, capturedAt: new Date().toISOString(), ...(typeof body['userAgent'] === 'string' ? { userAgent: body['userAgent'] } : {}), ...(tokens ? { tokens } : {}) };
        // The phone already ran the store's own signed-in check, and from AWS
        // the stores answer with block pages (ADR 0008 amendment) - so the
        // cloud keeps the jar as the family's "connected" marker and does not
        // second-guess it.
        return connected('device', session);
      }
      if (method === 'DELETE' && action === 'connection') { await sessions.remove(hid, store); return ok({ connected: false }); }
      if (method === 'GET' && action === 'connection') {
        const session = await sessions.get(hid, store);
        return ok({ connected: !!session });
      }
      if (method === 'POST' && action === 'import') {
        const { catalog } = requirePricing();
        if (!driver?.orderHistory) throw new HttpError(422, 'no_cloud_history');
        const session = await sessions.get(hid, store);
        if (!session) throw new HttpError(404, 'not_connected');
        let raw: PastOrderRaw[];
        try { raw = await driver.orderHistory(session, 20); } catch (e) { if (e instanceof Error && e.name === 'SessionExpired') throw new HttpError(401, 'session_expired'); throw e; }
        console.log('cloud-import', JSON.stringify({ hid, store, orders: raw.length }));
        return ok(await importRawOrders(hid, catalog, raw));
      }
    }

    // --- ordering through Kaniti -----------------------------------------
    // The API only records intent and forwards a job; the worker at home does
    // the retailer work and writes progress here. Approval is a row update
    // with a fresh token the worker must present before placing the order.
    if (method === 'POST' && rest === 'orders') {
      // Either { retailer, lines } for one store or { legs: [{ retailer, lines }] } for a split.
      const legs = Array.isArray(body['legs'])
        ? (body['legs'] as { retailer?: unknown; lines?: unknown }[]).map((l) => ({ retailer: str(l.retailer, 'legs[].retailer'), lines: toLines(l.lines) }))
        : [{ retailer: str(body['retailer'], 'retailer'), lines: toLines(body['lines']) }];
      return ok(await orders.create(hid, caller.userId, legs), 201);
    }
    if (method === 'GET' && seg[2] === 'orders' && seg[3] && !seg[4]) return ok(await orders.get(hid, seg[3]));
    if (method === 'POST' && seg[2] === 'orders' && seg[3] && seg[4] === 'approve') return ok(await orders.approve(hid, seg[3], caller.userId));
    if (method === 'POST' && seg[2] === 'orders' && seg[3] && seg[4] === 'cancel') return ok(await orders.cancel(hid, seg[3]));
    if (method === 'GET' && rest === 'orders') return ok({ orders: await orders.list(hid) });

    // Browse like a store. An aisle has sub-aisles (milk, cheeses, yogurts…);
    // each sub-aisle is a set of catalogue queries merged into one deep page.
    // The catalogue itself is every chain's published range (~255k products);
    // this is only how a person walks it.
    if (method === 'GET' && rest === 'aisles') return ok({ aisles: Object.entries(AISLES).map(([key, subs]) => ({ key, subs: subs.map((x) => x.key) })) });
    if (method === 'GET' && rest === 'browse') {
      const { catalog } = requirePricing();
      const aisle = (event.queryStringParameters?.['aisle'] ?? '').trim();
      const sub = (event.queryStringParameters?.['sub'] ?? '').trim();
      const page = Math.max(0, Number(event.queryStringParameters?.['page'] ?? 0) || 0);
      const subs = AISLES[aisle];
      if (!subs) return ok({ products: [], subs: [] });
      const chosen = subs.find((x) => x.key === sub) ?? subs[0]!;
      const results = await Promise.all(chosen.queries.map((q) => catalog.searchProducts({ query: q, limit: 20, location: household.address }).catch(() => [])));
      const seen = new Set<string>();
      const memory = await repo.load();
      const all = rankForHousehold(results.flat().filter((c) => c.pricedAtChains > 0 && !seen.has(c.productId) && seen.add(c.productId)), memory);
      const PAGE = 24;
      const slice = all.slice(page * PAGE, page * PAGE + PAGE);
      const [imgs, ranges] = await Promise.all([
        images.cachedMany(slice.map((c) => ({ key: c.productId, name: c.name, ...(c.gtin ? { gtin: c.gtin } : {}) }))),
        Promise.all(slice.map((c) => (c.gtin ? readRow(TABLE, 'CATALOG', `PRICE#${c.gtin}`) : Promise.resolve(undefined)))),
      ]);
      const products = slice.map((c, i) => {
        const r = ranges[i] as { min?: number; max?: number } | undefined;
        return { ...c, imageUrl: imgs[c.productId]?.url ?? null, ...(r?.min !== undefined && r.max !== undefined ? { priceMin: r.min, priceMax: r.max } : {}), bought: !!c.gtin && !!Object.values(memory.products).find((p) => p.gtin === c.gtin) };
      });
      return ok({ aisle, sub: chosen.key, subs: subs.map((x) => x.key), page, total: all.length, hasMore: all.length > (page + 1) * PAGE, products });
    }

    // Deals across every store nearby — not only connected ones — with the
    // household's own products first. The promotions feed is cached six
    // hours under a catalogue-wide key; ranking against memory is per
    // request and free.
    // Which storefronts deliver to this household - the list the person sees
    // as "stores near you". Cached a day per address.
    if (method === 'GET' && rest === 'stores') {
      const { catalog } = requirePricing();
      const key = `STORES#${Buffer.from(household.address).toString('base64url').slice(0, 80)}`;
      const cached = (await readRow(TABLE, 'CATALOG', key)) as { storefronts?: unknown[]; at?: string } | undefined;
      if (cached?.storefronts?.length && cached.at && Date.now() - Date.parse(cached.at) < 24 * 3600_000) return ok({ storefronts: cached.storefronts });
      const storefronts = catalog.listStorefronts ? await catalog.listStorefronts(household.address).catch(() => []) : [];
      if (storefronts.length) await writeRow(TABLE, 'CATALOG', key, { storefronts, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 3 * 86400 });
      return ok({ storefronts });
    }

    if (method === 'GET' && rest === 'deals') {
      const { catalog } = requirePricing();
      const cached = (await readRow(TABLE, 'CATALOG', 'PROMOS')) as { promos?: Promotion[]; at?: string } | undefined;
      let promos: readonly Promotion[] = cached?.promos ?? [];
      if (!promos.length || !cached?.at || Date.now() - Date.parse(cached.at) > 6 * 3600_000) {
        // The feed caps at 200, ordered by soonest end - the ones worth acting on this week.
        const fresh = catalog.listPromotions ? await catalog.listPromotions(200).catch(() => null) : null;
        if (fresh?.length) {
          // Retailers describe promotions in till-speak ("קטיף 5.90 רימון-מות-299ישיר");
          // the catalogue knows the product's real name. Resolve once per refresh,
          // for the strongest deals, and keep the names with the cache.
          const top = [...fresh].sort((a, b) => b.discountRate - a.discountRate).slice(0, 80);
          const named = await Promise.all(top.map(async (p) => {
            const gtin = p.itemCodes.find((c) => /^\d{8,14}$/.test(c));
            if (!gtin) return p;
            const hit = (await catalog.searchProducts({ query: gtin, gtin, limit: 1 }).catch(() => []))[0];
            // Till-speak cleanup: "2ב30 מגבוני האגיס 56*4 -מות-75ישיר" → "מגבוני האגיס 56*4".
            const cleaned = p.description
              .replace(/^קו קופה\s*-?\s*/, '').replace(/^קטיף\s+/, '').replace(/^\d+ב\d+(\.\d+)?\s*/, '').replace(/^\d+(\.\d+)?\s+/, '')
              .replace(/\s*-?\s*(מות|LU|XPO)?\s*-?\s*\d*\s*ישיר\s*$/, '').replace(/\s+ב\s*\d+(\.\d+)?\s*$/, '').replace(/\s{2,}/g, ' ').trim();
            const catalogName = hit?.name?.trim() ?? '';
            // The catalogue sometimes truncates ("לה מ"); take whichever reads as a full name.
            const name = catalogName.length >= 14 || cleaned.length < 6 ? catalogName || cleaned : cleaned;
            return name ? { ...p, description: name } : p;
          }));
          const byId = new Map(named.map((p) => [p.itemCodes.join(',') + p.chainName, p]));
          promos = fresh.map((p) => byId.get(p.itemCodes.join(',') + p.chainName) ?? p);
          await writeRow(TABLE, 'CATALOG', 'PROMOS', { promos, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 2 * 86400 });
        }
      }
      const memory = await repo.load();
      const usual = new Map(Object.values(memory.products).map((p) => [p.gtin, p]));
      const now = Date.now();
      const seen = new Set<string>();
      const ranked = promos.flatMap((p) => {
        if (p.discountRate < 8 || (p.endTs && Date.parse(p.endTs) < now)) return [];
        const gtin = p.itemCodes.find((c) => /^\d{8,14}$/.test(c));
        if (!gtin) return [];
        const key = `${gtin}|${p.chainName}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const u = usual.get(gtin);
        const name = u?.productName ?? p.description.replace(/^קו קופה\s*-\s*/, '').trim();
        if (!name) return [];
        return [{ gtin, name, ...(u?.brand ? { brand: u.brand } : {}), chainName: p.chainName, price: Math.round(p.discountedPrice * 100), discountRate: p.discountRate, clubOnly: p.clubOnly, endTs: p.endTs, usual: !!u, score: (u ? 1000 : 0) + p.discountRate }];
      }).sort((a, b) => b.score - a.score).slice(0, 40);
      const imgs = await images.cachedMany(ranked.map((d) => ({ key: d.gtin, name: d.name, gtin: d.gtin })));
      return ok({ deals: ranked.map(({ score: _s, ...d }) => ({ ...d, imageUrl: imgs[d.gtin]?.url ?? null })) });
    }

    // Import order history captured on the device: the phone's logged-in
    // WebView fetched the account's past orders (same-origin, its own
    // session) and posts them here. The server resolves product names to
    // barcodes through the catalogue and replays them into memory, dated -
    // so 'your usuals' exist without any home worker or stored session.
    if (method === 'POST' && rest === 'import-history') {
      const { catalog } = requirePricing();
      const raw = arr<{ at?: string; lines?: { name?: string; code?: string; qty?: number }[] }>(body['orders'], 'orders');
      // The phone's diagnostic of what the store returned - the only window we
      // have into a session that lives on the device.
      console.log('import-history', JSON.stringify({ hid, retailer: body['retailer'], orders: raw.length, lines: raw.reduce((n, o) => n + (o.lines?.length ?? 0), 0), diag: body['diag'] ?? null }));
      return ok(await importRawOrders(hid, catalog, raw));
    }

    // Pictures for a set of barcodes, resolved within a time budget so the
    // grid never waits on them. The app calls this right after rendering.
    if (method === 'POST' && rest === 'images') {
      const gtins = arr<string>(body['gtins'], 'gtins').filter((g) => typeof g === 'string').slice(0, 40);
      const found = await images.resolveMany(gtins.map((g) => ({ key: g, gtin: g })), 10, 12_000);
      return ok({ images: Object.fromEntries(gtins.map((g) => [g, found[g]?.url ?? null])) });
    }

    // One product, every chain that carries it. The catalogue's canonical
    // record keyed by barcode; the "why Kaniti" moment on a product sheet.
    if (method === 'GET' && rest === 'product') {
      requirePricing();
      const gtin = (event.queryStringParameters?.['gtin'] ?? '').trim();
      if (!gtin) throw new HttpError(400, 'gtin is required');
      const { quote: qp } = requirePricing();
      const [detail, img, prices] = await Promise.all([
        productDetail(gtin),
        images.resolve({ gtin }),
        chainPrices(gtin, household.address, qp),
      ]);
      return ok({ ...(detail ?? { gtin, name: '', listings: [] }), imageUrl: img?.url ?? null, prices, ...(prices.length ? { priceMin: Math.min(...prices.map((p) => p.price)), priceMax: Math.max(...prices.map((p) => p.price)) } : {}) });
    }

    // Search-as-you-type: catalogue candidates with pictures. Cheap and
    // interactive, so it is a GET with a short limit.
    if (method === 'GET' && rest === 'search') {
      const { catalog } = requirePricing();
      const q = (event.queryStringParameters?.['q'] ?? '').trim();
      const gtin = (event.queryStringParameters?.['gtin'] ?? '').trim();
      if (!gtin && q.length < 2) return ok({ products: [] });
      const found = gtin
        ? await catalog.searchProducts({ query: gtin, gtin, limit: 4, location: household.address })
        : await catalog.searchProducts({ query: q, limit: 12, location: household.address });
      const buyable = rankForHousehold(found.filter((c) => c.pricedAtChains > 0), await repo.load()).slice(0, 14);
      const imgs = await images.cachedMany(buyable.map((c) => ({ key: c.productId, name: c.name, ...(c.gtin ? { gtin: c.gtin } : {}) })));
      return ok({ products: buyable.map((c) => ({ ...c, imageUrl: imgs[c.productId]?.url ?? null })) });
    }
    if (method === 'GET' && rest === 'region') return ok(region);
    if (method === 'GET' && rest === 'worker') {
      const w = await readRow(TABLE, hid, 'WORKER') as { lastSeen?: string; linked?: Record<string, boolean> } | undefined;
      const online = !!w?.lastSeen && Date.now() - Date.parse(w.lastSeen) < 120_000;
      return ok({ online, lastSeen: w?.lastSeen ?? null, linked: w?.linked ?? {} });
    }
    if (method === 'GET' && rest === '') return ok(household);
    if (method === 'PATCH' && rest === '') {
      const retailers = Array.isArray(body['retailers']) ? (body['retailers'] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;
      const fulfillment = (['delivery', 'pickup', 'either'] as const).find((f) => f === body['fulfillment']);
      return ok(await households.update(hid, { ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}), ...(typeof body['address'] === 'string' ? { address: body['address'] } : {}), ...(retailers ? { retailers } : {}), ...(fulfillment ? { fulfillment } : {}) }));
    }
    if (method === 'POST' && rest === 'imports') return ok(await imports.request(hid, str(body['retailer'], 'retailer')), 202);
    if (method === 'GET' && seg[2] === 'imports' && seg[3]) return ok(await imports.status(hid, seg[3]));
    if (method === 'GET' && rest === 'memory') return ok(await repo.load());

    if (method === 'POST' && rest === 'memory/confirm') {
      const saved = await repo.save(
        confirm(await repo.load(), {
          phrase: str(body['phrase'], 'phrase'),
          gtin: str(body['gtin'], 'gtin'),
          productName: str(body['productName'], 'productName'),
          ...(typeof body['brand'] === 'string' ? { brand: body['brand'] } : {}),
        }),
      );
      return ok({ version: saved.version, product: saved.products[Object.keys(saved.products).at(-1) ?? ''] });
    }

    if (method === 'POST' && rest === 'memory/shop') {
      const bought = arr<PurchasedLine>(body['bought'], 'bought');
      const saved = await repo.save(recordShop(await repo.load(), bought));
      return ok({ version: saved.version, recorded: bought.length });
    }

    if (method === 'POST' && rest === 'suggest') {
      const lines = toLines(body['lines']);
      return ok({ suggestions: suggestMissing(await repo.load(), lines) });
    }

    if (method === 'POST' && rest === 'resolve') {
      const { catalog } = requirePricing();
      const memory = await repo.load();
      const applied = applyMemory(toLines(body['lines']), memory);
      const choices: Record<string, ProductChoice | null> = {};
      await Promise.all(
        applied.map(async ({ line, fromMemory }) => {
          const [branded, open] = await Promise.all([
            line.brand ? catalog.searchProducts({ query: line.query, brand: line.brand, limit: 12, location: household.address }) : [],
            catalog.searchProducts({ query: line.query, limit: 16, location: household.address }),
          ]);
          const merged = [...new Map([...branded, ...open].map((p) => [p.productId, p])).values()];
          const c = buildChoice(merged, {
            lineId: line.id, query: line.query,
            ...(line.brand ? { requestedBrand: line.brand } : {}),
            ...(line.gtin ? { requestedGtin: line.gtin } : {}),
          });
          choices[line.id] = c ? { ...c, source: fromMemory ? 'memory' : c.source } : null;
        }),
      );
      return ok({ choices, fromMemory: applied.filter((a) => a.fromMemory).map((a) => a.line.id) });
    }

    if (method === 'POST' && rest === 'quote') {
      const { quote: quoteProvider } = requirePricing();
      const memory = await repo.load();
      const applied = applyMemory(toLines(body['lines']), memory);
      const lines = applied.map((a) => a.line);
      const res = await quoteWithFallback(
        quoteProvider,
        {
          lines,
          address: typeof body['address'] === 'string' ? body['address'] : household.address,
          serviceType: body['pickup'] === true || (body['pickup'] === undefined && household.fulfillment === 'pickup') ? 'pickup' : 'delivery',
        },
        memory,
      );
      // Personal coupons the worker read from the family's accounts change
      // which chain wins; apply them before ranking.
      const couponRows = await Promise.all((household.retailers ?? []).map(async (r) => (await readRow(TABLE, hid, `COUPONS#${r}`)) as { coupons?: Coupon[] } | undefined));
      const coupons = couponRows.flatMap((r) => r?.coupons ?? []);
      const couponed: StorefrontQuote[] = res.quotes.map((q) => applyCoupons(q, coupons));
      const result = optimize({ quotes: couponed, constants: DEFAULT_CONSTANTS, requestedLineIds: lines.map((l) => l.id) });
      const couponSavings = Object.fromEntries(couponed.map((q) => [q.storefrontId, (q as { couponSavings?: number }).couponSavings ?? 0]));
      const bestId = result.options[0]?.legs[0]?.storefrontId;
      const bestLines = res.quotes.find((q) => q.storefrontId === bestId)?.lines ?? [];
      const imgs = await images.resolveMany(bestLines.map((l) => ({ key: l.lineId, name: l.productName, ...(l.gtin ? { gtin: l.gtin } : {}) })));
      const quotedLines = Object.fromEntries(bestLines.map((l) => [l.lineId, { gtin: l.gtin, productName: l.productName, link: l.link, imageUrl: imgs[l.lineId]?.url ?? null }]));
      // How soon each storefront can deliver, next to its price: Wolt venues answer live
      // (minutes, from Wolt's own feed for the family's address); the chains deliver in
      // windows, which the phone reads from each store once it is connected.
      const ad = (household.addressDetails ?? {}) as { lat?: number; lng?: number };
      const etas: Record<string, { kind: 'live' | 'slots'; minutes?: number; range?: string; name?: string }> = {};
      const wolt = typeof ad.lat === 'number' && typeof ad.lng === 'number' ? await woltEtasNear(ad.lat, ad.lng) : {};
      const noteEta = (sid: string) => {
        if (etas[sid]) return;
        const w = etaForStorefront(sid, wolt);
        etas[sid] = w && w.online && w.delivers ? { kind: 'live', minutes: w.minutes, ...(w.range ? { range: w.range } : {}), name: w.name } : { kind: 'slots' };
      };
      for (const o of result.options) for (const leg of o.legs) noteEta(leg.storefrontId);
      // Rejected storefronts too: "Wolt in 40 minutes, but ₪60 short of its minimum" is a real choice.
      for (const r of result.rejected) noteEta(r.storefrontId);
      // Each storefront's own resolution of every line (its product, its deep link), for the
      // stores the compare shows - so an order at any store opens that store's pages, not the winner's.
      const shownIds = new Set<string>([...result.options.flatMap((o) => o.legs.map((l) => l.storefrontId)), ...result.rejected.map((r) => r.storefrontId)]);
      const storefrontLines: Record<string, Record<string, { gtin?: string; productName: string; link?: string }>> = {};
      for (const q of res.quotes) if (shownIds.has(q.storefrontId)) storefrontLines[q.storefrontId] = Object.fromEntries(q.lines.map((l) => [l.lineId, { ...(l.gtin ? { gtin: l.gtin } : {}), productName: l.productName, ...(l.link ? { link: l.link } : {}) }]));
      return ok({
        currency: region.currency,
        etas,
        storefrontLines,
        lines,
        fromMemory: applied.filter((a) => a.fromMemory).map((a) => a.line.id),
        options: result.options,
        couponSavings,
        rejected: result.rejected,
        warnings: result.warnings,
        assumptions: res.assumptions,
        quotedLines,
        suggestions: suggestMissing(memory, lines),
      });
    }

    throw new HttpError(404, 'not found');
  } catch (e) {
    if (e instanceof HttpError) return { statusCode: e.status, headers: JSON_H, body: JSON.stringify({ error: e.message }) };
    if (e instanceof VersionConflict) return { statusCode: 409, headers: JSON_H, body: JSON.stringify({ error: e.message }) };
    if (e instanceof SyntaxError) return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'invalid JSON' }) };
    console.error(e);
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ error: 'internal error' }) };
  }
}

/**
 * Past orders, as a store reports them (names, maybe barcodes, quantities),
 * resolved to the catalogue and replayed into the household's memory, dated.
 * Shared by the phone's on-device import and the cloud's session import.
 */
async function importRawOrders(hid: string, catalog: CatalogProvider, raw: { at?: string; lines?: { name?: string; code?: string; qty?: number }[] }[]): Promise<{ orders: number; products: number }> {
  const cache = new Map<string, { gtin: string; productName: string; brand?: string } | null>();
  const orders: { at: string; lines: { phrase: string; gtin: string; productName: string; brand?: string; packQty?: number }[] }[] = [];
  for (const o of raw.slice(0, 40)) {
    const lines = [];
    for (const l of (o.lines ?? []).slice(0, 60)) {
      const name = (l.name ?? '').trim();
      if (!name) continue;
      if (l.code && /^\d{8,14}$/.test(l.code)) { lines.push({ phrase: name, gtin: l.code, productName: name, packQty: l.qty ?? 1 }); continue; }
      let hit = cache.get(name);
      if (hit === undefined) {
        const found = await catalog.searchProducts({ query: name, limit: 3 }).catch(() => []);
        const best = found.find((f) => f.gtin && f.pricedAtChains > 0);
        hit = best?.gtin ? { gtin: best.gtin, productName: best.name, ...(best.brand ? { brand: best.brand } : {}) } : null;
        cache.set(name, hit);
      }
      lines.push({ phrase: name, gtin: hit?.gtin ?? `name:${name}`, productName: hit?.productName ?? name, ...(hit?.brand ? { brand: hit.brand } : {}), packQty: l.qty ?? 1 });
    }
    if (lines.length) orders.push({ at: o.at ?? new Date().toISOString(), lines });
  }
  const repo = new DynamoMemoryRepository(hid, TABLE);
  const saved = await repo.save(importHistory(await repo.load(), orders));
  return { orders: orders.length, products: Object.keys(saved.products).length };
}

/**
 * The item's price at every storefront serving the address: one single-line
 * quote, cached six hours under a catalogue-wide key so aisles can show the
 * range without paying for the quote each time.
 */
async function chainPrices(gtin: string, address: string, qp: { quoteBasket: (r: { lines: ListLine[]; address: string }) => Promise<{ quotes: readonly StorefrontQuote[] }> }): Promise<{ storefrontId: string; brand: string; price: number; minimumOrder?: number; deliveryFee?: number }[]> {
  const cached = (await readRow(TABLE, 'CATALOG', `PRICE#${gtin}`)) as { prices?: { storefrontId: string; brand: string; price: number; minimumOrder?: number; deliveryFee?: number }[]; at?: string } | undefined;
  if (cached?.prices && cached.at && Date.now() - Date.parse(cached.at) < 6 * 3600_000) return cached.prices;
  const res = await qp.quoteBasket({ lines: [{ id: 'x', query: gtin, gtin }], address }).catch(() => null);
  const prices = (res?.quotes ?? []).flatMap((q) => { const l = q.lines.find((x) => x.lineId === 'x'); return l && !l.substituted ? [{ storefrontId: q.storefrontId, brand: q.brand, price: l.unitPrice, ...(q.minimumOrder !== undefined ? { minimumOrder: q.minimumOrder } : {}), deliveryFee: q.deliveryFee }] : []; }).sort((a, b) => a.price - b.price);
  if (prices.length) await writeRow(TABLE, 'CATALOG', `PRICE#${gtin}`, { prices, min: prices[0]!.price, max: prices[prices.length - 1]!.price, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 7 * 86400 });
  return prices;
}

const JSON_H = { 'content-type': 'application/json' };
const ok = (data: unknown, status = 200): APIGatewayProxyResultV2 => ({ statusCode: status, headers: JSON_H, body: JSON.stringify(data) });
const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${name} is required`); return v.trim(); };
const arr = <T>(v: unknown, name: string): T[] => { if (!Array.isArray(v)) throw new HttpError(400, `${name} must be an array`); return v as T[]; };
const toLines = (v: unknown): ListLine[] =>
  arr<Partial<ListLine>>(v, 'lines').map((l, i) => {
    const query = str(l.query, `lines[${i}].query`);
    return { id: l.id ?? `l${i}`, query, ...(l.gtin ? { gtin: l.gtin } : {}), ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined ? { amount: l.amount } : {}), ...(l.unit ? { unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) };
  });
