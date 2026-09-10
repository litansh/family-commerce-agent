/**
 * The web's "connect a store" flow (ADR 0008) against the exported web build
 * with the API mocked in the browser - no AWS, no token, no real store.
 *
 *   npx expo export --platform web --output-dir dist && npx playwright test e2e/connect.spec.ts
 *
 * What it proves: on the web every store says "from your phone" instead of a
 * dead end (no grocery store lets AWS in - verified 2026-09-10), "connected"
 * comes from the cloud where the phone put it, and the sign-up guide lists
 * what the store asks and opens the store's own page.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SITE = process.env['KANITI_E2E_SITE'] ?? 'http://localhost:4173';
const H = { id: 'h1', name: 'משפחת בדיקה', address: 'הרצל 1, רמת גן', country: 'IL', retailers: ['shufersal'], fulfillment: 'either' };

/** A tiny in-page API: the routes the app touches on the way to Me, plus the connect routes with state. */
async function mockApi(page: Page): Promise<{ calls: { method: string; path: string; body: unknown }[]; state: Record<string, { connected: boolean; method: string }> }> {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const state: Record<string, { connected: boolean; method: string }> = {};
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  await page.route('**/*.amazonaws.com/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    if (method === 'OPTIONS') return json(route, {}, 204);
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { /* no body */ }
    calls.push({ method, path, body });
    if (path === '/me') return json(route, { userId: 'u1', email: 'lab@example.com', households: [H] });
    if (path === '/households/h1') return json(route, H);
    if (path === '/households/h1/stores') return json(route, { storefronts: [{ serviceSlug: 'shufersal-online', brand: 'שופרסל', chainName: 'שופרסל', serviceType: 'delivery' }, { serviceSlug: 'rami-levy-online', brand: 'רמי לוי', chainName: 'רמי לוי', serviceType: 'delivery' }] });
    if (path === '/households/h1/stores/connections') return json(route, { connections: state });
    const m = /^\/households\/h1\/stores\/([a-z-]+)\/(connect|connect\/verify|import|connection|session)$/.exec(path);
    if (m) {
      const [, store, action] = m;
      const b = (body ?? {}) as Record<string, string>;
      if (action === 'connect') {
        if (store !== 'shufersal') return json(route, { error: 'no_password' }, 422);
        if (b['method'] !== 'password' || !b['email'] || !b['password']) return json(route, { error: 'bad request' }, 400);
        if (b['password'] === 'wrong') return json(route, { error: 'wrong_password' }, 401);
        state[store!] = { connected: true, method: 'password' };
        return json(route, { connected: true, method: 'password' });
      }
      if (action === 'import') return json(route, { orders: 3, products: 12 });
      if (action === 'connection' && method === 'DELETE') { delete state[store!]; return json(route, { connected: false }); }
    }
    if (path === '/households/h1/worker') return json(route, { online: false, lastSeen: null, linked: {} });
    if (path === '/households/h1/memory') return json(route, { version: 0, products: {} });
    if (path === '/households/h1/deals') return json(route, { deals: [] });
    if (path === '/households/h1/aisles') return json(route, { aisles: [] });
    if (path.endsWith('/suggest')) return json(route, { suggestions: [] });
    if (path.startsWith('/households/h1/imports/')) return json(route, { retailer: 'x', status: 'idle' });
    return json(route, {});
  });
  return { calls, state };
}

async function openMe(page: Page): Promise<void> {
  await page.goto(SITE);
  await page.evaluate(() => {
    localStorage.setItem('fca.tokens', JSON.stringify({ idToken: 'e2e', accessToken: 'e2e', expiresAt: Date.now() + 3_000_000 }));
    localStorage.setItem('fca.intro.seen', '1');
    localStorage.removeItem('fca.linked');
  });
  await page.goto(`${SITE}/?e2e=${Date.now()}`);
  await page.getByText('אני', { exact: true }).last().click();
  await expect(page.getByText('החנויות המחוברות')).toBeVisible({ timeout: 20_000 });
}

/** The "connect" link on the row of one store in Me. */
const connectRow = (page: Page, storeName: string) => page.locator('div', { hasText: new RegExp(`^${storeName}`) }).filter({ has: page.getByText('חברו', { exact: true }) }).last().getByText('חברו', { exact: true });

test.describe('connect a store on the web', () => {
  test('Me on the web: every store connects from the phone, and "connected" comes from the cloud', async ({ page }) => {
    const { calls, state } = await mockApi(page);
    state['shufersal'] = { connected: true, method: 'device' }; // connected on a phone earlier
    await openMe(page);
    await expect(page.getByText('מהטלפון').first()).toBeVisible();
    await expect(page.getByText('מהאתר')).toHaveCount(0);
    await expect(page.locator('div', { hasText: /^שופרסל/ }).filter({ has: page.getByText('מחובר', { exact: true }) }).first()).toBeVisible({ timeout: 10_000 });
    expect(calls.some((c) => c.path === '/households/h1/stores/connections')).toBe(true);
    await page.screenshot({ path: 'e2e/shots/connect-00-me.png' });
    await connectRow(page, 'רמי לוי').click();
    await expect(page.getByText('חברו את רמי לוי מהטלפון')).toBeVisible();
    await expect(page.getByTestId('cloud-password')).toHaveCount(0);
  });

  test('Rami Levy on the web: honest "from your phone", with the sign-up guide', async ({ page, context }) => {
    await mockApi(page);
    await openMe(page);
    await connectRow(page, 'רמי לוי').click();
    await expect(page.getByText('חברו את רמי לוי מהטלפון')).toBeVisible();
    await expect(page.getByText(/פתחו את קניתי בטלפון/)).toBeVisible();
    await page.screenshot({ path: 'e2e/shots/connect-05-phone-only.png' });
    await page.getByText('אין לכם חשבון ברמי לוי?').click();
    await expect(page.getByText('חשבון חדש ברמי לוי')).toBeVisible();
    await expect(page.getByText('קוד שיגיע ב-SMS / במייל')).toBeVisible();
    await page.screenshot({ path: 'e2e/shots/connect-06-signup-guide.png' });
  });

  test('sign-up guide: what Shufersal asks, the known values ready, the store page opens', async ({ page, context }) => {
    await mockApi(page);
    await openMe(page);
    await connectRow(page, 'שופרסל').click();
    await page.getByText('אין לכם חשבון בשופרסל?').click();
    await expect(page.getByText('חשבון חדש בשופרסל')).toBeVisible();
    for (const f of ['שם פרטי ומשפחה', 'תעודת זהות', 'טלפון נייד', 'אימייל', 'תאריך לידה', 'סיסמה חדשה']) await expect(page.getByText(f, { exact: true })).toBeVisible();
    // The e-mail is known and copyable; the ID number is the person's alone.
    await expect(page.getByText('lab@example.com')).toBeVisible();
    expect(await page.getByText('העתק', { exact: true }).count()).toBe(1);
    expect(await page.getByText('תמלאו בעצמכם', { exact: true }).count()).toBeGreaterThanOrEqual(4);
    const popup = context.waitForEvent('page');
    await page.getByTestId('signup-open').click();
    const p = await popup;
    expect(p.url()).toContain('shufersal.co.il/online/he/register');
    await p.close();
    await page.screenshot({ path: 'e2e/shots/connect-07-signup-shufersal.png' });
  });
});
