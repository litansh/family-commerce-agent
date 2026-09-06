/**
 * Shufersal Online, driven server-side from a captured session — no browser,
 * no home machine. Verified 2026-09-06: Shufersal does not block datacenter
 * IPs, so a valid cookie jar is all the cloud needs.
 *
 * Every call is a plain HTTPS request carrying the session's cookies. The
 * endpoints are the site's own JSON endpoints, learned from the account
 * pages: authentication status, order history, wishlist (the cart Shufersal
 * itself lets a saved list become). Nothing here places an order without an
 * explicit approval token — the irreversible step is `placeOrder`.
 */
import { shekels, type Agorot } from '@fca/domain';
import { cookieHeader, cookieValue, type CapturedSession } from './cookie-jar.ts';

const HOST = 'www.shufersal.co.il';
const BASE = `https://${HOST}/online/he`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export interface CloudOrderLine {
  readonly lineId: string;
  readonly gtin?: string;
  readonly productName?: string;
  readonly query: string;
  readonly packQty?: number;
  readonly amount?: number;
}

export interface PastOrderRaw {
  readonly at: string;
  readonly lines: { name: string; code?: string; qty: number }[];
}

export class SessionExpired extends Error {
  constructor(retailer: string) {
    super(`${retailer}: the saved session is no longer signed in — sign in again in the app`);
    this.name = 'SessionExpired';
  }
}

export class ShufersalCloud {
  readonly #session: CapturedSession;
  constructor(session: CapturedSession) { this.#session = session; }

  #headers(json = true): Record<string, string> {
    const csrf = cookieValue(this.#session, 'XSRF-TOKEN');
    return {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
      cookie: cookieHeader(this.#session, HOST),
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(csrf ? { 'x-xsrf-token': csrf, 'csrf-token': csrf } : {}),
    };
  }

  async #get(path: string): Promise<Response> {
    return fetch(`${BASE}${path}`, { headers: this.#headers(false), redirect: 'manual' });
  }

  /** Ask Shufersal whether this session is a signed-in Online session. */
  async signedIn(): Promise<boolean> {
    const r = await this.#get('/authentication/get-status-includes-otp').catch(() => null);
    if (!r) return false;
    const t = (await r.text().catch(() => '')).trim();
    return t === 'true' || t.startsWith('{');
  }

  async #ensure(): Promise<void> {
    if (!(await this.signedIn())) throw new SessionExpired('shufersal');
  }

  /** Past orders: names, barcodes and quantities, newest first. */
  async orderHistory(limit = 30): Promise<PastOrderRaw[]> {
    await this.#ensure();
    const listRes = await this.#get('/my-account/orders');
    if (listRes.status >= 300) return [];
    const list = (await listRes.json().catch(() => ({}))) as { closedOrders?: { code: string; placed?: string; created?: string }[] };
    const out: PastOrderRaw[] = [];
    for (const o of (list.closedOrders ?? []).slice(0, limit)) {
      const dRes = await this.#get(`/my-account/orders/${o.code}`).catch(() => null);
      if (!dRes || dRes.status >= 300) continue;
      const d = (await dRes.json().catch(() => ({}))) as { entries?: { product?: { name?: string; code?: string; ean?: string }; quantity?: number }[] };
      const lines = (d.entries ?? [])
        .filter((e) => e.product?.name && !/משלוח|דמי/.test(e.product.name))
        .map((e) => { const code = e.product!.ean ?? e.product!.code; return { name: e.product!.name!, ...(code ? { code } : {}), qty: e.quantity ?? 1 }; });
      if (lines.length) out.push({ at: o.placed ?? o.created ?? new Date().toISOString(), lines });
    }
    return out;
  }

  /** Personal coupons loaded on the account. */
  async coupons(): Promise<{ id: string; retailer: string; title: string; gtin?: string; amountOff?: Agorot; percentOff?: number }[]> {
    await this.#ensure();
    const r = await this.#get('/my-account/coupons').catch(() => null);
    if (!r || r.status >= 300) return [];
    const d = (await r.json().catch(() => ({}))) as { coupons?: { code?: string; title?: string; name?: string; discountValue?: number; discountPercent?: number; ean?: string }[] };
    return (d.coupons ?? []).flatMap((c, i) => {
      if (c.discountValue == null && c.discountPercent == null) return [];
      return [{
        id: c.code ?? `sh-${i}`, retailer: 'shufersal', title: c.title ?? c.name ?? 'קופון',
        ...(c.ean ? { gtin: String(c.ean) } : {}),
        ...(c.discountValue != null ? { amountOff: shekels(c.discountValue) } : {}),
        ...(c.discountPercent != null ? { percentOff: c.discountPercent } : {}),
      }];
    });
  }
}
