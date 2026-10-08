/**
 * Shufersal's own product page → its photograph. Pure functions only: the fetch happens in
 * `refresh-chain-images.mjs` on the ops Mac, never here and never from the API Lambda (ADR 0011).
 * `index.ts` does not import this file.
 *
 * Shufersal publishes a product at `/online/he/p/P_<code>`. For a packaged product the code is the
 * barcode itself (Lego 5702016617740 → P_5702016617740). For an item Shufersal weighs or packs in
 * store, the promotion carries a GS1-Israel barcode `729000…` and the site carries the chain's
 * internal code with that prefix removed (7290000915883 minced beef → P_915883). That second guess
 * can land on another product, so a page counts only when its own title shares words with the deal's
 * name. No match leaves a drawn icon, which is better than a wrong photo.
 */

/** Product-page codes to try for a barcode, most specific first. */
export function shufersalCodes(gtin: string): string[] {
  const out = [gtin];
  const m = /^729000+(\d{4,})$/.exec(gtin);
  if (m && m[1] !== gtin) out.push(m[1]!);
  return out;
}

const decode = (s: string): string => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The page's own og:title and og:image, if it is a product page for `code`. */
export function readShufersalPage(html: string, code: string): { title: string; image: string } | null {
  if (/cf-chl|challenge-platform|Just a moment/i.test(html)) return null;
  if (!html.includes(`data-product-code="P_${code}"`)) return null;
  const title = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const image = /<meta property="og:image" content="(https:\/\/res\.cloudinary\.com\/shufersal\/[^"]*product_images[^"]*)"/.exec(html)?.[1];
  if (!title || !image) return null;
  return { title: decode(title).trim(), image };
}

const words = (s: string): string[] => s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));

/**
 * Do the deal's name and the page's title describe the same product? At least two shared words (of
 * three letters or more): one word such as "טרי" (fresh) is shared by half the shop. Hebrew words are compared on their first three letters so a
 * prefix or plural (שוקי / שוקיים) still meets.
 */
export function sameProduct(dealName: string, pageTitle: string): boolean {
  const stem = (w: string) => w.slice(0, Math.max(3, w.length - 2));
  const a = new Set(words(dealName).map(stem));
  const b = words(pageTitle).map(stem);
  const shared = b.filter((w) => a.has(w) || [...a].some((x) => x.length >= 3 && w.length >= 3 && (x.startsWith(w) || w.startsWith(x)))).length;
  return shared >= 2;
}
