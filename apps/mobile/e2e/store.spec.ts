/**
 * End-to-end: the store flow on the live site, as a person taps it.
 *
 *   KANILI_E2E_TOKEN=<cognito id token> npx playwright test
 *
 * Signs in by injecting a token (no password anywhere), opens an aisle,
 * switches sub-aisles, opens a product sheet, and asserts that products and
 * their pictures actually rendered. Fails loudly with a screenshot.
 */
import { test, expect, type Page } from '@playwright/test';

const SITE = process.env['KANILI_E2E_SITE'] ?? 'https://d3lykvs28o7qrc.cloudfront.net';
const TOKEN = process.env['KANILI_E2E_TOKEN'] ?? '';
const SHOTS = 'e2e/shots';

/**
 * Three lenses on every screen the test reaches - a graphic designer, a UX
 * reviewer, and a person who downloaded the app to do exactly what it
 * promises. The mechanical parts are asserted; the judgement parts are
 * captured as screenshots for the review in docs/e2e-review.md.
 */
async function lenses(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const skeletons = await page.locator('[style*="opacity: 0.6"]').count();
  // React Native on the web renders pressables as focusable divs, not <button>.
  const buttons = await page.locator('button, [role="button"], div[tabindex="0"]').count();
  const latinUi = await page.evaluate(() => [...document.querySelectorAll('div,span')].map((e) => e.textContent ?? '').filter((t) => /^[A-Za-z ]{4,}$/.test(t.trim()) && !/Kanili|English|Smoke family|ONLINE/.test(t)).slice(0, 5));
  expect(skeletons, `${name}: still showing skeleton placeholders`).toBeLessThan(3);
  expect(buttons, `${name}: no tappable action on screen`).toBeGreaterThan(0);
  expect(latinUi, `${name}: English UI text on a Hebrew screen`).toEqual([]);
}

async function signIn(page: Page): Promise<void> {
  await page.goto(SITE);
  await page.evaluate((tok) => {
    localStorage.setItem('fca.tokens', JSON.stringify({ idToken: tok, accessToken: 'x', expiresAt: Date.now() + 3_000_000 }));
    localStorage.setItem('fca.intro.seen', '1');
    localStorage.removeItem('fca.list');
  }, TOKEN);
  await page.goto(`${SITE}/?e2e=${Date.now()}`);
  await expect(page.getByText('המחלקות')).toBeVisible({ timeout: 20_000 });
}

/** How many <img> on the page have actually painted pixels. */
const loadedImages = (page: Page) =>
  page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return { total: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
  });

test.describe('store', () => {
  test.skip(!TOKEN, 'KANILI_E2E_TOKEN is required');

  test('aisle → sub-aisle → product sheet, with pictures', async ({ page }) => {
    await signIn(page);

    await lenses(page, '01-home');
    await page.getByText('חלב וביצים').first().click();
    await expect(page.getByText(/^\d+ מוצרים$/)).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1500);
    await lenses(page, '02-aisle-dairy');

    // Sub-aisle chips exist and the first one is active.
    const cheese = page.getByText('גבינות', { exact: true });
    await expect(cheese).toBeVisible();
    const cardsBefore = await page.locator('text=/^₪\\d/').count();
    expect(cardsBefore).toBeGreaterThan(5);

    // Switching sub-aisles must not blank the screen.
    await cheese.click();
    await expect(cheese).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^\d+ מוצרים$/)).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1500);
    const cardsAfter = await page.locator('text=/^₪\\d/').count();
    expect(cardsAfter, 'sub-aisle switch should render a grid').toBeGreaterThan(5);
    await lenses(page, '03-subaisle-cheese');

    // Pictures: give lazy ones a moment, then most must have painted.
    await page.waitForTimeout(4000);
    const imgs = await loadedImages(page);
    expect(imgs.total, 'cards should carry <img>').toBeGreaterThan(5);
    expect(imgs.loaded / imgs.total, `only ${imgs.loaded}/${imgs.total} images painted`).toBeGreaterThan(0.8);

    // Product sheet with per-chain prices.
    await page.locator('text=/^₪\\d/').first().click();
    await expect(page.getByText(/המחיר בכל רשת|נמכר ב/)).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1000);
    await lenses(page, '04-product-sheet');
  });

  test('search-as-you-type shows photo cards', async ({ page }) => {
    await signIn(page);
    await page.getByText('רשימה').click();
    await page.getByPlaceholder('מה צריך?').fill('קוטג');
    await expect(page.getByText(/^₪\d/).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const imgs = await loadedImages(page);
    expect(imgs.loaded, `search images painted: ${imgs.loaded}/${imgs.total}`).toBeGreaterThan(3);
    await lenses(page, '05-search');
  });

  test('sign-in screen', async ({ page }) => {
    await page.goto(SITE);
    await page.evaluate(() => { localStorage.removeItem('fca.tokens'); });
    await page.goto(`${SITE}/?e2e=${Date.now()}`);
    await expect(page.getByText('כניסה', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await lenses(page, '00-signin');
  });
});
