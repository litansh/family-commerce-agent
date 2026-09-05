#!/usr/bin/env node
/**
 * The Kanili ordering worker. Runs on a machine at home, not in AWS: retailer
 * sites reject datacenter traffic, and this is the one process that ever
 * holds a retailer session.
 *
 *   link  — sign in to a retailer once in a window the worker opens; the
 *           session is saved encrypted, no password is stored
 *   run   — long-poll SQS for orders, drive the retailer with the saved
 *           session, write progress to DynamoDB so the app can show it,
 *           wait for the family's approval in Kanili, then place the order
 *
 *   KANILI_HOUSEHOLD=<id> npm run link -w @fca/order-worker
 *   KANILI_QUEUE_URL=… KANILI_TABLE=fca-main npm start -w @fca/order-worker
 */
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mkdirSync } from 'node:fs';
import { ShufersalConnector } from './shufersal.ts';
import type { OrderLine, RetailerConnector } from './connector.ts';

const QUEUE = process.env['KANILI_QUEUE_URL'] ?? '';
const TABLE = process.env['KANILI_TABLE'] ?? 'fca-main';

interface Job {
  householdId: string;
  orderId: string;
  retailer: 'shufersal';
  lines: OrderLine[];
}

const connectorFor = (job: Pick<Job, 'retailer' | 'householdId'>): RetailerConnector => {
  switch (job.retailer) {
    case 'shufersal':
      return new ShufersalConnector(job.householdId);
  }
};

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const sqs = new SQSClient({});

async function setStatus(job: Job, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const names: Record<string, string> = { '#s': 'status' };
  const values: Record<string, unknown> = { ':s': status, ':t': new Date().toISOString() };
  let expr = 'SET #s = :s, updatedAt = :t';
  for (const [k, v] of Object.entries(extra)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    expr += `, #${k} = :${k}`;
  }
  await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `HOUSEHOLD#${job.householdId}`, SK: `ORDER#${job.orderId}` },
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  console.log(`  ${job.orderId} → ${status}`);
}

/** Poll the order row until the family approves or cancels in the app. */
async function waitForApproval(job: Job, timeoutMs = 30 * 60_000): Promise<string | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: `HOUSEHOLD#${job.householdId}`, SK: `ORDER#${job.orderId}` } }));
    const it = r.Item as { status?: string; approvalToken?: string } | undefined;
    if (it?.status === 'approved' && it.approvalToken) return it.approvalToken;
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

async function link(): Promise<void> {
  const householdId = process.env['KANILI_HOUSEHOLD'];
  const retailer = (process.env['KANILI_RETAILER'] ?? 'shufersal') as Job['retailer'];
  if (!householdId) throw new Error('KANILI_HOUSEHOLD is required');
  const c = connectorFor({ householdId, retailer });
  try {
    await c.interactiveLogin();
  } finally {
    await c.close();
  }
}

async function run(): Promise<void> {
  if (!QUEUE) throw new Error('KANILI_QUEUE_URL is required');
  console.log('kanili worker: waiting for orders on', QUEUE);
  for (;;) {
    const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: QUEUE, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 45 * 60 }));
    for (const m of r.Messages ?? []) {
      const job = JSON.parse(m.Body ?? '{}') as Job;
      console.log(`order ${job.orderId} · ${job.retailer} · ${job.lines.length} lines`);
      try {
        await runJob(job);
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
