/**
 * The API. One Lambda, one router, every route behind Cognito.
 *
 *   GET  /me                                   who am I, which households
 *   POST /households                           { name, address }
 *   POST /households/{hid}/invites             → { code }
 *   POST /invites/{code}/accept
 *   GET  /households/{hid}/memory
 *   POST /households/{hid}/memory/confirm      { phrase, gtin, productName, brand?, substitution? }
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
  PARTIAL_LEG_MIN_COVERAGE,
  recordShop,
  suggestMissing,
  type Agorot,
  type ListLine,
  type QuotedLine,
  type ProductChoice,
  type PurchasedLine,
  regionOf,
  normalizeBrand,
  importHistory,
  applyCoupons,
  type Coupon,
  type StorefrontQuote,
  type SubstitutionPolicy,
  groupIntoVariants,
  cheapestExactElsewhere,
  storefrontFacts,
  wrongProductLineIds,
} from '@fca/domain';
import { DynamoMemoryRepository, VersionConflict } from '@fca/memory-store';
import { quoteWithFallback, substituteMissing, cheapestBasketFor } from '@fca/shopping-agent';
import { chainWindow, etaForStorefront, woltNextOpen, woltEtasNear, type CatalogProvider, type Promotion, type QuoteProvider, type QuoteRequest, type QuoteResponse, dropUnavailableHaziHinam } from '@fca/retailer-connectors';
import { callerOf, HttpError } from './auth.ts';
import { HouseholdStore, type Household } from './households.ts';
import { providersFor } from './providers.ts';
import { productDetail } from './product-detail.ts';
import { ImageResolver } from '@fca/product-images';
import { ImportStore, OrderStore, readRow, writeRow } from './orders.ts';
import { randomUUID } from 'node:crypto';
import { CachedCatalog } from './cached-catalog.ts';
import { isSlowError, withDeadline } from './deadline.ts';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { StoreSessionStore } from './store-sessions.ts';
import { BranchPrices } from './branches.ts';
import { ConnectFailed, driverFor, localPhone, type PastOrderRaw, type StoreSession } from '@fca/cloud-connectors';


/** Runs `work` over `items`, at most `limit` at a time: the provider is a shared service, not ours to flood. */
async function mapLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let n = i++; n < items.length; n = i++) await work(items[n]!);
  });
  await Promise.all(workers);
}


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
const branchPrices = new BranchPrices(TABLE, process.env['BRANCH_BUCKET'] ?? '', process.env['REFRESH_FUNCTION'] ?? '');

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export async function handler(event: Event): Promise<APIGatewayProxyResultV2> {
  if ((event as unknown as { job?: string }).job === 'compare') { await runCompareJob(event as unknown as CompareJob); return { statusCode: 200, headers: JSON_H, body: '{}' }; }
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
      // Catalogue answers are cached (12 hours, keyed by words + brand + city): a compare asks for an
      // alternative to every gap, the same everyday words repeat across every family's list, and the
      // provider is a free service that errs when hammered.
      return { ...providers, catalog: new CachedCatalog(providers.catalog, TABLE) };
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
        // Visible in the log: a phone that captured nothing is the difference between "connected" and "looked connected".
        console.log(JSON.stringify({ event: 'store-session', hid, store, cookies: cookies.length, tokens: tokens ? Object.keys(tokens).length : 0 }));
        // Nothing captured is not a session: `{cookies:[],tokens:{}}` must never become a "connected" row.
        if (cookies.length === 0 && (!tokens || Object.keys(tokens).length === 0)) throw new HttpError(400, 'no session in body');
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
      // A cache written before the round-robin fix (or from a feed minute that was itself lopsided)
      // otherwise sits there for its full 6h doing the exact thing that fix was for: one chain's
      // page. Never trust a cached spread that thin; only a fresh pull can widen it.
      const cachedChains = new Set(promos.map((p) => p.chainName)).size;
      if (!promos.length || cachedChains < 3 || !cached?.at || Date.now() - Date.parse(cached.at) > 6 * 3600_000) {
        // The feed caps at 200, ordered by soonest end - the ones worth acting on this week.
        const fresh = catalog.listPromotions ? await catalog.listPromotions(200).catch(() => null) : null;
        if (fresh?.length) {
          // Retailers describe promotions in till-speak ("קטיף 5.90 רימון-מות-299ישיר");
          // the catalogue knows the product's real name. Resolve once per refresh,
          // for the strongest deals, and keep the names with the cache.
          // Round-robin by chain before naming: one chain's feed is always the biggest, and naming
          // only its promotions is how "מבצעים" quietly became a Shufersal page.
          const perChain = new Map<string, typeof fresh[number][]>();
          for (const p of [...fresh].sort((a, b) => b.discountRate - a.discountRate)) {
            const list = perChain.get(p.chainName) ?? []; list.push(p); perChain.set(p.chainName, list);
          }
          const top: typeof fresh[number][] = [];
          for (let i = 0; top.length < 120; i++) {
            const before = top.length;
            for (const list of perChain.values()) { const p = list[i]; if (p) top.push(p); if (top.length >= 120) break; }
            if (top.length === before) break;
          }
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
      // Second rung (docs/BACKLOG.md, ADR 0010): the provider's own promotions pull can still answer
      // with real promotions from only one or two chains (ops/deals-health.mjs is what catches a feed
      // that thin). The chains' own PromoFull files, read on the ops Mac never from this Lambda (ADR
      // 0011: services/branch-prices/refresh-deals.mjs), fill in whichever chains the provider's pull
      // missed - never replacing a chain the provider already covered, since a store's own file is a
      // fallback, not a better source.
      const coveredChains = new Set(promos.map((p) => p.chainName));
      if (coveredChains.size < 3) {
        const fromFiles = (await readRow(TABLE, 'CATALOG', 'PROMOS_FILES')) as { promos?: Promotion[] } | undefined;
        const gapFillers = (fromFiles?.promos ?? []).filter((p) => !coveredChains.has(p.chainName));
        if (gapFillers.length) promos = [...promos, ...gapFillers];
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
      }).sort((a, b) => b.score - a.score);
      // Every chain that has something good gets a place before any chain gets a second one. A family
      // shops at two or three chains, not at whichever one publishes the most promotions.
      const byChain = new Map<string, typeof ranked>();
      for (const d of ranked) { const l = byChain.get(d.chainName) ?? []; l.push(d); byChain.set(d.chainName, l); }
      const spread: typeof ranked = [];
      for (let i = 0; spread.length < 40; i++) {
        const before = spread.length;
        for (const l of byChain.values()) { const d = l[i]; if (d) spread.push(d); if (spread.length >= 40) break; }
        if (spread.length === before) break;
      }
      const deals = spread.sort((a, b) => b.score - a.score);
      const imgs = await images.cachedMany(deals.map((d) => ({ key: d.gtin, name: d.name, gtin: d.gtin })));
      console.log(JSON.stringify({ event: 'deals', hid, shown: deals.length, chains: [...new Set(deals.map((d) => d.chainName))] }));
      return ok({ deals: deals.map(({ score: _s, ...d }) => ({ ...d, imageUrl: imgs[d.gtin]?.url ?? null })) });
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
      // One JSON line per report, so CloudWatch metric filters can count store errors seen by real phones.
      console.log(JSON.stringify({ event: 'import-history', hid, retailer: body['retailer'], orders: raw.length, lines: raw.reduce((n, o) => n + (o.lines?.length ?? 0), 0), diag: body['diag'] ?? null }));
      // A cart that added nothing, or a store page that failed to load, is a broken promise in a
      // family's hand right now: it goes to the Kaniti Telegram channel as it is, so the fixer sees
      // the store's actual answer without anyone reading a log. Never blocks the response.
      void tellTelegram(String(body['retailer'] ?? ''), body['diag']);
      const cartDiag = ((body['diag'] as { cart?: { diag?: { store?: unknown; branchFrom?: unknown } } } | undefined)?.cart?.diag) ?? {};
      // The store's own answer for this family's address, whatever the recipe called it ('selected
      // address', 'first address', 'user home branch'). Only 'default' is a guess worth ignoring.
      if (typeof cartDiag.branchFrom === 'string' && cartDiag.branchFrom !== 'default' && typeof cartDiag.store === 'number' && household.branches?.[String(body['retailer'])] !== cartDiag.store) {
        await households.update(hid, { branches: { ...(household.branches ?? {}), [String(body['retailer'])]: cartDiag.store } }).catch(() => null);
      }
      const result = await importRawOrders(hid, catalog, raw);
      // Keep the store's own orders (last 30, newest first) so the Orders tab shows what
      // was really bought and the phone can confirm the cart it filled - no tap needed.
      const retailer = typeof body['retailer'] === 'string' ? body['retailer'] : 'unknown';
      if (raw.length) {
        const prev = ((await readRow(TABLE, hid, `HISTORY#${retailer}`)) as { orders?: { id?: string; at?: string; lines?: unknown[] }[] } | undefined)?.orders ?? [];
        const key = (o: { id?: string; at?: string; lines?: unknown[] }) => o.id || `${o.at}:${o.lines?.length ?? 0}`;
        const seen = new Set<string>();
        const merged = [...raw, ...prev].filter((o) => { const k = key(o as { id?: string; at?: string }); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 30);
        await writeRow(TABLE, hid, `HISTORY#${retailer}`, { retailer, at: new Date().toISOString(), orders: merged });
      }
      return ok(result);
    }

    // What the family really bought, per store, as imported from the stores' own accounts.
    if (method === 'GET' && rest === 'history') {
      const ids = ['rami-levy', 'victory', 'wolt', 'shufersal', 'carrefour', 'keshet-teamim', 'mahsanei-hashuk', 'tiv-taam', 'hazi-hinam'];
      const rows = await Promise.all(ids.map(async (id) => [id, await readRow(TABLE, hid, `HISTORY#${id}`)] as const));
      return ok({ stores: Object.fromEntries(rows.filter(([, r]) => r).map(([id, r]) => [id, { at: r!['at'], orders: r!['orders'] }])) });
    }

    // Pictures for a set of barcodes, resolved within a time budget so the
    // grid never waits on them. The app calls this right after rendering.
    // What a phone learned from a chain's own catalogue (ADR 0011: the API may not ask the chain
    // itself). Kept under the same key the resolver reads, so the next family member pays nothing.
    if (method === 'POST' && rest === 'images/learned') {
      const given = (typeof body['images'] === 'object' && body['images'] ? body['images'] : {}) as Record<string, unknown>;
      const pairs = Object.entries(given).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && /^https:\/\//.test(v as string)).slice(0, 40) as [string, string][];
      await Promise.all(pairs.map(([key, url]) => images.remember(key, url)));
      console.log(JSON.stringify({ event: 'images-learned', hid, kept: pairs.length }));
      return ok({ kept: pairs.length });
    }

    if (method === 'POST' && rest === 'images') {
      // Barcodes, and names for the lines a family typed in their own words - those have no barcode,
      // and a drawn glyph where a photograph belongs is the commonest "the app looks unfinished".
      const gtins = arr<string>(body['gtins'], 'gtins').filter((g) => typeof g === 'string').slice(0, 40);
      const names = Array.isArray(body['names']) ? (body['names'] as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 40) : [];
      const found = await images.resolveMany([...gtins.map((g) => ({ key: g, gtin: g })), ...names.map((n) => ({ key: n, name: n }))], 10, 12_000);
      return ok({ images: Object.fromEntries([...gtins, ...names].map((k) => [k, found[k]?.url ?? null])) });
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
      // A product nobody has priced yet is still a product the family wants on the list. Dropping it
      // told them "there is no such thing" - production answered 0 products for ביצים and סלמון while
      // the provider had eight of each, none priced through this path. Priced first, then the rest.
      const memoryNow = await repo.load();
      const priced = found.filter((c) => c.pricedAtChains > 0);
      const unpriced = found.filter((c) => c.pricedAtChains === 0);
      const buyable = [...rankForHousehold(priced, memoryNow), ...rankForHousehold(unpriced, memoryNow)].slice(0, 14);
      if (priced.length === 0 && unpriced.length > 0) console.log(JSON.stringify({ event: 'search-unpriced-only', hid, q, found: unpriced.length }));
      const imgs = await images.cachedMany(buyable.map((c) => ({ key: c.productId, name: c.name, ...(c.gtin ? { gtin: c.gtin } : {}) })));
      const products = buyable.map((c) => ({ ...c, imageUrl: imgs[c.productId]?.url ?? null }));
      // Variants (docs/design/item-identity.md): the same size and defining attribute, priced by
      // however many brands — "12 מותגים · ₪5.90–8.40", not forty products the family scrolls past.
      // Additive for now: `products` keeps its flat shape so today's add flow (List/Options/Aisle)
      // is untouched until the variant cards it is designed for exist (app-designer's own PR).
      const variants = groupIntoVariants(products).map((v) => ({ base: v.base, attrs: v.attrs, size: v.size, brandCount: v.brandCount, priceMin: v.priceMin, priceMax: v.priceMax, products: v.candidates }));
      return ok({ products, variants });
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
          // What the brand chip means next time: a pinned brand is 'never', "כל מותג" is
          // 'cheapest' (docs/design/item-identity.md). An unknown value is not a policy.
          ...(SUBSTITUTION.includes(body['substitution'] as SubstitutionPolicy) ? { substitution: body['substitution'] as SubstitutionPolicy } : {}),
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
      const unresolved: string[] = [];
      // One line's provider error must never sink the other 38 (ADR 0010): each line gets its own
      // budget and, on a miss, reports itself in `unresolved` instead of rejecting the whole batch.
      // And four at a time, never thirty-nine: asking a shared provider for a whole week at once is
      // what turns a healthy provider into `internal_error` (seen in production, HTTP 500, 0/39).
      const LINE_BUDGET_MS = 6_000;
      await mapLimit(applied, 4, async ({ line, fromMemory }) => {
        // A blank row — a cleared name, a bad paste, voice-to-text — has nothing to search for;
        // it is unresolved by definition, not a reason to spend a catalogue call or crash the batch.
        if (line.query.trim() === '') { choices[line.id] = null; unresolved.push(line.id); return; }
        try {
          const [branded, open] = await withDeadline(Promise.all([
            line.brand ? catalog.searchProducts({ query: line.query, brand: line.brand, limit: 12, location: household.address }) : Promise.resolve([]),
            catalog.searchProducts({ query: line.query, limit: 16, location: household.address }),
          ]), LINE_BUDGET_MS);
          const merged = [...new Map([...branded, ...open].map((p) => [p.productId, p])).values()];
          const c = buildChoice(merged, {
            lineId: line.id, query: line.query,
            ...(line.brand ? { requestedBrand: line.brand } : {}),
            ...(line.gtin ? { requestedGtin: line.gtin } : {}),
          });
          choices[line.id] = c ? { ...c, source: fromMemory ? 'memory' : c.source } : null;
          // A line that came back neither chosen nor thrown must still be told apart from one
          // never sent: `null` with no `unresolved` entry satisfies neither reader downstream.
          if (!c) unresolved.push(line.id);
        } catch (e) {
          console.warn(JSON.stringify({ event: 'resolve-line-failed', hid, lineId: line.id, query: line.query, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }));
          choices[line.id] = null;
          unresolved.push(line.id);
        }
      });
      if (unresolved.length) console.log(JSON.stringify({ event: 'resolve', hid, lines: applied.length, unresolved: unresolved.length }));
      return ok({ choices, fromMemory: applied.filter((a) => a.fromMemory).map((a) => a.line.id), unresolved });
    }

    if (method === 'POST' && rest === 'quote') {
      const { quote: quoteProvider, catalog } = requirePricing();
      return ok(await buildCompare(hid, household, body, { quoteProvider, catalog, repo, region }, SYNC_BUDGET));
    }
    // "עשה את זה זול יותר" (docs/design/a-full-basket-everywhere.md, rule 4): one store, the
    // family's own chosen products, swapped for the cheapest same-kind-same-size product at that
    // store wherever a real saving confirms. Never touches a line the store already substituted -
    // that swap is already named on the card.
    if (method === 'POST' && rest === 'cheaper') {
      const { quote: quoteProvider, catalog } = requirePricing();
      const storefrontId = str(body['storefrontId'], 'storefrontId');
      const lines = toLines(body['lines']);
      const address = typeof body['address'] === 'string' ? body['address'] : household.address;
      const serviceType = (body['pickup'] === true || (body['pickup'] === undefined && household.fulfillment === 'pickup') ? 'pickup' : 'delivery') as 'pickup' | 'delivery';
      const res = await quoteProvider.quoteBasket({ lines, address, serviceType });
      const quote = res.quotes.find((q) => q.storefrontId === storefrontId);
      if (!quote) throw new HttpError(404, 'storefront not in this compare');
      // The wire shape is the array alone (docs/design/a-full-basket-everywhere.md's own "engine
      // line"): the screen already has the original name from `storefrontLines`, and derives the
      // new total itself from `storefronts[sid].fullBasket.total` minus each swap's own delta.
      return ok((await cheapestBasketFor(quoteProvider, catalog, quote, lines, address)).swaps);
    }
    // The phone's path: start the compare, collect it when it is done. No gateway clock, no timeout
    // on the family's side; the job retries a slow provider by itself. If the API may not invoke
    // itself yet (a fresh deploy before its IAM grant), the compare is built here and now instead.
    if (method === 'POST' && rest === 'compares') {
      requirePricing();
      const id = randomUUID();
      const at = new Date().toISOString();
      const ttl = Math.floor(Date.now() / 1000) + COMPARE_TTL_S;
      await writeRow(TABLE, hid, `COMPARE#${id}`, { status: 'pending', at, ttl });
      const self = process.env['AWS_LAMBDA_FUNCTION_NAME'];
      try {
        if (!self) throw new Error('not in Lambda');
        await lambda.send(new InvokeCommand({ FunctionName: self, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ job: 'compare', hid, id, body } satisfies CompareJob)) }));
        return ok({ id, status: 'pending' }, 202);
      } catch (e) {
        console.warn(JSON.stringify({ event: 'compare-inline', hid, id, error: e instanceof Error ? e.message : String(e) }));
        const { quote: quoteProvider, catalog } = requirePricing();
        const result = await buildCompare(hid, household, body, { quoteProvider, catalog, repo, region }, SYNC_BUDGET);
        await writeRow(TABLE, hid, `COMPARE#${id}`, { status: 'done', result, at, ttl });
        return ok({ id, status: 'done', result });
      }
    }
    if (method === 'GET' && seg[2] === 'compares' && seg[3] && seg.length === 4) {
      const row = await readRow(TABLE, hid, `COMPARE#${seg[3]}`);
      if (!row) throw new HttpError(404, 'not found');
      return ok({ id: seg[3], status: row['status'], ...(row['result'] ? { result: row['result'] } : {}), ...(row['error'] ? { error: row['error'] } : {}) });
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

/** How long a compare may take: one try inside API Gateway's 30 s (the sync route), or several tries in the background job. */
type CompareBudget = { tryMs: number; totalMs: number };
const SYNC_BUDGET: CompareBudget = { tryMs: 26_000, totalMs: 26_000 };
/**
 * The background job's budget grows with the basket, because the work does: the provider takes at
 * most fifty items in a call, so a sixty-line list is two calls a pass and two passes, plus the
 * substitutes. A flat 110 s failed a real family's list at 113 s and gave them nothing (reproduced
 * on production, 13 September). The phone waits on a row, not on a clock, so a longer wait is only
 * a longer wait - and the copy on screen says so past 35 seconds.
 */
function jobBudget(lines: number): CompareBudget {
  const chunks = Math.max(1, Math.ceil(lines / 50));
  return { tryMs: Math.min(120_000, 45_000 * chunks), totalMs: Math.min(280_000, 90_000 + 45_000 * chunks) };
}

/**
 * The compare: the family's list priced at every store that delivers, substitutes for what a store
 * lacks, coupons, the optimizer's cheap / fast / split answers, delivery times, and the in-store
 * branches if they drive. Shared by the sync route (the ops checks) and the background job (the phone).
 */
async function buildCompare(hid: string, household: Household, body: Record<string, unknown>, deps: { quoteProvider: QuoteProvider; catalog: CatalogProvider; repo: DynamoMemoryRepository; region: ReturnType<typeof regionOf> }, budget: CompareBudget): Promise<Record<string, unknown>> {
      const { quoteProvider, catalog, repo, region } = deps;
      const memory = await repo.load();
      const applied = applyMemory(toLines(body['lines']), memory);
      // A blank query with no confirmed barcode has nothing to quote — sending it to the vendor
      // risks the same whole-batch failure a blank line already caused at /resolve; it is simply
      // left out here, same as /resolve leaves it unresolved (docs/BACKLOG.md).
      const lines = applied.map((a) => a.line).filter((l) => l.query.trim() !== '' || l.gtin);
      // The provider has 22 s per call. The sync route (the ops checks) gives the whole quote one
      // try inside API Gateway's 30 s; the background job (what the phone uses) tries again on a
      // slow answer until its budget is spent - a slow minute at the stores is never the family's.
      const quoteStarted = Date.now();
      const quoteReq = {
        lines,
        address: typeof body['address'] === 'string' ? body['address'] : household.address,
        serviceType: (body['pickup'] === true || (body['pickup'] === undefined && household.fulfillment === 'pickup') ? 'pickup' : 'delivery') as 'pickup' | 'delivery',
      };
      let res!: Awaited<ReturnType<typeof quoteWithFallback>>;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await withDeadline(quoteWithFallback(quoteProvider, quoteReq, memory), budget.tryMs);
          break;
        } catch (e: unknown) {
          const slow = isSlowError(e);
          const left = budget.totalMs - (Date.now() - quoteStarted);
          console.warn(JSON.stringify({ event: 'quote-provider-slow', hid, attempt, ms: Date.now() - quoteStarted, leftMs: left, lines: lines.length, error: e instanceof Error ? e.message : String(e), slow }));
          if (slow && left > 8_000) continue;
          if (slow) throw new HttpError(503, 'stores_slow');
          throw e;
        }
      }
      // Branch stock: an item Rami Levy's branch for this family does not carry is "out of stock" at
      // its checkout, which for a family equals "does not exist" (promise 9). This used to check it
      // here with a live per-request call to `rami-levy.co.il/api/catalog` (and `/api/stores` as a
      // branch-lookup fallback) — exactly the call ADR 0011 forbids from a Lambda and measured as
      // blocked there (`branch-stock-skipped: Unexpected token '<'`, every time, in production): the
      // try/catch below always landed in its catch, so this filter has never actually applied to a
      // real compare. Removed rather than left silently doing nothing (docs/BACKLOG.md); the real
      // fix is the same move as Hatzi Hinam's branch stock (ADR 0011's second place: the ops Mac's
      // nightly refresher, or the device, writing a cache the API only reads) — not built yet, so
      // `branchStock` stays honestly empty until it is.
      const branchStock: Record<string, { branch: number; lineIds: string[] }> = {};
      const lineQueryFor = new Map(lines.map((l) => [l.id, l.query]));
      // Hatzi Hinam: the same check, from a cache the ops Mac's nightly `refresh-hazi-hinam-stock.mjs`
      // writes (ADR 0011: shop.hazi-hinam.co.il only answers a browser or this Mac, never the API's
      // Lambda - PR #73 called it live from here and was reverted for that). A barcode the cache never
      // checked, or hasn't caught up with yet, is not in the map - unknown stock drops nothing.
      const hh = res.quotes.filter((q) => /hazi|hinam/i.test(q.storefrontId) || /חצי חינם/.test(q.brand));
      if (hh.length) {
        try {
          const cached = (await readRow(TABLE, 'CATALOG', 'HH_STOCK')) as { stock?: Record<string, boolean> } | undefined;
          const inStock = new Map(Object.entries(cached?.stock ?? {}));
          const droppedNames: string[] = []; const droppedIds: string[] = [];
          for (const q of hh) { const { kept, dropped } = dropUnavailableHaziHinam(q.lines, inStock); if (dropped.length) { (q as { lines: typeof q.lines }).lines = kept; droppedNames.push(...dropped.map((l) => l.productName)); droppedIds.push(...dropped.map((l) => l.lineId)); } }
          if (droppedIds.length) { branchStock['hazi-hinam'] = { branch: 0, lineIds: droppedIds };
            if (catalog instanceof CachedCatalog) void catalog.forget(droppedIds.map((id) => lineQueryFor.get(id) ?? '').filter(Boolean), household.address).catch(() => null);
            console.log(JSON.stringify({ event: 'branch-stock', hid, store: 'hazi-hinam', dropped: droppedNames })); }
        } catch (e) { console.warn(JSON.stringify({ event: 'branch-stock-skipped', hid, store: 'hazi-hinam', error: e instanceof Error ? e.message : String(e) })); }
      }
      // A store that lacks a line (no salmon at Rami Levy) must not vanish from the compare. For the
      // lines the near-complete storefronts miss, find the closest product in the catalogue and price
      // the basket once more with it; a storefront that carries the substitute gets the line back,
      // marked as a substitution the card shows ("סלמון → פילה סלמון"). One extra quote, not one per store.
      // API Gateway answers 503 after 30 s, so the extra quote for substitutes has a budget: past it the
      // compare goes out without substitutes rather than not at all (the log says which).
      // One shared clock: on the sync route the substitutes get what is left of it (never more than 9 s).
      // Alternatives are not a nicety: a store that cannot fill the basket is no use to a family, who
      // will not order a partial one. So the background job - which has minutes, not seconds - looks
      // up every gap it can, and only the sync route (the ops checks) keeps the tight old ceiling.
      const budgetMs = Math.max(0, Math.min(budget.totalMs > 60_000 ? 45_000 : 9_000, budget.totalMs + 1_000 - (Date.now() - quoteStarted)));
      const maxSubstituteSearches = budget.totalMs > 60_000 ? 60 : 12;
      const substituted = await Promise.race([
        substituteMissing(quoteProvider, catalog, res, lines, typeof body['address'] === 'string' ? body['address'] : household.address, maxSubstituteSearches).catch((e: unknown) => { console.warn('substitutes failed', e); return res; }),
        new Promise<typeof res>((resolve) => setTimeout(() => { console.warn(JSON.stringify({ event: 'substitutes-skipped', hid, budgetMs })); resolve(res); }, budgetMs)),
      ]);
      // Personal coupons the worker read from the family's accounts change
      // which chain wins; apply them before ranking.
      const couponRows = await Promise.all((household.retailers ?? []).map(async (r) => (await readRow(TABLE, hid, `COUPONS#${r}`)) as { coupons?: Coupon[] } | undefined));
      const coupons = couponRows.flatMap((r) => r?.coupons ?? []);
      const couponed: StorefrontQuote[] = substituted.quotes.map((q) => applyCoupons(q, coupons));
      const result = optimize({ quotes: couponed, constants: DEFAULT_CONSTANTS, requestedLineIds: lines.map((l) => l.id) });
      const couponSavings = Object.fromEntries(couponed.map((q) => [q.storefrontId, (q as { couponSavings?: number }).couponSavings ?? 0]));
      const bestId = result.options[0]?.legs[0]?.storefrontId;
      const bestLines = substituted.quotes.find((q) => q.storefrontId === bestId)?.lines ?? [];
      // Not on the shared clock like substitutes and etas above, this defaulted to 20s of its own -
      // on a five-person week (30+ lines, several cache misses) that alone could carry the whole
      // request past API Gateway's 30s cutoff into the 503 a family saw with no picture to show for it
      // either. A picture is worth having, not worth the compare itself; a miss here is cached for a
      // day and self-heals on the next look, same as any other resolveMany caller.
      const imgs = await images.resolveMany(bestLines.map((l) => ({ key: l.lineId, name: l.productName, ...(l.gtin ? { gtin: l.gtin } : {}) })), 6, 5_000);
      const quotedLines = Object.fromEntries(bestLines.map((l) => [l.lineId, { gtin: l.gtin, productName: l.productName, link: l.link, imageUrl: imgs[l.lineId]?.url ?? null }]));
      // How soon each storefront can deliver, next to its price: Wolt venues answer live
      // (minutes, from Wolt's own feed for the family's address); the chains deliver in
      // windows, which the phone reads from each store once it is connected.
      const ad = (household.addressDetails ?? {}) as { lat?: number; lng?: number; city?: string; street?: string; number?: string };
      type Eta = { kind: 'live'; minutes?: number; range?: string; name?: string } | { kind: 'closed'; nextOpen?: string; text?: string } | { kind: 'slots'; earliest?: string; until?: string; windowHours?: number };
      const etas: Record<string, Eta> = {};
      const wolt = typeof ad.lat === 'number' && typeof ad.lng === 'number' ? await woltEtasNear(ad.lat, ad.lng) : {};
      // Every delivering storefront is shown now, not only the optimizer's picks and rejects
      // (docs/design/a-full-basket-everywhere.md): coverage is a fact on its own card, never a
      // reason the family never saw it at all.
      const shownStorefronts = new Set<string>([...couponed.map((q) => q.storefrontId), ...result.options.flatMap((o) => o.legs.map((l) => l.storefrontId)), ...result.rejected.map((r) => r.storefrontId)]);
      // Base pass, no extra network: what the compare shows if the enrichment below misses its budget.
      for (const sid of shownStorefronts) {
        const w = etaForStorefront(sid, wolt);
        etas[sid] = w && w.online && w.delivers ? { kind: 'live', minutes: w.minutes, ...(w.range ? { range: w.range } : {}), name: w.name } : { kind: 'slots' };
      }
      // Enrichment: a closed Wolt venue's reopen time, a chain's own published window — both public, no
      // session, but each a live call to the store's own site, so bounded: a slow store cannot cost the
      // quote its budget, and the base pass above already stands if this misses it.
      const etaBudgetMs = 4000;
      await Promise.race([
        Promise.all(Array.from(shownStorefronts).map(async (sid) => {
          if (sid.startsWith('wolt-')) {
            const w = etaForStorefront(sid, wolt);
            if (!w?.online || !w?.delivers) {
              const open = typeof ad.lat === 'number' && typeof ad.lng === 'number' ? await woltNextOpen(sid.slice('wolt-'.length), ad.lat, ad.lng).catch(() => undefined) : undefined;
              if (open && !open.isOpen) etas[sid] = { kind: 'closed', ...(open.nextOpen ? { nextOpen: open.nextOpen } : {}), ...(open.text ? { text: open.text } : {}) };
            }
          } else if (ad.city && ad.street) {
            const w = await chainWindow(sid, { city: ad.city, street: ad.street, ...(ad.number ? { number: ad.number } : {}) }).catch(() => undefined);
            if (w) etas[sid] = { kind: 'slots', earliest: w.earliest, until: w.until, windowHours: w.windowHours };
          }
        })).then(() => {}),
        new Promise<void>((resolve) => setTimeout(() => { console.warn(JSON.stringify({ event: 'etas-enrich-skipped', hid, budgetMs: etaBudgetMs })); resolve(); }, etaBudgetMs)),
      ]);
      // Each storefront's own resolution of every line (its product, its deep link), for the
      // stores the compare shows - so an order at any store opens that store's pages, not the winner's.
      const shownIds = new Set<string>([...couponed.map((q) => q.storefrontId), ...result.options.flatMap((o) => o.legs.map((l) => l.storefrontId)), ...result.rejected.map((r) => r.storefrontId)]);
      const storefrontLines: Record<string, Record<string, { gtin?: string; productName: string; price?: number; lineTotal?: number; link?: string; substituted?: boolean; reason?: string; swapBy?: 'kaniti' | 'store' }>> = {};
      // A substitution's reason is for people: "what you asked → what this store has". The provider's own
      // codes (confirmed_product_unavailable) never reach a card.
      const lineQuery = new Map(lines.map((l) => [l.id, l.query]));
      const reasonFor = (l: QuotedLine): string => (l.substitutionReason && l.substitutionReason.includes('→') ? l.substitutionReason : `${lineQuery.get(l.lineId) ?? ''} → ${l.productName}`);
      // Per-store price per line (docs/design/item-identity.md: "רמי לוי ₪6.20 (תנובה 1 ל')" needs one):
      // this store's own unit price, never the winner's or another store's. `lineTotal` (not `price`,
      // which is the provider's `unitPrice`) is what this line costs inside the basket — the two
      // disagree once a promotion applies (docs/design/a-full-basket-everywhere.md, "the screen may
      // not add the line prices up"), so a card that shows a swap's cost must read this field, never
      // sum `price` fields itself.
      // A line a store filled with something that is not an alternative is not offered by that store:
      // it is left out here exactly as it is named in that card's gaps, so the two never disagree.
      for (const q of substituted.quotes) if (shownIds.has(q.storefrontId)) storefrontLines[q.storefrontId] = Object.fromEntries(q.lines.filter((l) => !wrongProductLineIds(q, lineQuery).has(l.lineId)).map((l) => [l.lineId, { ...(l.gtin ? { gtin: l.gtin } : {}), productName: l.productName, price: l.unitPrice, lineTotal: l.lineTotal, ...(l.link ? { link: l.link } : {}), ...(l.substituted ? { substituted: true, reason: reasonFor(l), swapBy: l.substitutionReason && l.substitutionReason.includes('→') ? 'kaniti' : 'store' } : {}) }]));
      // The engine half of "a full basket everywhere" (docs/design/a-full-basket-everywhere.md):
      // every delivering storefront's full-basket facts (this store's own nearest product wherever
      // it lacks the exact one - substituteMissing already tried every gap, not just the near-complete
      // stores') and, only when a line the family actually pinned was swapped here, the exact-basket
      // facts beside them (a free-text line's own resolution is never a swap to charge extra for).
      // Computed once per compare, shared by every card - never a rejection gate, a fact each one can show.
      const pinnedLineIds = new Set(lines.filter((l) => l.gtin).map((l) => l.id));
      const elsewhereByLine = cheapestExactElsewhere(couponed);
      const storefronts = Object.fromEntries(
        couponed.filter((q) => q.serviceType === 'delivery').map((q) => [q.storefrontId, storefrontFacts(q, lines.map((l) => l.id), pinnedLineIds, elsewhereByLine, new Map(lines.map((l) => [l.id, l.query])))]),
      );
      // In-store, if the family drives: the same list priced at the branches near home,
      // from the chains' published price files. Never blocks the quote.
      // A free-text line has no barcode of its own; the storefronts' resolution of it does, and the
      // branch index is keyed by barcode - so borrow the first barcode any storefront resolved the line to.
      const gtinOf = (id: string, own?: string) => own ?? substituted.quotes.flatMap((q) => q.lines).find((ql) => ql.lineId === id && ql.gtin && !ql.substituted)?.gtin ?? substituted.quotes.flatMap((q) => q.lines).find((ql) => ql.lineId === id && ql.gtin)?.gtin;
      const drive = await branchPrices.driveQuotes(hid, household, lines.map((l) => { const g = gtinOf(l.id, l.gtin); return { id: l.id, query: l.query, ...(g ? { gtin: g } : {}), qty: Math.max(1, Math.round(l.packQty ?? 1)) }; })).catch((e: unknown) => { console.warn('drive quotes failed', e); return { status: 'none' as const, branches: [] }; });
      // The in-store card must compare like with like: the branch's basket covers only the lines it
      // prices, so put next to it what the SAME lines cost at the winning delivered store.
      const bestQuote = substituted.quotes.find((q) => q.storefrontId === bestId);
      const driveOut = { ...drive, branches: drive.branches.map((b) => {
        const miss = new Set(b.missingLineIds);
        const same = bestQuote ? bestQuote.lines.filter((l) => !miss.has(l.lineId)).reduce((n, l) => n + l.lineTotal, 0) : 0;
        return bestQuote && same > 0 ? { ...b, sameLines: { brand: bestQuote.brand, items: same, delivered: same + bestQuote.deliveryFee } } : b;
      }) };
      // One line per compare, so "why only one option?" is answerable from the log.
      console.log(JSON.stringify({ event: 'quote', hid, lines: lines.length, options: result.options.map((o) => ({ kind: o.kind, cash: o.cashCost, coverage: Math.round(o.coverageRatio * 100), legs: o.legs.map((l) => `${l.storefrontId}:${l.lineIds.length}`) })), rejected: result.rejected.map((r) => { const have = new Set(substituted.quotes.find((q) => q.storefrontId === r.storefrontId)?.lines.map((l) => l.lineId) ?? []); const miss = lines.filter((l) => !have.has(l.id)).map((l) => l.query).slice(0, 4); return `${r.storefrontId}:${r.code}:${r.pricedLines}/${r.requestedLines}${miss.length ? ' missing ' + miss.join('|') : ''}`; }), drive: `${driveOut.status}:${driveOut.branches.length}`, subs: substituted.quotes.reduce((n, q) => n + q.lines.filter((l) => l.substituted).length, 0) }));
      return {
        currency: region.currency,
        branchStock,
        etas,
        drive: driveOut,
        storefrontLines,
        storefronts,
        lines,
        fromMemory: applied.filter((a) => a.fromMemory).map((a) => a.line.id),
        options: result.options,
        couponSavings,
        rejected: result.rejected,
        warnings: result.warnings,
        assumptions: substituted.assumptions,
        quotedLines,
        suggestions: suggestMissing(memory, lines),
      };
}

