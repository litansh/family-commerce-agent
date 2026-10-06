/**
 * Shufersal Online (SAP Hybris), cloud rung: e-mail + password used once.
 *
 * Verified 2026-09-10 against the live site, with a fake account:
 *   GET  /online/he/login                    → JSESSIONID + XSRF-TOKEN cookies, <input name="CSRFToken">
 *   POST /online/he/j_spring_security_check  fail_url, j_username, j_password, remember-me, CSRFToken
 *        wrong password → 302 /online/he/login/?error=true
 *   GET  /online/he/authentication/get-status-includes-otp → "false" when anonymous
 *
 * Shufersal has no one-time-code sign-in for Online (its OTP identifies club
 * members for prices only — ADR 0007), so this driver has no OTP rung.
 */
import { ShufersalCloud } from '../shufersal-cloud.ts';
import { cookieHeader, type Cookie } from '../cookie-jar.ts';
import { ConnectFailed, cookiesFrom, mergeCookies, type StoreDriver, type StoreSession } from '../driver.ts';

const HOST = 'www.shufersal.co.il';
const BASE = `https://${HOST}/online/he`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const shufersalDriver: StoreDriver = {
  id: 'shufersal',
  password: true,

  async passwordLogin(email, password) {
    const page = await fetch(`${BASE}/login`, { headers: { 'user-agent': UA, 'accept-language': 'he-IL' }, redirect: 'manual' }).catch(() => null);
    if (!page || page.status >= 400) throw new ConnectFailed('shufersal', 'unavailable', `login page ${page?.status ?? 'unreachable'}`);
    const html = await page.text();
    const csrf = /name="CSRFToken"\s+value="([^"]+)"/.exec(html)?.[1];
    if (!csrf) throw new ConnectFailed('shufersal', 'unavailable', 'no CSRF token on the login page');
    let cookies: Cookie[] = cookiesFrom(page, `.${HOST.replace(/^www\./, '')}`);
    const pre: StoreSession = { retailer: 'shufersal', cookies, capturedAt: new Date().toISOString() };
    const body = new URLSearchParams({ fail_url: '/login/?error=true', j_username: email, j_password: password, 'remember-me': 'True', CSRFToken: csrf });
    const res = await fetch(`${BASE}/j_spring_security_check`, {
      method: 'POST', redirect: 'manual',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', origin: `https://${HOST}`, referer: `${BASE}/login`, cookie: cookieHeader(pre, HOST) },
      body: body.toString(),
    }).catch(() => null);
    if (!res) throw new ConnectFailed('shufersal', 'unavailable', 'login post failed');
    const to = res.headers.get('location') ?? '';
    if (/error=true/.test(to) || res.status >= 400) throw new ConnectFailed('shufersal', 'wrong_password');
    cookies = mergeCookies(cookies, cookiesFrom(res, `.${HOST.replace(/^www\./, '')}`));
    const session: StoreSession = { retailer: 'shufersal', cookies, capturedAt: new Date().toISOString(), userAgent: UA };
    if (!(await this.signedIn(session))) throw new ConnectFailed('shufersal', 'wrong_password', 'store did not open a session');
    return session;
  },

  signedIn: (session) => new ShufersalCloud(session).signedIn(),
  orderHistory: (session, limit) => new ShufersalCloud(session).orderHistory(limit),
};
