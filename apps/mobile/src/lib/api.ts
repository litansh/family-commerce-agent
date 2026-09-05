import type { ListLine, ProductChoice, PurchaseOption, PurchasedLine, Suggestion } from '@fca/domain';
import { config } from './config';

export interface Household { id: string; name: string; address: string }

export interface QuoteResult {
  lines: ListLine[];
  fromMemory: string[];
  options: PurchaseOption[];
  rejected: { brand: string; reason: string }[];
  warnings: string[];
  assumptions: { lineId: string; query: string; selectedName: string; kind: string }[];
  quotedLines: Record<string, { gtin?: string; productName: string; link?: string }>;
  suggestions: Suggestion[];
}

export class Api {
  constructor(private readonly idToken: string) {}

  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.idToken}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json()) as T & { error?: string; message?: string };
    if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
    return data;
  }

  me = () => this.#call<{ userId: string; email?: string; households: Household[] }>('GET', '/me');
  createHousehold = (name: string, address: string) => this.#call<Household>('POST', '/households', { name, address });
  invite = (hid: string) => this.#call<{ code: string }>('POST', `/households/${hid}/invites`);
  acceptInvite = (code: string) => this.#call<Household>('POST', `/invites/${code.trim().toUpperCase()}/accept`);
  quote = (hid: string, lines: Omit<ListLine, 'id'>[]) => this.#call<QuoteResult>('POST', `/households/${hid}/quote`, { lines });
  resolve = (hid: string, lines: Omit<ListLine, 'id'>[]) =>
    this.#call<{ choices: Record<string, ProductChoice | null>; fromMemory: string[] }>('POST', `/households/${hid}/resolve`, { lines });
  suggest = (hid: string, lines: Omit<ListLine, 'id'>[]) => this.#call<{ suggestions: Suggestion[] }>('POST', `/households/${hid}/suggest`, { lines });
  confirm = (hid: string, c: { phrase: string; gtin: string; productName: string; brand?: string }) =>
    this.#call<unknown>('POST', `/households/${hid}/memory/confirm`, c);
  recordShop = (hid: string, bought: PurchasedLine[]) => this.#call<unknown>('POST', `/households/${hid}/memory/shop`, { bought });
}

export const ils = (agorot: number): string => `₪${(agorot / 100).toFixed(2)}`;
