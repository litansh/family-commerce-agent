import type { HouseholdMemory, ListLine, ProductCandidate, ProductChoice, PurchaseOption, PurchasedLine, Suggestion } from '@fca/domain';

export type SearchHit = ProductCandidate & { imageUrl: string | null; priceMin?: number; priceMax?: number; bought?: boolean };
import { config } from './config';

export interface Household { id: string; name: string; address: string; country?: string; retailers?: string[]; fulfillment?: 'delivery' | 'pickup' | 'either' }

export interface OrderLeg { retailer: string; lines: ListLine[]; status: string; total?: number; slot?: { id: string; label: string }; paymentMethod?: string; retailerOrderId?: string; error?: string }
export interface Order {
  id: string; householdId: string; retailer: string; legs?: OrderLeg[]; status: string; lines: ListLine[];
  createdAt: string; updatedAt: string; total?: number; slot?: { id: string; label: string };
  paymentMethod?: string; retailerOrderId?: string; error?: string;
}

export interface QuoteResult {
  currency?: string;
  lines: ListLine[];
  fromMemory: string[];
  options: PurchaseOption[];
  couponSavings?: Record<string, number>;
  rejected: { storefrontId: string; brand: string; reason: string; code: 'coverage' | 'minimum'; itemsSubtotal: number; pricedLines: number; requestedLines: number; minimumOrder?: number; amountToMinimum?: number }[];
  warnings: string[];
  assumptions: { lineId: string; query: string; selectedName: string; kind: string }[];
  quotedLines: Record<string, { gtin?: string; productName: string; link?: string; imageUrl?: string | null }>;
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
  createHousehold = (h: { name: string; address: string; country: string; retailers: string[]; fulfillment: 'delivery' | 'pickup' | 'either'; language: string; addressDetails: Record<string, unknown> }) => this.#call<Household>('POST', '/households', h);
  suggestAddress = (q: string) => this.#call<{ suggestions: { street: string; number: string; city: string; label: string; verified: boolean; lat: number; lng: number }[] }>('GET', `/geo/suggest?q=${encodeURIComponent(q)}`);
  household = (hid: string) => this.#call<Household>('GET', `/households/${hid}`);
  importHistory = (hid: string, retailer: string, orders: { at: string; lines: { name: string; code?: string; qty: number }[] }[]) => this.#call<{ orders: number; products: number }>('POST', `/households/${hid}/import-history`, { retailer, orders });
  requestImport = (hid: string, retailer: string) => this.#call<{ retailer: string; status: string }>('POST', `/households/${hid}/imports`, { retailer });
  importStatus = (hid: string, retailer: string) => this.#call<{ retailer: string; status: string; orders?: number; products?: number; error?: string }>('GET', `/households/${hid}/imports/${retailer}`);
  search = (hid: string, q: string) => this.#call<{ products: SearchHit[] }>('GET', `/households/${hid}/search?q=${encodeURIComponent(q)}`);
  lookup = (hid: string, gtin: string) => this.#call<{ products: SearchHit[] }>('GET', `/households/${hid}/search?gtin=${encodeURIComponent(gtin)}`);
  createOrder = (hid: string, legs: { retailer: string; lines: Omit<ListLine, 'id'>[] }[]) => this.#call<Order>('POST', `/households/${hid}/orders`, { legs });
  orders = (hid: string) => this.#call<{ orders: Order[] }>('GET', `/households/${hid}/orders`);
  browse = (hid: string, aisle: string, sub?: string, page = 0) => this.#call<{ aisle: string; sub: string; subs: string[]; page: number; total: number; hasMore: boolean; products: SearchHit[] }>('GET', `/households/${hid}/browse?aisle=${encodeURIComponent(aisle)}${sub ? `&sub=${encodeURIComponent(sub)}` : ''}&page=${page}`);
  images = (hid: string, gtins: string[]) => this.#call<{ images: Record<string, string | null> }>('POST', `/households/${hid}/images`, { gtins });
  product = (hid: string, gtin: string) => this.#call<{ gtin: string; name: string; brand?: string; listings: { chainId: string; chainName: string; name: string }[]; imageUrl: string | null; prices: { storefrontId: string; brand: string; price: number; minimumOrder?: number; deliveryFee?: number }[]; priceMin?: number; priceMax?: number }>('GET', `/households/${hid}/product?gtin=${encodeURIComponent(gtin)}`);
  order = (hid: string, oid: string) => this.#call<Order>('GET', `/households/${hid}/orders/${oid}`);
  approveOrder = (hid: string, oid: string) => this.#call<Order>('POST', `/households/${hid}/orders/${oid}/approve`);
  cancelOrder = (hid: string, oid: string) => this.#call<Order>('POST', `/households/${hid}/orders/${oid}/cancel`);
  worker = (hid: string) => this.#call<{ online: boolean; lastSeen: string | null; linked: Record<string, boolean> }>('GET', `/households/${hid}/worker`);
  memory = (hid: string) => this.#call<HouseholdMemory>('GET', `/households/${hid}/memory`);
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

