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

export interface StoreOrder { id?: string; at?: string; total?: number; lines: { name: string; code?: string; qty?: number }[] }

export interface DriveBranch {
  storefrontId: string; chain: string; brand: string; branchName: string; address: string;
  distanceKm: number; minutes: number; itemsSubtotal: number; driveCost: number;
  coveredLines: number; totalLines: number; missingLineIds: string[]; pricedAt: string;
  /** The same covered lines at the winning delivered store, for an honest comparison. */
  sameLines?: { brand: string; items: number; delivered: number };
}

export interface QuoteResult {
  currency?: string;
  /** How soon each storefront delivers: live minutes (Wolt) or window delivery (the chains). */
  etas?: Record<string, { kind: 'live' | 'slots'; minutes?: number; range?: string; name?: string }>;
  /** The list priced in-store at the branches near home, for the "if we drive" comparison. */
  drive?: { status: 'ready' | 'pending' | 'none'; branches: DriveBranch[] };
  /** Each shown storefront's own product and deep link per line. */
  storefrontLines?: Record<string, Record<string, { gtin?: string; productName: string; link?: string; substituted?: boolean; reason?: string; swapBy?: 'kaniti' | 'store' }>>;
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

export interface Deal {
  gtin: string;
  name: string;
  brand?: string;
  chainName: string;
  /** Promotional price, agorot. */
  price: number;
  discountRate: number;
  clubOnly: boolean;
  endTs: string;
  imageUrl: string | null;
  /** True when the household buys this product. */
  usual: boolean;
}

export class Api {
  readonly #token: () => Promise<string | null>;
  readonly #onExpired?: () => void;
  /**
   * `token` is asked for before every call and may refresh (the app passes
   * `loadTokens`, which renews a token within a minute of expiry). A 401 is
   * retried once with a fresh token; a second 401 means the session is gone
   * and `onExpired` (sign out) runs, instead of every screen failing quietly.
   */
  constructor(token: string | (() => Promise<string | null>), onExpired?: () => void) {
    this.#token = typeof token === 'string' ? async () => token : token;
    this.#onExpired = onExpired;
  }

  async #call<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const tok = await this.#token();
    if (!tok) { this.#onExpired?.(); throw new Error('signed out'); }
    const res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 && retry) return this.#call<T>(method, path, body, false);
    if (res.status === 401) { this.#onExpired?.(); throw new Error('signed out'); }
    const data = (await res.json()) as T & { error?: string; message?: string };
    if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
    return data;
  }

