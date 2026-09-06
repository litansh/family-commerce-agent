/**
 * Shufersal Online connector, driven by Playwright on the family's own
 * machine with the family's own saved session.
 *
 * Built on what a prior project learned the hard way: the site is a Vue SPA
 * behind a WAF that dislikes ordinary product names; Hebrew must be set
 * through the DOM rather than typed; an automated cart can vanish between
 * sessions. Selectors sit at the top so a site change is a one-place fix,
 * and every failure leaves a screenshot in trace/ because "it broke on step
 * four" is only useful if we can see step four.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { shekels, type Agorot, type Coupon } from '@fca/domain';
import type { CartLineResult, DeliverySlot, OrderLine, PastOrderRaw, PlacedOrder, PreparedOrder, RetailerConnector } from './connector.ts';
import { hasSession, loadSession, saveSession } from './session.ts';

const BASE = 'https://www.shufersal.co.il/online/he';

const SEL = {
  accountLink: 'a[href*="my-account"], .js-account-name',
  productCard: 'li[data-product-code], li.tileBlock, .productBox',
  productName: 'strong, .description, .text',
  addToCart: 'button.js-add-to-cart, button[aria-label*="הוסף"], .btnAddToCart',
  cartTotal: '.js-cart-totals .totals-value, .cart-total, .summaryTotal',
  checkoutBtn: 'a[href*="/checkout"], button.js-checkout',
  slotOption: '[data-slot-id], .time-slot, .slot',
  placeOrderBtn: 'button#placeOrder, button.js-place-order, button[type=submit].place-order',
  orderId: '.order-number, [data-order-code], .orderNumber',
};

export class ShufersalConnector implements RetailerConnector {
  readonly id = 'shufersal';
  #browser: Browser | undefined;
  #ctx?: BrowserContext;
  #page?: Page;
  #preparedTotal?: Agorot;
  readonly #householdId: string;
  readonly #traceDir: string;

  constructor(householdId: string, traceDir = 'trace') {
    this.#householdId = householdId;
    this.#traceDir = traceDir;
  }

  async #launch(): Promise<Browser> {
    // Headed on purpose: the WAF is far gentler with a real window, and the
    // person whose account this is can watch every step.
    if (!this.#browser) {
      this.#browser = await chromium.launch({ headless: process.env['KANILI_HEADLESS'] === '1', slowMo: 50 });
    }
    return this.#browser;
  }

  async #shot(name: string): Promise<string> {
    const path = `${this.#traceDir}/${Date.now()}-${this.id}-${name}.png`;
    await this.#page?.screenshot({ path }).catch(() => undefined);
    return path;
  }

  /**
   * Signed in means: not on the login page any more, and the page shows any
   * of the things only a signed-in person sees. Broad on purpose - the
   * post-login page changes, and a missed detection loses the session.
   */
  /**
   * Signed in means what Shufersal says it means: the site's own status
   * endpoint answers true for an authenticated Online session. Reading the
   * page for hints produced a false positive once and cost a session.
   */
  async #signedIn(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
      try {
        const r = await fetch('/online/he/authentication/get-status-includes-otp', { credentials: 'include', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
        const t = (await r.text()).trim();
        return t === 'true' || t.startsWith('{');
      } catch { return false; }
    }).catch(() => false);
  }

  async interactiveLogin(): Promise<BrowserContext> {
    const browser = await this.#launch();
    this.#ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 } });
    this.#page = await this.#ctx.newPage();
    await this.#page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    // Nobody remembers a retailer password. The SMS route lives under
    // "club member identification"; open it so the window lands on
    // "enter the code we sent to your phone".
    // Open the OTP route the family prefers ("club member identification");
    // the verification step below decides whether the resulting session is a
    // signed-in Online session, so this is safe to pre-open either way.
    await this.#page.waitForSelector('a.js-tikTalkLink', { timeout: 15_000 }).catch(() => undefined);
    await this.#page.locator('a.js-tikTalkLink').first().click({ timeout: 4000 }).catch(() => undefined);
    await this.#page.waitForTimeout(800);
    await this.#page.evaluate(() => {
      const form = document.querySelector<HTMLElement>('#loyaltyMemberDataForm');
      if (!form) return;
      let el: HTMLElement | null = form;
      while (el) { el.classList.remove('hidden'); el.style.display = ''; el = el.parentElement; }
      form.scrollIntoView({ block: 'center' });
      document.querySelector<HTMLInputElement>('#loyaltyMemberDataForm_idNumber')?.focus();
    }).catch(() => undefined);
    console.log('\n  The window opened on the OTP (club) sign-in. Complete it; when the site shows you signed in, press Enter here.');
    console.log('  When the site shows you signed in, press Enter here. Kanili then checks with Shufersal and saves only a session that really is signed in.\n');
    // Loop: wait for Enter (or automatic detection), verify against the
    // site, and either save or explain what Shufersal reported and wait again.
    const stdin = process.stdin;
    for (let attempt = 1; ; attempt += 1) {
      let manual = false;
      const onData = () => { manual = true; };
      stdin.resume(); stdin.on('data', onData);
      try {
        for (let i = 0; i < 900; i += 1) {
          if (manual || (await this.#signedIn(this.#page))) break;
          await this.#page.waitForTimeout(1000);
        }
      } finally { stdin.off('data', onData); stdin.pause(); }
      const verdict = await this.#verify(this.#page);
      if (verdict.ok) break;
      console.log(`\n  Not signed in to Shufersal Online yet (attempt ${attempt}):`);
      console.log(`    auth status endpoint: ${verdict.status}`);
      console.log(`    /my-account/orders  : ${verdict.ordersPage}`);
      console.log(`    cookies on the site : ${verdict.cookies}`);
      console.log('  The club "הזדהות חברי מועדון" identifies you for club prices but does not log into the store.');
      console.log('  Sign in to Online in the window (email + password, or Facebook), then press Enter again.\n');
      await this.#page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
    await saveSession(this.#householdId, this.id, this.#ctx);
    console.log('  Session saved. You will not need to sign in again until Shufersal expires it.\n');
    return this.#ctx;
  }

  async resume(): Promise<void> {
    if (!hasSession(this.#householdId, this.id)) throw new Error('shufersal: no saved session — run `npm run link -w @fca/order-worker`');
    const browser = await this.#launch();
    this.#ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 }, storageState: loadSession(this.#householdId, this.id) });
    this.#page = await this.#ctx.newPage();
    await this.#page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await this.#page.waitForTimeout(2500);
    if (!(await this.#signedIn(this.#page))) {
      await this.#shot('session-expired');
      throw new Error('shufersal: saved session expired — run `npm run link -w @fca/order-worker` again');
    }
  }

  /** The evidence: what the site itself says about this session. */
  async #verify(page: Page): Promise<{ ok: boolean; status: string; ordersPage: string; cookies: string }> {
    const status = await page.evaluate(async () => {
      try { const r = await fetch('/online/he/authentication/get-status-includes-otp', { credentials: 'include', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } }); return (await r.text()).trim().slice(0, 60); } catch (e) { return `error ${String(e)}`; }
    }).catch(() => 'unreachable');
    const ordersPage = await page.evaluate(async () => {
      try { const r = await fetch('/online/he/my-account/orders', { credentials: 'include', redirect: 'follow', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } }); return `${r.status} ${r.url.replace(location.origin, '')}`.slice(0, 80); } catch (e) { return `error ${String(e)}`; }
    }).catch(() => 'unreachable');
    const cookies = (await page.context().cookies('https://www.shufersal.co.il')).map((c) => c.name).filter((n) => !/^_|^ga|gtm|cf_|^AWS/i.test(n)).slice(0, 12).join(', ');
    const ok = status === 'true' || (ordersPage.startsWith('200') && !ordersPage.includes('/login'));
    return { ok, status, ordersPage, cookies };
  }

  #page$(): Page {
    if (!this.#page) throw new Error('shufersal: not connected');
    return this.#page;
  }

  async fillCart(lines: readonly OrderLine[]): Promise<readonly CartLineResult[]> {
    const page = this.#page$();
    const out: CartLineResult[] = [];
    for (const line of lines) {
      const q = line.gtin ?? line.productName ?? line.query;
      try {
        await page.goto(`${BASE}/search/results?q=${encodeURIComponent(q)}:relevance`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1800);
        const card = page.locator(SEL.productCard).first();
        if ((await card.count()) === 0) {
          out.push({ lineId: line.lineId, status: 'unavailable', note: 'no results' });
          continue;
        }
        const name = (await card.locator(SEL.productName).first().textContent().catch(() => null))?.trim();
        const qty = line.packQty ?? (line.amount !== undefined ? Math.max(1, Math.round(line.amount)) : 1);
        for (let i = 0; i < qty; i += 1) {
          await card.locator(SEL.addToCart).first().click();
          await page.waitForTimeout(600);
        }
        out.push({ lineId: line.lineId, status: line.gtin ? 'added' : 'substituted', ...(name ? { productName: name } : {}), qty });
      } catch (e) {
        await this.#shot(`add-${line.lineId}`);
        out.push({ lineId: line.lineId, status: 'unavailable', note: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  async listSlots(): Promise<readonly DeliverySlot[]> {
    const page = this.#page$();
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.locator(SEL.checkoutBtn).first().click();
    await page.waitForTimeout(3500);
    const raw = await page.locator(SEL.slotOption).evaluateAll((els) =>
      (els as HTMLElement[]).slice(0, 24).map((el, i) => ({
        id: el.getAttribute('data-slot-id') ?? String(i),
        label: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
    );
    if (raw.length === 0) await this.#shot('no-slots');
    return raw;
  }

  async prepare(slot: DeliverySlot): Promise<PreparedOrder> {
    const page = this.#page$();
    const idx = Number(slot.id);
    const option = Number.isFinite(idx) ? page.locator(SEL.slotOption).nth(idx) : page.locator(`[data-slot-id="${slot.id}"]`);
    await option.click();
    await page.waitForTimeout(2500);
    const totalText = (await page.locator(SEL.cartTotal).last().textContent().catch(() => '0')) ?? '0';
    const total = shekels(Number(totalText.replace(/[^\d.]/g, '')) || 0);
    this.#preparedTotal = total;
    const reviewShot = await this.#shot('review');
    return { retailer: this.id, total, slot, paymentMethod: 'the card saved at Shufersal', reviewShot };
  }

  async placeOrder(approvalToken: string): Promise<PlacedOrder> {
    if (!approvalToken) throw new Error('refusing to place an order without an approval token');
    const page = this.#page$();
    await page.locator(SEL.placeOrderBtn).first().click();
    await page.waitForTimeout(6000);
    const id = ((await page.locator(SEL.orderId).first().textContent().catch(() => null)) ?? '').trim() || `unknown-${Date.now()}`;
    const confirmationShot = await this.#shot('confirmation');
    return { retailerOrderId: id, confirmationShot };
  }

  /**
   * Order history through the site's own account endpoints, called from the
   * page so the session cookies apply. Documented by a prior project:
   * GET /my-account/orders → { closedOrders: [{ code, placed }] },
   * GET /my-account/orders/{code} → { entries: [{ product: { name, code }, quantity }] }.
   */
  async orderHistory(limit = 30): Promise<readonly PastOrderRaw[]> {
    const page = this.#page$();
    await page.goto(`${BASE}/my-account/orders`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const list = await page.evaluate(async () => {
      const r = await fetch('/online/he/my-account/orders', { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }, credentials: 'include' });
      const d = (await r.json()) as { closedOrders?: { code: string; placed?: string; created?: string }[] };
      return (d.closedOrders ?? []).map((o) => ({ code: o.code, at: o.placed ?? o.created ?? '' }));
    }).catch(() => [] as { code: string; at: string }[]);
    const out: PastOrderRaw[] = [];
    for (const o of list.slice(0, limit)) {
      const lines = await page.evaluate(async (code) => {
        const r = await fetch(`/online/he/my-account/orders/${code}`, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }, credentials: 'include' });
        const d = (await r.json()) as { entries?: { product?: { name?: string; code?: string; ean?: string }; quantity?: number }[] };
        return (d.entries ?? []).filter((e) => e.product?.name && !/משלוח|דמי/.test(e.product.name)).map((e) => ({ name: e.product!.name!, code: e.product!.ean ?? e.product!.code, qty: e.quantity ?? 1 }));
      }, o.code).catch(() => [] as { name: string; code?: string; qty: number }[]);
      if (lines.length > 0) out.push({ at: o.at || new Date().toISOString(), lines });
      await page.waitForTimeout(400);
    }
    if (out.length === 0) await this.#shot('history-empty');
    return out;
  }

  /**
   * My Shufersal coupons. The account exposes them as JSON to a signed-in
   * session; the exact path is confirmed on the first real run (the trace
   * keeps the raw body), so this tries the known candidates and parses the
   * common shape: title, discount, optional product code, expiry.
   */
  async coupons(): Promise<readonly Coupon[]> {
    const page = this.#page$();
    await page.goto(`${BASE}/my-account/coupons`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const raw = await page.evaluate(async () => {
      for (const path of ['/online/he/my-account/coupons', '/online/he/coupons', '/online/he/my-account/my-coupons']) {
        try {
          const r = await fetch(path, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }, credentials: 'include' });
          if (!r.ok) continue;
          const d = (await r.json()) as unknown;
          return { path, d };
        } catch { /* next */ }
      }
      return null;
    }).catch(() => null);
    if (!raw) { await this.#shot('coupons-unknown'); return []; }
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${this.#traceDir}/${Date.now()}-shufersal-coupons.json`, JSON.stringify(raw).slice(0, 200_000));
    const list = ((raw.d as { coupons?: unknown[]; results?: unknown[] }).coupons ?? (raw.d as { results?: unknown[] }).results ?? []) as {
      code?: string; id?: string; name?: string; title?: string; description?: string; discountValue?: number; value?: number; percent?: number; discountPercent?: number; productCode?: string; ean?: string; barcode?: string; endDate?: string; expiryDate?: string;
    }[];
    return list.flatMap((c, i) => {
      const amount = c.discountValue ?? c.value;
      const pct = c.discountPercent ?? c.percent;
      if (amount === undefined && pct === undefined) return [];
      const gtin = c.ean ?? c.barcode;
      return [{
        id: c.code ?? c.id ?? `sh-${i}`, retailer: 'shufersal', title: c.title ?? c.name ?? c.description ?? 'קופון',
        ...(gtin ? { gtin: String(gtin) } : c.name ? { nameMatch: c.name.split(' ').slice(0, 2).join(' ') } : {}),
        ...(amount !== undefined ? { amountOff: shekels(amount) } : {}), ...(pct !== undefined ? { percentOff: pct } : {}),
        ...(c.endDate ?? c.expiryDate ? { expiresAt: String(c.endDate ?? c.expiryDate) } : {}),
      } satisfies Coupon];
    });
  }

  get preparedTotal(): Agorot | undefined {
    return this.#preparedTotal;
  }

  async close(): Promise<void> {
    const b = this.#browser;
    this.#browser = undefined;
    await b?.close();
  }
}
