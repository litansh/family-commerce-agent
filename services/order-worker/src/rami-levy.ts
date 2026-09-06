/**
 * Rami Levy Online connector.
 *
 * Nuxt storefront with a public catalogue API (used elsewhere for prices and
 * images); the cart and checkout are only reachable through the site, so
 * this drives the page with the family's saved session, like Shufersal.
 *
 * Selectors are best readings of the site until a real session confirms
 * them. Every step that misses its selector leaves a screenshot AND a short
 * DOM dump in trace/, so the fix is one look rather than a guessing round.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { shekels, type Agorot } from '@fca/domain';
import type { CartLineResult, DeliverySlot, OrderLine, PastOrderRaw, PlacedOrder, PreparedOrder, RetailerConnector } from './connector.ts';
import { hasSession, loadSession, saveSession } from './session.ts';
import { writeFileSync } from 'node:fs';

const BASE = 'https://www.rami-levy.co.il';

const SEL = {
  accountMarker: '[class*="user-name"], [class*="account"] [class*="name"], a[href*="/he/online/my-account"]',
  productCard: '[class*="product-card"], [class*="ProductCard"], .product',
  productName: '[class*="name"], [class*="title"]',
  addToCart: 'button[class*="add"], [class*="add-to-cart"] button, button:has-text("הוסף")',
  cartTotal: '[class*="total"] [class*="price"], [class*="cart-total"], [class*="summary"] [class*="total"]',
  checkoutBtn: 'a[href*="checkout"], button:has-text("לתשלום"), button:has-text("המשך")',
  slotOption: '[class*="slot"], [class*="time"] [class*="option"], [class*="delivery-time"] button',
  placeOrderBtn: 'button:has-text("סיום הזמנה"), button:has-text("אישור הזמנה"), button[class*="place"]',
  orderId: '[class*="order-number"], [class*="orderNumber"], :text("מספר הזמנה")',
};

export class RamiLevyConnector implements RetailerConnector {
  readonly id = 'rami-levy';
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
    if (!this.#browser) this.#browser = await chromium.launch({ headless: process.env['KANILI_HEADLESS'] === '1', slowMo: 50 });
    return this.#browser;
  }

  /** Screenshot plus a trimmed DOM dump: what the page actually looked like when a selector missed. */
  async #trace(name: string): Promise<string> {
    const stamp = `${this.#traceDir}/${Date.now()}-${this.id}-${name}`;
    await this.#page?.screenshot({ path: `${stamp}.png` }).catch(() => undefined);
    const html = await this.#page?.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' ').slice(0, 60_000)).catch(() => '');
    if (html) writeFileSync(`${stamp}.html`, html);
    return `${stamp}.png`;
  }

  async #signedIn(page: Page): Promise<boolean> {
    return (await page.locator(SEL.accountMarker).count()) > 0;
  }

  async interactiveLogin(): Promise<BrowserContext> {
    const browser = await this.#launch();
    this.#ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 } });
    this.#page = await this.#ctx.newPage();
    await this.#page.goto(`${BASE}/he/online`, { waitUntil: 'domcontentloaded' });
    console.log('\n  Sign in to Rami Levy in the window that just opened (use the account menu). Kanili is waiting…\n');
    for (let i = 0; i < 600; i += 1) {
      if (await this.#signedIn(this.#page)) break;
      await this.#page.waitForTimeout(1000);
    }
    if (!(await this.#signedIn(this.#page))) { await this.#trace('login-timeout'); throw new Error('rami-levy: sign-in did not complete within 10 minutes'); }
    await saveSession(this.#householdId, this.id, this.#ctx);
    console.log('  Session saved.\n');
    return this.#ctx;
  }

  async resume(): Promise<void> {
    if (!hasSession(this.#householdId, this.id)) throw new Error('rami-levy: no saved session — run `KANILI_RETAILER=rami-levy npm run link -w @fca/order-worker`');
    const browser = await this.#launch();
    this.#ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 }, storageState: loadSession(this.#householdId, this.id) });
    this.#page = await this.#ctx.newPage();
    await this.#page.goto(`${BASE}/he/online`, { waitUntil: 'domcontentloaded' });
    await this.#page.waitForTimeout(3000);
    if (!(await this.#signedIn(this.#page))) { await this.#trace('session-expired'); throw new Error('rami-levy: saved session expired — link again'); }
  }

  #page$(): Page {
    if (!this.#page) throw new Error('rami-levy: not connected');
    return this.#page;
  }

  async fillCart(lines: readonly OrderLine[]): Promise<readonly CartLineResult[]> {
    const page = this.#page$();
    const out: CartLineResult[] = [];
    for (const line of lines) {
      try {
        // The site deep-links by barcode; that is the most exact entry we have.
        const url = line.gtin ? `${BASE}/he/online/search?item=${line.gtin}` : `${BASE}/he/online/search?q=${encodeURIComponent(line.productName ?? line.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        const card = page.locator(SEL.productCard).first();
        if ((await card.count()) === 0) { await this.#trace(`no-card-${line.lineId}`); out.push({ lineId: line.lineId, status: 'unavailable', note: 'no results' }); continue; }
        const name = (await card.locator(SEL.productName).first().textContent().catch(() => null))?.trim();
        const qty = line.packQty ?? (line.amount !== undefined ? Math.max(1, Math.round(line.amount)) : 1);
        for (let i = 0; i < qty; i += 1) { await card.locator(SEL.addToCart).first().click(); await page.waitForTimeout(700); }
        out.push({ lineId: line.lineId, status: line.gtin ? 'added' : 'substituted', ...(name ? { productName: name } : {}), qty });
      } catch (e) {
        await this.#trace(`add-${line.lineId}`);
        out.push({ lineId: line.lineId, status: 'unavailable', note: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  async listSlots(): Promise<readonly DeliverySlot[]> {
    const page = this.#page$();
    await page.goto(`${BASE}/he/online/cart`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.locator(SEL.checkoutBtn).first().click().catch(async () => { await this.#trace('no-checkout-btn'); });
    await page.waitForTimeout(3500);
    const raw = await page.locator(SEL.slotOption).evaluateAll((els) =>
      (els as HTMLElement[]).slice(0, 24).map((el, i) => ({ id: String(i), label: (el.textContent ?? '').replace(/\s+/g, ' ').trim() })).filter((s) => s.label.length > 0),
    );
    if (raw.length === 0) await this.#trace('no-slots');
    return raw;
  }

  async prepare(slot: DeliverySlot): Promise<PreparedOrder> {
    const page = this.#page$();
    await page.locator(SEL.slotOption).nth(Number(slot.id) || 0).click().catch(() => undefined);
    await page.waitForTimeout(2500);
    const totalText = (await page.locator(SEL.cartTotal).last().textContent().catch(() => '0')) ?? '0';
    const total = shekels(Number(totalText.replace(/[^\d.]/g, '')) || 0);
    if (total === 0) await this.#trace('no-total');
    this.#preparedTotal = total;
    const reviewShot = await this.#trace('review');
    return { retailer: this.id, total, slot, paymentMethod: 'the card saved at Rami Levy', reviewShot };
  }

  async placeOrder(approvalToken: string): Promise<PlacedOrder> {
    if (!approvalToken) throw new Error('refusing to place an order without an approval token');
    const page = this.#page$();
    await page.locator(SEL.placeOrderBtn).first().click();
    await page.waitForTimeout(6000);
    const id = ((await page.locator(SEL.orderId).first().textContent().catch(() => null)) ?? '').replace(/\D+/g, '') || `unknown-${Date.now()}`;
    const confirmationShot = await this.#trace('confirmation');
    return { retailerOrderId: id, confirmationShot };
  }

  async orderHistory(limit = 30): Promise<readonly PastOrderRaw[]> {
    const page = this.#page$();
    await page.goto(`${BASE}/he/online/my-account/orders`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    // The account pages load their data through the site's own API with the
    // session cookie; the response shape is discovered on first real run —
    // the trace keeps the network body for it.
    const orders = await page.evaluate(async () => {
      const candidates = ['/api/v2/site/orders', '/api/orders', '/api/v2/orders'];
      for (const path of candidates) {
        try {
          const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } });
          if (!r.ok) continue;
          const d = (await r.json()) as unknown;
          return { path, d };
        } catch { /* next */ }
      }
      return null;
    }).catch(() => null);
    if (!orders) { await this.#trace('history-api-unknown'); return []; }
    writeFileSync(`${this.#traceDir}/${Date.now()}-rami-levy-history.json`, JSON.stringify(orders).slice(0, 200_000));
    const list = (orders.d as { data?: { id?: number; created_at?: string; date?: string; items?: { name?: string; barcode?: string | number; quantity?: number }[] }[] }).data ?? [];
    return list.slice(0, limit).map((o) => ({
      at: o.created_at ?? o.date ?? new Date().toISOString(),
      lines: (o.items ?? []).filter((i) => i.name).map((i) => ({ name: i.name!, code: i.barcode !== undefined ? String(i.barcode) : undefined, qty: i.quantity ?? 1 })),
    }));
  }

  get preparedTotal(): Agorot | undefined { return this.#preparedTotal; }

  async close(): Promise<void> {
    const b = this.#browser; this.#browser = undefined; await b?.close();
  }
}
