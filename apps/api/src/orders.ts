/**
 * Orders placed through Kanili.
 *
 *   HOUSEHOLD#<hid>  ORDER#<oid>  status, lines, total, slot, approvalToken…
 *
 * Status moves: queued → connecting → filling_cart → choosing_slot →
 * awaiting_approval → approved → placing → placed | cancelled | failed.
 * Only the family can move it to approved, and only from awaiting_approval.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomBytes } from 'node:crypto';
import type { ListLine } from '@fca/domain';
import { HttpError } from './auth.ts';

export interface OrderLeg {
  readonly retailer: string;
  readonly lines: readonly ListLine[];
  readonly status: string;
  readonly total?: number;
  readonly slot?: { id: string; label: string };
  readonly paymentMethod?: string;
  readonly retailerOrderId?: string;
  readonly error?: string;
}

/**
 * One Kanili order, fanned out to as many retailers as the basket needs.
 * The family approves once; every leg's worker sees the same token.
 */
export interface Order {
  readonly id: string;
  readonly householdId: string;
  /** Kept for single-retailer callers; equals legs[0].retailer. */
  readonly retailer: string;
  readonly legs: readonly OrderLeg[];
  readonly status: string;
  readonly lines: readonly ListLine[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly total?: number;
  readonly slot?: { id: string; label: string };
  readonly paymentMethod?: string;
  readonly retailerOrderId?: string;
  readonly error?: string;
}

const strip = (item: Record<string, unknown>): Order => {
  const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, approvalToken: _t, ...o } = item;
  return o as unknown as Order;
};

export class OrderStore {
  readonly #doc: DynamoDBDocumentClient;
  readonly #sqs = new SQSClient({});
  readonly #table: string;
  readonly #queueUrl: string;

  constructor(table: string, queueUrl: string) {
    this.#table = table;
    this.#queueUrl = queueUrl;
    this.#doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  }

  async create(householdId: string, userId: string, legsIn: readonly { retailer: string; lines: readonly ListLine[] }[]): Promise<Order> {
    if (!this.#queueUrl) throw new HttpError(503, 'ordering is not configured');
    if (legsIn.length === 0) throw new HttpError(400, 'an order needs at least one leg');
    const id = randomBytes(5).toString('base64url');
    const now = new Date().toISOString();
    const legs: OrderLeg[] = legsIn.map((l) => ({ retailer: l.retailer, lines: l.lines, status: 'queued' }));
    const order: Order = { id, householdId, retailer: legs[0]!.retailer, legs, status: 'queued', lines: legs.flatMap((l) => l.lines), createdBy: userId, createdAt: now, updatedAt: now };
    await this.#doc.send(new PutCommand({ TableName: this.#table, Item: { PK: `HOUSEHOLD#${householdId}`, SK: `ORDER#${id}`, GSI1PK: `HOUSEHOLD#${householdId}`, GSI1SK: `ORDER#${now}`, ...order } }));
    // One message per leg: legs run in parallel if there are several workers,
    // in sequence if there is one.
    await Promise.all(legs.map((leg, legIndex) => this.#sqs.send(new SendMessageCommand({
      QueueUrl: this.#queueUrl,
      MessageBody: JSON.stringify({ householdId, orderId: id, legIndex, retailer: leg.retailer, lines: leg.lines.map((l) => ({ lineId: l.id, query: l.query, gtin: l.gtin, amount: l.amount, unit: l.unit, packQty: l.packQty })) }),
    }))));
    return order;
  }

  async get(householdId: string, id: string): Promise<Order> {
    const r = await this.#doc.send(new GetCommand({ TableName: this.#table, Key: { PK: `HOUSEHOLD#${householdId}`, SK: `ORDER#${id}` } }));
    if (!r.Item) throw new HttpError(404, 'order not found');
    return strip(r.Item);
  }

  async list(householdId: string): Promise<Order[]> {
    const r = await this.#doc.send(new QueryCommand({
      TableName: this.#table, IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :h AND begins_with(GSI1SK, :o)',
      ExpressionAttributeValues: { ':h': `HOUSEHOLD#${householdId}`, ':o': 'ORDER#' },
      ScanIndexForward: false, Limit: 20,
    }));
    return (r.Items ?? []).map(strip);
  }

  /** The family says yes to the real total. Only valid while the worker is waiting. */
  async approve(householdId: string, id: string, userId: string): Promise<Order> {
    const token = randomBytes(16).toString('hex');
    try {
      await this.#doc.send(new UpdateCommand({
        TableName: this.#table, Key: { PK: `HOUSEHOLD#${householdId}`, SK: `ORDER#${id}` },
        UpdateExpression: 'SET #s = :a, approvalToken = :t, approvedBy = :u, approvedAt = :now, updatedAt = :now',
        ConditionExpression: '#s = :w',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':a': 'approved', ':w': 'awaiting_approval', ':t': token, ':u': userId, ':now': new Date().toISOString() },
      }));
    } catch {
      throw new HttpError(409, 'order is not awaiting approval');
    }
    return this.get(householdId, id);
  }

  async cancel(householdId: string, id: string): Promise<Order> {
    try {
      await this.#doc.send(new UpdateCommand({
        TableName: this.#table, Key: { PK: `HOUSEHOLD#${householdId}`, SK: `ORDER#${id}` },
        UpdateExpression: 'SET #s = :c, updatedAt = :now',
        ConditionExpression: '#s <> :placed AND #s <> :placing',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':c': 'cancelled', ':placed': 'placed', ':placing': 'placing', ':now': new Date().toISOString() },
      }));
    } catch {
      throw new HttpError(409, 'order can no longer be cancelled');
    }
    return this.get(householdId, id);
  }
}

/** History imports ride the same queue; the worker tells them apart by `type`. */
export class ImportStore {
  readonly #doc: DynamoDBDocumentClient;
  readonly #sqs = new SQSClient({});
  constructor(private readonly table: string, private readonly queueUrl: string) {
    this.#doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  }
  async request(householdId: string, retailer: string): Promise<{ retailer: string; status: string }> {
    if (!this.queueUrl) throw new HttpError(503, 'imports are not configured');
    const now = new Date().toISOString();
    await this.#doc.send(new PutCommand({ TableName: this.table, Item: { PK: `HOUSEHOLD#${householdId}`, SK: `IMPORT#${retailer}`, status: 'queued', requestedAt: now, updatedAt: now } }));
    await this.#sqs.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify({ type: 'import', householdId, retailer }) }));
    return { retailer, status: 'queued' };
  }
  async status(householdId: string, retailer: string): Promise<Record<string, unknown>> {
    const r = await this.#doc.send(new GetCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${householdId}`, SK: `IMPORT#${retailer}` } }));
    if (!r.Item) return { retailer, status: 'none' };
    const { PK: _p, SK: _s, ...rest } = r.Item; return { retailer, ...rest };
  }
}

/** Read one household-scoped row by sort key. Small helper for status rows. */
export async function readRow(table: string, householdId: string, sk: string): Promise<Record<string, unknown> | undefined> {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const r = await doc.send(new GetCommand({ TableName: table, Key: { PK: `HOUSEHOLD#${householdId}`, SK: sk } }));
  return r.Item;
}
