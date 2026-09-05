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
} from '@fca/domain';
import { DynamoMemoryRepository, VersionConflict } from '@fca/memory-store';
import { quoteWithFallback } from '@fca/shopping-agent';
import { callerOf, HttpError } from './auth.ts';
import { HouseholdStore } from './households.ts';
import { providersFor } from './providers.ts';
import { ImageResolver } from '@fca/product-images';
import { ImportStore, OrderStore } from './orders.ts';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';
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
      return ok(retailers || fulfillment ? await households.update(created.id, { ...(retailers ? { retailers } : {}), ...(fulfillment ? { fulfillment } : {}) }) : created, 201);
    }
    if (method === 'POST' && seg[0] === 'invites' && seg[2] === 'accept' && seg[1]) {
      return ok(await households.acceptInvite(seg[1], caller.userId, caller.email));
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
      const buyable = found.filter((c) => c.pricedAtChains > 0).slice(0, 8);
      const imgs = await images.resolveMany(buyable.map((c) => ({ key: c.productId, name: c.name, ...(c.gtin ? { gtin: c.gtin } : {}) })));
      return ok({ products: buyable.map((c) => ({ ...c, imageUrl: imgs[c.productId]?.url ?? null })) });
    }
    if (method === 'GET' && rest === 'region') return ok(region);
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
      const result = optimize({ quotes: res.quotes, constants: DEFAULT_CONSTANTS, requestedLineIds: lines.map((l) => l.id) });
      const bestId = result.options[0]?.legs[0]?.storefrontId;
      const bestLines = res.quotes.find((q) => q.storefrontId === bestId)?.lines ?? [];
      const imgs = await images.resolveMany(bestLines.map((l) => ({ key: l.lineId, name: l.productName, ...(l.gtin ? { gtin: l.gtin } : {}) })));
      const quotedLines = Object.fromEntries(bestLines.map((l) => [l.lineId, { gtin: l.gtin, productName: l.productName, link: l.link, imageUrl: imgs[l.lineId]?.url ?? null }]));
      return ok({
        currency: region.currency,
        lines,
        fromMemory: applied.filter((a) => a.fromMemory).map((a) => a.line.id),
        options: result.options,
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