/** Phone diagnostics worth a person's eye, to the Telegram channel (when the API has the bot's token). */
async function tellTelegram(retailer: string, diag: unknown): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
  const chat = process.env['TELEGRAM_CHAT_ID'] ?? '';
  if (!token || !chat || !diag || typeof diag !== 'object') return;
  const d = diag as { cart?: { results?: { status?: string }[]; diag?: unknown }; basket?: { store?: number; added?: number }; loadError?: unknown; build?: unknown };
  const results = d.cart?.results ?? [];
  const added = results.filter((r) => r.status === 'added').length;
  let why = '';
  // Every cart report goes out: 'added' is the recipe's word, the basket the family sees is the truth.
  if (d.cart && results.length > 0) why = `cart at ${retailer}: ${added} of ${results.length} lines added`;
  else if (d.basket && typeof d.basket.store === 'number' && typeof d.basket.added === 'number' && d.basket.store < d.basket.added) why = `basket mismatch at ${retailer}: the store shows ${d.basket.store}, Kaniti added ${d.basket.added}`;
  else if (d.loadError) why = `store page failed at ${retailer}`;
  if (!why) return;
  const text = `📱 ${why}\nbuild ${String(d.build ?? '?')}\n${JSON.stringify(d.cart?.diag ?? d.basket ?? d.loadError ?? {}).slice(0, 1800)}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(4000) }).catch((e: unknown) => console.warn('telegram failed', e instanceof Error ? e.message : String(e)));
}

type CompareJob = { job: 'compare'; hid: string; id: string; body: Record<string, unknown> };
const lambda = new LambdaClient({});
const COMPARE_TTL_S = 3600;

/** A DynamoDB row holds 400 KB. A compare rarely nears it; when it does, the rejected stores' per-line resolutions go first (the cards still show their totals and reasons). */
function fitRow(result: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(result).length < 350_000) return result;
  const options = result['options'] as { legs: { storefrontId: string }[] }[] | undefined;
  const keep = new Set((options ?? []).flatMap((o) => o.legs.map((l) => l.storefrontId)));
  const sl = (result['storefrontLines'] ?? {}) as Record<string, unknown>;
  return { ...result, storefrontLines: Object.fromEntries(Object.entries(sl).filter(([sid]) => keep.has(sid))), trimmed: true };
}

/** The background job: build the compare and keep it under COMPARE#<id> for the phone to collect. */
async function runCompareJob(job: CompareJob): Promise<void> {
  const started = Date.now();
  try {
    const household = await households.get(job.hid);
    if (!household) throw new HttpError(404, 'household not found');
    const region = regionOf(household.country);
    const providers = providersFor(region);
    if (!providers) throw new HttpError(422, `pricing is not available in ${region.country} yet`);
    const lineCount = Array.isArray(job.body['lines']) ? (job.body['lines'] as unknown[]).length : 0;
    const catalog = new CachedCatalog(providers.catalog, TABLE);
    const result = await buildCompare(job.hid, household, job.body, { quoteProvider: providers.quote, catalog, repo: new DynamoMemoryRepository(job.hid, TABLE), region }, jobBudget(lineCount));
    console.log(JSON.stringify({ event: 'catalog-cache', hid: job.hid, ...catalog.stats() }));
    const kept = fitRow(result);
    console.log(JSON.stringify({ event: 'compare-done', hid: job.hid, lines: Array.isArray(job.body['lines']) ? (job.body['lines'] as unknown[]).length : 0, ms: Date.now() - started, kb: Math.round(JSON.stringify(kept).length / 1024) }));
    await writeRow(TABLE, job.hid, `COMPARE#${job.id}`, { status: 'done', result: kept, at: new Date().toISOString(), ms: Date.now() - started, ttl: Math.floor(Date.now() / 1000) + COMPARE_TTL_S });
  } catch (e) {
    console.error(JSON.stringify({ event: 'compare-failed', hid: job.hid, id: job.id, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) }));
    await writeRow(TABLE, job.hid, `COMPARE#${job.id}`, { status: 'failed', error: e instanceof HttpError ? e.message : 'internal error', at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + COMPARE_TTL_S });
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
const SUBSTITUTION: readonly SubstitutionPolicy[] = ['never', 'same_brand', 'equivalent', 'cheapest'];
const toLines = (v: unknown): ListLine[] =>
  arr<Partial<ListLine>>(v, 'lines').map((l, i) => {
    // A blank query — a cleared name, a bad paste, voice-to-text — is a row a family's own list
    // produces far more easily than a rejected barcode; one such row must never 400 the other 38
    // (docs/BACKLOG.md). It carries through as an empty query, unresolved by whoever reads lines.
    const query = typeof l.query === 'string' ? l.query.trim() : '';
    return { id: l.id ?? `l${i}`, query, ...(l.gtin ? { gtin: l.gtin } : {}), ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined ? { amount: l.amount } : {}), ...(l.unit ? { unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) };
  });