  me = () => this.#call<{ userId: string; email?: string; households: Household[] }>('GET', '/me');
  createHousehold = (h: { name: string; address: string; country: string; retailers: string[]; fulfillment: 'delivery' | 'pickup' | 'either'; language: string; addressDetails: Record<string, unknown> }) => this.#call<Household>('POST', '/households', h);
  suggestAddress = (q: string) => this.#call<{ suggestions: { street: string; number: string; city: string; label: string; verified: boolean; lat: number; lng: number }[] }>('GET', `/geo/suggest?q=${encodeURIComponent(q)}`);
  household = (hid: string) => this.#call<Household>('GET', `/households/${hid}`);
  importHistory = (hid: string, retailer: string, orders: { at: string; lines: { name: string; code?: string; qty: number }[] }[], diag?: Record<string, unknown>) => this.#call<{ orders: number; products: number }>('POST', `/households/${hid}/import-history`, { retailer, orders, ...(diag ? { diag } : {}) });
  requestImport = (hid: string, retailer: string) => this.#call<{ retailer: string; status: string }>('POST', `/households/${hid}/imports`, { retailer });
  importStatus = (hid: string, retailer: string) => this.#call<{ retailer: string; status: string; orders?: number; products?: number; error?: string }>('GET', `/households/${hid}/imports/${retailer}`);
  search = (hid: string, q: string) => this.#call<{ products: SearchHit[] }>('GET', `/households/${hid}/search?q=${encodeURIComponent(q)}`);
  lookup = (hid: string, gtin: string) => this.#call<{ products: SearchHit[] }>('GET', `/households/${hid}/search?gtin=${encodeURIComponent(gtin)}`);
  createOrder = (hid: string, legs: { retailer: string; lines: Omit<ListLine, 'id'>[] }[]) => this.#call<Order>('POST', `/households/${hid}/orders`, { legs });
  orders = (hid: string) => this.#call<{ orders: Order[] }>('GET', `/households/${hid}/orders`);
  browse = (hid: string, aisle: string, sub?: string, page = 0) => this.#call<{ aisle: string; sub: string; subs: string[]; page: number; total: number; hasMore: boolean; products: SearchHit[] }>('GET', `/households/${hid}/browse?aisle=${encodeURIComponent(aisle)}${sub ? `&sub=${encodeURIComponent(sub)}` : ''}&page=${page}`);
  /** Storefronts that deliver to the household's address (cached a day). */
  stores = (hid: string) => this.#call<{ storefronts: { serviceSlug: string; brand: string; chainName: string; serviceType: string }[] }>('GET', `/households/${hid}/stores`);
  /** Live promotions across every store in the area, the household's own products first. */
  deals = (hid: string) => this.#call<{ deals: Deal[] }>('GET', `/households/${hid}/deals`);
  images = (hid: string, gtins: string[]) => this.#call<{ images: Record<string, string | null> }>('POST', `/households/${hid}/images`, { gtins });
  product = (hid: string, gtin: string) => this.#call<{ gtin: string; name: string; brand?: string; listings: { chainId: string; chainName: string; name: string }[]; imageUrl: string | null; prices: { storefrontId: string; brand: string; price: number; minimumOrder?: number; deliveryFee?: number }[]; priceMin?: number; priceMax?: number }>('GET', `/households/${hid}/product?gtin=${encodeURIComponent(gtin)}`);
  order = (hid: string, oid: string) => this.#call<Order>('GET', `/households/${hid}/orders/${oid}`);
  approveOrder = (hid: string, oid: string) => this.#call<Order>('POST', `/households/${hid}/orders/${oid}/approve`);
  cancelOrder = (hid: string, oid: string) => this.#call<Order>('POST', `/households/${hid}/orders/${oid}/cancel`);
  // --- connecting stores (ADR 0008) ---------------------------------------
  /** Which stores the cloud holds a session for (every device of the family sees the same answer). */
  connections = (hid: string) => this.#call<{ connections: Record<string, { connected: boolean; method?: 'device' | 'otp' | 'password'; since?: string }> }>('GET', `/households/${hid}/stores/connections`);
  /** Cloud rung: a one-time code (phone/e-mail) or a password used once. The password is sent over TLS and never stored. */
  connectStore = (hid: string, store: string, body: { method: 'otp'; phone?: string; email?: string } | { method: 'password'; email: string; password: string }) =>
    this.#call<{ challengeId?: string; sentTo?: string; connected?: boolean; method?: string }>('POST', `/households/${hid}/stores/${store}/connect`, body);
  verifyStore = (hid: string, store: string, challengeId: string, code: string) => this.#call<{ connected: boolean }>('POST', `/households/${hid}/stores/${store}/connect/verify`, { challengeId, code });
  /** Device rung: the phone captured the store's session after a sign-in in its WebView. */
  postStoreSession = (hid: string, store: string, session: { cookies: { name: string; value: string; domain?: string; path?: string }[]; tokens?: Record<string, string>; userAgent?: string }) =>
    this.#call<{ connected: boolean }>('POST', `/households/${hid}/stores/${store}/session`, session);
  disconnectStore = (hid: string, store: string) => this.#call<{ connected: boolean }>('DELETE', `/households/${hid}/stores/${store}/connection`);
  /** Past orders read through the cloud-held session, into the family's memory. */
  cloudImport = (hid: string, store: string) => this.#call<{ orders: number; products: number }>('POST', `/households/${hid}/stores/${store}/import`);
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
  /** The stores' own orders, imported from the phone. */
  history = (hid: string) => this.#call<{ stores: Record<string, { at: string; orders: StoreOrder[] }> }>('GET', `/households/${hid}/history`);
  recordShop = (hid: string, bought: PurchasedLine[]) => this.#call<unknown>('POST', `/households/${hid}/memory/shop`, { bought });
}

