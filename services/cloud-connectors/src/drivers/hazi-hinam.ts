/**
 * Hatzi Hinam (shop.hazi-hinam.co.il, Angular over a `/proxy/` gateway),
 * cloud rung: e-mail-or-ID + password used once.
 *
 * Verified 2026-09-10 against the live site, with a fake account:
 *   POST /proxy/Login  {grant_type:'password', userName, password, captchaToken:'', client_id:1}
 *        wrong details → 400 {"error":"אחד הפרטים שהכנסתם שגוי…"}; sets an H_UUID cookie
 *   GET  /proxy/api/user/info   the signed-in person (empty when anonymous)
 *
 * Its one-time code exists only inside "forgot password", so no OTP rung.
 */
import { cookieHeader } from '../cookie-jar.ts';
import { ConnectFailed, cookiesFrom, mergeCookies, type PastOrderRaw, type StoreDriver, type StoreSession } from '../driver.ts';

const HOST = 'shop.hazi-hinam.co.il';
const BASE = `https://${HOST}/proxy`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const headers = (session?: StoreSession): Record<string, string> => ({
  'user-agent': UA, accept: 'application/json', 'content-type': 'application/json; charset=utf-8', origin: `https://${HOST}`, referer: `https://${HOST}/`,
  ...(session ? { cookie: cookieHeader(session, HOST) } : {}),
  ...(session?.tokens?.['access_token'] ? { authorization: `Bearer ${session.tokens['access_token']}` } : {}),
});

/** Pull every token-looking field out of the login reply, whatever the casing. */
function tokensOf(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (o: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /token/i.test(k) && v.length > 8) out[k.replace(/^Access[_-]?Token$/i, 'access_token').replace(/^Refresh[_-]?Token$/i, 'refresh_token')] = v;
      else if (v && typeof v === 'object' && depth < 3) walk(v as Record<string, unknown>, depth + 1);
    }
  };
  walk(body, 0);
  return out;
}

export const haziHinamDriver: StoreDriver = {
  id: 'hazi-hinam',
  password: true,

  async passwordLogin(userName, password) {
    const res = await fetch(`${BASE}/Login`, {
      method: 'POST', redirect: 'manual', headers: headers(),
      body: JSON.stringify({ grant_type: 'password', userName, password, captchaToken: '', client_id: 1 }),
    }).catch(() => null);
    if (!res) throw new ConnectFailed('hazi-hinam', 'unavailable', 'login post failed');
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
    if (res.status === 400 || res.status === 401) throw new ConnectFailed('hazi-hinam', 'wrong_password', typeof body['error'] === 'string' ? body['error'] : undefined);
    if (res.status >= 300) throw new ConnectFailed('hazi-hinam', 'unavailable', `login ${res.status}`);
    const session: StoreSession = {
      retailer: 'hazi-hinam', capturedAt: new Date().toISOString(), userAgent: UA,
      cookies: mergeCookies([], cookiesFrom(res, `.${HOST.split('.').slice(-3).join('.')}`)),
      tokens: tokensOf(body),
    };
    if (!(await this.signedIn(session))) throw new ConnectFailed('hazi-hinam', 'wrong_password', 'store did not open a session');
    return session;
  },

  async signedIn(session) {
    const r = await fetch(`${BASE}/api/user/info`, { headers: headers(session), redirect: 'manual' }).catch(() => null);
    if (!r || r.status >= 300) return false;
    const t = (await r.text().catch(() => '')).trim();
    if (!t || t === 'null') return false;
    try { const j = JSON.parse(t) as Record<string, unknown>; return Object.keys(j).length > 0 && j['IsOK'] !== false; } catch { return false; }
  },

  async orderHistory(session, limit = 20): Promise<PastOrderRaw[]> {
    // The account's orders API is read the same way the site does; shapes are
    // tolerant because the endpoint was not exercised with a real account yet.
    const r = await fetch(`${BASE}/api/user/orders`, { headers: headers(session) }).catch(() => null);
    if (!r || r.status >= 300) return [];
    const j = (await r.json().catch(() => ({}))) as { Results?: unknown; Orders?: unknown; orders?: unknown };
    const arr = ([j.Results, j.Orders, j.orders].find(Array.isArray) ?? []) as { OrderDate?: string; Date?: string; Items?: unknown; Lines?: unknown; Products?: unknown }[];
    return arr.slice(0, limit).map((o) => {
      const items = ([o.Items, o.Lines, o.Products].find(Array.isArray) ?? []) as { Name?: string; ProductName?: string; Barcode?: string; Quantity?: number }[];
      return { at: o.OrderDate ?? o.Date ?? '', lines: items.filter((i) => i.Name || i.ProductName).map((i) => ({ name: String(i.Name ?? i.ProductName), ...(i.Barcode ? { code: String(i.Barcode) } : {}), qty: Number(i.Quantity ?? 1) || 1 })) };
    }).filter((o) => o.lines.length > 0);
  },
};
