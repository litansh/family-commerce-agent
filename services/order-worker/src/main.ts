#!/usr/bin/env node
/**
 * The Kaniti ordering worker. Runs on a machine at home, not in AWS: retailer
 * sites reject datacenter traffic, and this is the one process that ever
 * holds a retailer session.
 *
 *   link  — sign in to a retailer once in a window the worker opens; the
 *           session is saved encrypted, no password is stored
 *   run   — long-poll SQS for orders, drive the retailer with the saved
 *           session, write progress to DynamoDB so the app can show it,
 *           wait for the family's approval in Kaniti, then place the order
 *
 *   KANITI_HOUSEHOLD=<id> npm run link -w @fca/order-worker
 *   KANITI_QUEUE_URL=… KANITI_TABLE=fca-main npm start -w @fca/order-worker
 */
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { hasSession } from './session.ts';
import { mkdirSync } from 'node:fs';
import { ShufersalConnector } from './shufersal.ts';
import { RamiLevyConnector } from './rami-levy.ts';
import { importHistory, type PurchasedLine } from '@fca/domain';
import { DynamoMemoryRepository } from '@fca/memory-store';
import { SuperMcpCatalogProvider } from '@fca/retailer-connectors';
import type { OrderLine, RetailerConnector } from './connector.ts';

const env = (k: string): string | undefined => process.env[`KANITI_${k}`] ?? process.env[`KANILI_${k}`];
const QUEUE = env('QUEUE_URL') ?? '';
const TABLE = env('TABLE') ?? 'fca-main';

type Retailer = 'shufersal' | 'rami-levy';
interface ImportJob { type: 'import'; householdId: string; retailer: Retailer }

interface Job {
  type?: 'order';
  householdId: string;
  orderId: string;
  /** Which leg of a multi-store order this message is. */
  legIndex: number;
  retailer: Retailer;
  lines: OrderLine[];
}

const ORDER_STEPS = ['queued', 'connecting', 'filling_cart', 'choosing_slot', 'awaiting_approval', 'approved', 'placing', 'placed'];

const connectorFor = (job: Pick<Job, 'retailer' | 'householdId'>): RetailerConnector => {
  switch (job.retailer) {
    case 'shufersal':
      return new ShufersalConnector(job.householdId);
    case 'rami-levy':
      return new RamiLevyConnector(job.householdId);
    default:
      throw new Error(`no connector for ${String(job.retailer)}`);
  }
};

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const sqs = new SQSClient({});

/**
 * Write this leg's status, then derive the order's overall status from all
 * legs: the least-advanced non-terminal leg wins, so the family sees
 * "awaiting approval" only when every store is ready for it.
 */
async function setStatus(job: Job, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const key = { PK: `HOUSEHOLD#${job.householdId}`, SK: `ORDER#${job.orderId}` };
  const names: Record<string, string> = { '#legs': 'legs', '#s': 'status' };
  const values: Record<string, unknown> = { ':s': status, ':t': new Date().toISOString() };
  let expr = `SET #legs[${job.legIndex}].#s = :s, updatedAt = :t`;
  for (const [k, v] of Object.entries(extra)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    expr += `, #legs[${job.legIndex}].#${k} = :${k}`;
  }
  await doc.send(new UpdateCommand({ TableName: TABLE, Key: key, UpdateExpression: expr, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));

  const r = await doc.send(new GetCommand({ TableName: TABLE, Key: key }));
  const legs = ((r.Item as { legs?: { status: string; total?: number }[] } | undefined)?.legs ?? []);
  const overall = legs.some((l) => l.status === 'failed') ? 'failed'
    : legs.every((l) => l.status === 'placed') ? 'placed'
    : legs.some((l) => l.status === 'cancelled') ? 'cancelled'
    : legs.reduce((acc, l) => (ORDER_STEPS.indexOf(l.status) < ORDER_STEPS.indexOf(acc) ? l.status : acc), 'placed');
  const total = legs.reduce((sum, l) => sum + (l.total ?? 0), 0);
  await doc.send(new UpdateCommand({
    TableName: TABLE, Key: key,
    UpdateExpression: 'SET #s = :o, #total = :total',
    // Never regress an approval the family already gave.
    ConditionExpression: 'NOT (#s = :approved AND :o = :awaiting)',
    ExpressionAttributeNames: { '#s': 'status', '#total': 'total' },
    ExpressionAttributeValues: { ':o': overall, ':total': total, ':approved': 'approved', ':awaiting': 'awaiting_approval' },
  })).catch(() => undefined);
  console.log(`  ${job.orderId}[${job.legIndex}] → ${status}   (order: ${overall})`);
}

/** Poll the order row until the family approves or cancels in the app. */
async function waitForApproval(job: Job, timeoutMs = 30 * 60_000): Promise<string | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: `HOUSEHOLD#${job.householdId}`, SK: `ORDER#${job.orderId}` } }));
    const it = r.Item as { status?: string; approvalToken?: string } | undefined;
    // One approval covers every leg.
    if (it?.approvalToken) return it.approvalToken;
    if (it?.status === 'cancelled') return null;
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

