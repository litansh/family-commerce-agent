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
  applyCoupons,
  type Coupon,
  type StorefrontQuote,
} from '@fca/domain';
import { DynamoMemoryRepository, VersionConflict } from '@fca/memory-store';
import { quoteWithFallback } from '@fca/shopping-agent';
import { callerOf, HttpError } from './auth.ts';
import { HouseholdStore } from './households.ts';
import { providersFor } from './providers.ts';
import { productDetail } from './product-detail.ts';
import { ImageResolver } from '@fca/product-images';
import { ImportStore, OrderStore, readRow } from './orders.ts';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';

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
      const res = await fetch(url, { headers: { 'user-agent': 'kanili/0.1 (contact: litansh@gmail.com)' } }).catch(() => null);
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

    // --- ordering through Kanili -----------------------------------------
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
      const all = results.flat().filter((c) => c.pricedAtChains > 0 && !seen.has(c.productId) && seen.add(c.productId));
      const PAGE = 24;
      const slice = all.slice(page * PAGE, page * PAGE + PAGE);
      const imgs = await images.resolveMany(slice.map((c) => ({ key: c.productId, name: c.name, ...(c.gtin ? { gtin: c.gtin } : {}) })), 8);
      return ok({ aisle, sub: chosen.key, subs: subs.map((x) => x.key), page, total: all.length, hasMore: all.length > (page + 1) * PAGE, products: slice.map((c) => ({ ...c, imageUrl: imgs[c.productId]?.url ?? null })) });
    }

    // One product, every chain that carries it. The catalogue's canonical
    // record keyed by barcode; the "why Kanili" moment on a product sheet.
    if (method === 'GET' && rest === 'product') {
      requirePricing();
      const gtin = (event.queryStringParameters?.['gtin'] ?? '').trim();
      if (!gtin) throw new HttpError(400, 'gtin is required');
      const detail = await productDetail(gtin);
      const img = await images.resolve({ gtin, ...(detail?.name ? { name: detail.name } : {}) });
      return ok({ ...(detail ?? { gtin, name: '', listings: [] }), imageUrl: img?.url ?? null });
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
      const buyable = found.filter((c) => c.pricedAtChains > 0).slice(0, 14);
      const imgs = await images.resolveMany(buyable.map((c) => ({ key: c.productId, name: c.name, ...(c.gtin ? { gtin: c.gtin } : {}) })));
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
      return ok({
        currency: region.currency,
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

const JSON_H = { 'content-type': 'application/json' };
const ok = (data: unknown, status = 200): APIGatewayProxyResultV2 => ({ statusCode: status, headers: JSON_H, body: JSON.stringify(data) });
const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${name} is required`); return v.trim(); };
const arr = <T>(v: unknown, name: string): T[] => { if (!Array.isArray(v)) throw new HttpError(400, `${name} must be an array`); return v as T[]; };
const toLines = (v: unknown): ListLine[] =>
  arr<Partial<ListLine>>(v, 'lines').map((l, i) => {
    const query = str(l.query, `lines[${i}].query`);
    return { id: l.id ?? `l${i}`, query, ...(l.gtin ? { gtin: l.gtin } : {}), ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined ? { amount: l.amount } : {}), ...(l.unit ? { unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) };
  });
