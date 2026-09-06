import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { HttpError } from './auth.ts';

/**
 * Households and membership.
 *
 *   HOUSEHOLD#<hid>  MEMBER#<uid>     — a member; GSI1 reverses it (USER#<uid> → HOUSEHOLD#<hid>)
 *   HOUSEHOLD#<hid>  META             — name, address, constants
 *   INVITE#<code>    INVITE           — a short-lived invite to a household
 *
 * Every read of household data goes through `requireMember`, which is the
 * single place authorisation happens. A household id in a URL means nothing
 * until the caller's membership row exists.
 */

export interface Household {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  /** ISO 3166-1 alpha-2. Everything region-specific follows from it. */
  readonly country: string;
  /** Chains the family usually orders from, e.g. ["shufersal", "rami-levy"]. */
  readonly retailers?: readonly string[];
  /** How they prefer to get it. Drives the default quote. */
  readonly fulfillment?: 'delivery' | 'pickup' | 'either';
  /** Apartment, floor, entrance, notes — what the courier needs beyond the street. */
  readonly addressDetails?: Record<string, unknown>;
  /** UI language the family chose; the country stays IL for now. */
  readonly language?: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface Membership {
  readonly householdId: string;
  readonly userId: string;
  readonly role: 'owner' | 'member';
  readonly email?: string;
  readonly joinedAt: string;
}

export class HouseholdStore {
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;

  constructor(table: string, client?: DynamoDBClient) {
    this.#table = table;
    this.#doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async create(userId: string, email: string | undefined, name: string, address: string, country: string): Promise<Household> {
    const id = randomBytes(6).toString('base64url');
    const now = new Date().toISOString();
    const household: Household = { id, name, address, country, createdBy: userId, createdAt: now };
    await this.#doc.send(new PutCommand({ TableName: this.#table, Item: { PK: `HOUSEHOLD#${id}`, SK: 'META', ...household } }));
    await this.#putMember({ householdId: id, userId, role: 'owner', ...(email ? { email } : {}), joinedAt: now });
    return household;
  }

  async listForUser(userId: string): Promise<Household[]> {
    const res = await this.#doc.send(
      new QueryCommand({
        TableName: this.#table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :u AND begins_with(GSI1SK, :h)',
        ExpressionAttributeValues: { ':u': `USER#${userId}`, ':h': 'HOUSEHOLD#' },
      }),
    );
    const ids = (res.Items ?? []).map((i) => (i as { householdId: string }).householdId);
    const out: Household[] = [];
    for (const id of ids) {
      const h = await this.get(id);
      if (h) out.push(h);
    }
    return out;
  }

  async get(id: string): Promise<Household | undefined> {
    const res = await this.#doc.send(new GetCommand({ TableName: this.#table, Key: { PK: `HOUSEHOLD#${id}`, SK: 'META' } }));
    if (!res.Item) return undefined;
    const { PK: _p, SK: _s, ...h } = res.Item as Household & { PK: string; SK: string };
    return h;
  }

  async update(id: string, patch: Partial<Pick<Household, 'name' | 'address' | 'retailers' | 'fulfillment' | 'addressDetails' | 'language'>>): Promise<Household> {
    const names: Record<string, string> = {}; const values: Record<string, unknown> = {}; const sets: string[] = [];
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; names[`#${k}`] = k; values[`:${k}`] = v; sets.push(`#${k} = :${k}`); }
    if (sets.length > 0) await this.#doc.send(new UpdateCommand({ TableName: this.#table, Key: { PK: `HOUSEHOLD#${id}`, SK: 'META' }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
    const h = await this.get(id);
    if (!h) throw new HttpError(404, 'household not found');
    return h;
  }

  /** The one authorisation check. Throws 404, not 403: an outsider learns nothing. */
  async requireMember(householdId: string, userId: string): Promise<Membership> {
    const res = await this.#doc.send(
      new GetCommand({ TableName: this.#table, Key: { PK: `HOUSEHOLD#${householdId}`, SK: `MEMBER#${userId}` } }),
    );
    if (!res.Item) throw new HttpError(404, 'household not found');
    const { PK: _p, SK: _s, GSI1PK: _g1, GSI1SK: _g2, ...m } = res.Item as Membership & Record<string, unknown>;
    return m as Membership;
  }

  async createInvite(householdId: string): Promise<{ code: string; expiresAt: string }> {
    const code = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await this.#doc.send(
      new PutCommand({
        TableName: this.#table,
        Item: { PK: `INVITE#${code}`, SK: 'INVITE', householdId, expiresAt, ttl: Math.floor(Date.parse(expiresAt) / 1000) },
      }),
    );
    return { code, expiresAt };
  }

  async acceptInvite(code: string, userId: string, email: string | undefined): Promise<Household> {
    const res = await this.#doc.send(new GetCommand({ TableName: this.#table, Key: { PK: `INVITE#${code.toUpperCase()}`, SK: 'INVITE' } }));
    const inv = res.Item as { householdId: string; expiresAt: string } | undefined;
    if (!inv || Date.parse(inv.expiresAt) < Date.now()) throw new HttpError(404, 'invite not found or expired');
    await this.#putMember({ householdId: inv.householdId, userId, role: 'member', ...(email ? { email } : {}), joinedAt: new Date().toISOString() });
    const h = await this.get(inv.householdId);
    if (!h) throw new HttpError(404, 'household not found');
    return h;
  }

  async #putMember(m: Membership): Promise<void> {
    await this.#doc.send(
      new PutCommand({
        TableName: this.#table,
        Item: {
          PK: `HOUSEHOLD#${m.householdId}`,
          SK: `MEMBER#${m.userId}`,
          GSI1PK: `USER#${m.userId}`,
          GSI1SK: `HOUSEHOLD#${m.householdId}`,
          ...m,
        },
      }),
    );
  }
}
