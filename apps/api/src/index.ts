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
} from '@fca/domain';
import { DynamoMemoryRepository } from '@fca/memory-store';
import { SuperMcpCatalogProvider, SuperMcpQuoteProvider } from '@fca/retailer-connectors';
import { callerOf, HttpError } from './auth.ts';
import { HouseholdStore } from './households.ts';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';
const households = new HouseholdStore(TABLE);
const quoteProvider = new SuperMcpQuoteProvider();
const catalog = new SuperMcpCatalogProvider();

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export async function handler(event: Event): Promise<APIGatewayProxyResultV2> {
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
      return ok(await households.create(caller.userId, caller.email, name, address), 201);
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

    if (method === 'POST' && rest === 'invites') return ok(await households.createInvite(hid), 201);
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
      const memory = await repo.load();
      const applied = applyMemory(toLines(body['lines']), memory);
      const lines = applied.map((a) => a.line);
      const res = await quoteProvider.quoteBasket({
        lines,
        address: typeof body['address'] === 'string' ? body['address'] : household.address,
        serviceType: body['pickup'] === true ? 'pickup' : 'delivery',
      });
      const result = optimize({ quotes: res.quotes, constants: DEFAULT_CONSTANTS, requestedLineIds: lines.map((l) => l.id) });
      const bestId = result.options[0]?.legs[0]?.storefrontId;
      const quotedLines = Object.fromEntries((res.quotes.find((q) => q.storefrontId === bestId)?.lines ?? []).map((l) => [l.lineId, { gtin: l.gtin, productName: l.productName, link: l.link }]));
      return ok({
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