async function runJob(job: Job): Promise<void> {
  mkdirSync('trace', { recursive: true });
  const c = connectorFor(job);
  try {
    await setStatus(job, 'connecting');
    await c.resume();
    await syncCoupons(job.householdId, c).catch(() => undefined);
    await setStatus(job, 'filling_cart');
    const lines = await c.fillCart(job.lines);
    await setStatus(job, 'choosing_slot', { lines });
    const slots = await c.listSlots();
    const slot = slots[0];
    if (!slot) throw new Error('no delivery slots offered');
    const prepared = await c.prepare(slot);
    await setStatus(job, 'awaiting_approval', { total: prepared.total, slot: prepared.slot, paymentMethod: prepared.paymentMethod, reviewShot: prepared.reviewShot });
    const token = await waitForApproval(job);
    if (!token) {
      await setStatus(job, 'cancelled');
      return;
    }
    await setStatus(job, 'placing');
    const placed = await c.placeOrder(token);
    await setStatus(job, 'placed', { retailerOrderId: placed.retailerOrderId, confirmationShot: placed.confirmationShot });
  } catch (e) {
    await setStatus(job, 'failed', { error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    await c.close();
  }
}

/**
 * Read the account's past orders and replay them into household memory,
 * dated, so rhythms are learned before the first shop. Product names are
 * resolved to barcodes through the catalogue; a name that resolves to
 * nothing is still remembered by its words.
 */
async function runImport(job: ImportJob): Promise<void> {
  const key = { PK: `HOUSEHOLD#${job.householdId}`, SK: `IMPORT#${job.retailer}` };
  const mark = (status: string, extra: Record<string, unknown> = {}) =>
    doc.send(new UpdateCommand({ TableName: TABLE, Key: key, UpdateExpression: 'SET #s = :s, updatedAt = :t' + Object.keys(extra).map((k) => `, #${k} = :${k}`).join(''),
      ExpressionAttributeNames: { '#s': 'status', ...Object.fromEntries(Object.keys(extra).map((k) => [`#${k}`, k])) },
      ExpressionAttributeValues: { ':s': status, ':t': new Date().toISOString(), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])) } }));
  const c = connectorFor(job);
  const catalog = new SuperMcpCatalogProvider();
  try {
    await mark('connecting');
    await c.resume();
    await mark('reading');
    await syncCoupons(job.householdId, c);
    const history = await c.orderHistory(30);
    await mark('resolving', { orders: history.length });
    const cache = new Map<string, { gtin: string; productName: string; brand?: string } | null>();
    const orders: { at: string; lines: PurchasedLine[] }[] = [];
    for (const o of history) {
      const lines: PurchasedLine[] = [];
      for (const l of o.lines) {
        let hit = cache.get(l.name);
        if (hit === undefined) {
          const found = await catalog.searchProducts({ query: l.name, limit: 3 }).catch(() => []);
          const best = found.find((f) => f.gtin && f.pricedAtChains > 0);
          hit = best?.gtin ? { gtin: best.gtin, productName: best.name, ...(best.brand ? { brand: best.brand } : {}) } : null;
          cache.set(l.name, hit);
        }
        lines.push({ phrase: l.name, gtin: hit?.gtin ?? `name:${l.name}`, productName: hit?.productName ?? l.name, ...(hit?.brand ? { brand: hit.brand } : {}), packQty: l.qty });
      }
      orders.push({ at: o.at, lines });
    }
    const repo = new DynamoMemoryRepository(job.householdId, TABLE);
    const memory = await repo.load();
    await repo.save(importHistory(memory, orders));
    await mark('done', { orders: orders.length, products: cache.size, resolved: [...cache.values()].filter(Boolean).length });
    console.log(`  import ${job.retailer}: ${orders.length} orders, ${cache.size} products`);
  } catch (e) {
    await mark('failed', { error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    await c.close();
  }
}

/** Personal coupons from the account, stored where the quote can apply them. */
async function syncCoupons(householdId: string, c: RetailerConnector): Promise<void> {
  const coupons = await c.coupons().catch(() => []);
  await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: `HOUSEHOLD#${householdId}`, SK: `COUPONS#${c.id}`, coupons, updatedAt: new Date().toISOString() } }));
  console.log(`  coupons ${c.id}: ${coupons.length}`);
}

async function link(): Promise<void> {
  const householdId = env('HOUSEHOLD');
  const retailer = (env('RETAILER') ?? 'shufersal') as Job['retailer'];
  if (!householdId) throw new Error('KANITI_HOUSEHOLD is required');
  const c = connectorFor({ householdId, retailer });
  try {
    await c.interactiveLogin();
  } finally {
    await c.close();
  }
}

/**
 * Tell the app the home computer is listening, and which stores are linked.
 * One row per household, refreshed every 30s; the app treats anything older
 * than two minutes as offline.
 */
async function heartbeat(): Promise<void> {
  const householdId = env('HOUSEHOLD');
  if (!householdId) return;
  const linked = Object.fromEntries((['shufersal', 'rami-levy'] as const).map((r) => [r, hasSession(householdId, r)]));
  await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: `HOUSEHOLD#${householdId}`, SK: 'WORKER', lastSeen: new Date().toISOString(), linked, host: process.env['HOSTNAME'] ?? 'home' } })).catch(() => undefined);
}

async function run(): Promise<void> {
  if (!QUEUE) throw new Error('KANITI_QUEUE_URL is required');
  console.log('kaniti worker: waiting for orders on', QUEUE);
  await heartbeat();
  setInterval(() => void heartbeat(), 30_000);
  for (;;) {
    const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: QUEUE, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 45 * 60 }));
    for (const m of r.Messages ?? []) {
      const raw = JSON.parse(m.Body ?? '{}') as Job | ImportJob;
      try {
        if (raw.type === 'import') {
          console.log(`import history · ${raw.retailer} · household ${raw.householdId}`);
          await runImport(raw);
        } else {
          const job = raw as Job;
          job.legIndex ??= 0;
          console.log(`order ${job.orderId} leg ${job.legIndex} · ${job.retailer} · ${job.lines.length} lines`);
          await runJob(job);
        }
      } catch (e) {
        console.error('  failed:', e instanceof Error ? e.message : e);
      }
      if (m.ReceiptHandle) await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE, ReceiptHandle: m.ReceiptHandle }));
    }
  }
}

const cmd = process.argv[2];
(cmd === 'link' ? link() : run()).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
