/**
 * Store sessions and half-finished sign-ins, per household (ADR 0008).
 *
 *   HOUSEHOLD#<hid> / SESSION#<store>     the sealed session + how and when it was made
 *   HOUSEHOLD#<hid> / CHALLENGE#<id>      an OTP exchange in flight, sealed, TTL 10 min
 *
 * Only the sealed blob holds anything the store issued. The row's plain
 * fields are `method`, `connectedAt`, `lastVerifiedAt` — enough for the app
 * to say "connected since Tuesday", nothing a person typed.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { open, seal, type OtpChallenge, type StoreSession } from '@fca/cloud-connectors';
import { randomBytes } from 'node:crypto';
import { HttpError } from './auth.ts';

export type ConnectMethod = 'device' | 'otp' | 'password';
export interface ConnectionInfo { connected: boolean; method?: ConnectMethod; since?: string; lastVerifiedAt?: string }

export class StoreSessionStore {
  readonly #doc: DynamoDBDocumentClient;
  readonly #key: string;
  constructor(private readonly table: string, key = process.env['SESSION_KEY'] ?? '') {
    this.#doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    this.#key = key;
  }

  #need(): string {
    if (!this.#key) throw new HttpError(503, 'store connections are not configured (SESSION_KEY)');
    return this.#key;
  }

  async put(hid: string, store: string, session: StoreSession, method: ConnectMethod): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.#doc.send(new GetCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${hid}`, SK: `SESSION#${store}` } }));
    await this.#doc.send(new PutCommand({
      TableName: this.table,
      Item: { PK: `HOUSEHOLD#${hid}`, SK: `SESSION#${store}`, sealed: seal(session, this.#need(), `${hid}/${store}`), method, connectedAt: (existing.Item?.['connectedAt'] as string | undefined) ?? now, lastVerifiedAt: now },
    }));
  }

  async get(hid: string, store: string): Promise<StoreSession | undefined> {
    const r = await this.#doc.send(new GetCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${hid}`, SK: `SESSION#${store}` } }));
    const sealed = r.Item?.['sealed'] as string | undefined;
    if (!sealed) return undefined;
    try { return open<StoreSession>(sealed, this.#need(), `${hid}/${store}`); } catch { return undefined; }
  }

  async touch(hid: string, store: string): Promise<void> {
    const r = await this.#doc.send(new GetCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${hid}`, SK: `SESSION#${store}` } }));
    if (r.Item) await this.#doc.send(new PutCommand({ TableName: this.table, Item: { ...r.Item, lastVerifiedAt: new Date().toISOString() } }));
  }

  async remove(hid: string, store: string): Promise<void> {
    await this.#doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${hid}`, SK: `SESSION#${store}` } }));
  }

  /** Every store this household is connected to, without opening any session. */
  async list(hid: string): Promise<Record<string, ConnectionInfo>> {
    const r = await this.#doc.send(new QueryCommand({
      TableName: this.table, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `HOUSEHOLD#${hid}`, ':sk': 'SESSION#' }, ProjectionExpression: 'SK, #m, connectedAt, lastVerifiedAt', ExpressionAttributeNames: { '#m': 'method' },
    }));
    const out: Record<string, ConnectionInfo> = {};
    for (const it of r.Items ?? []) out[String(it['SK']).slice('SESSION#'.length)] = { connected: true, method: it['method'] as ConnectMethod, since: it['connectedAt'] as string, lastVerifiedAt: it['lastVerifiedAt'] as string };
    return out;
  }

  // --- OTP challenges --------------------------------------------------------

  async putChallenge(hid: string, store: string, challenge: OtpChallenge): Promise<string> {
    const id = randomBytes(8).toString('base64url');
    await this.#doc.send(new PutCommand({
      TableName: this.table,
      Item: { PK: `HOUSEHOLD#${hid}`, SK: `CHALLENGE#${id}`, store, sealed: seal(challenge, this.#need(), `${hid}/${store}/${id}`), ttl: Math.floor(Date.now() / 1000) + 600 },
    }));
    return id;
  }

  async takeChallenge(hid: string, store: string, id: string): Promise<OtpChallenge> {
    const r = await this.#doc.send(new GetCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${hid}`, SK: `CHALLENGE#${id}` } }));
    const it = r.Item;
    if (!it || it['store'] !== store || Number(it['ttl']) < Date.now() / 1000) throw new HttpError(410, 'that code has expired — ask for a new one');
    return open<OtpChallenge>(it['sealed'] as string, this.#need(), `${hid}/${store}/${id}`);
  }

  async dropChallenge(hid: string, id: string): Promise<void> {
    await this.#doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: `HOUSEHOLD#${hid}`, SK: `CHALLENGE#${id}` } }));
  }
}
