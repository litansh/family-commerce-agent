/**
 * The price-transparency files (חוק שקיפות מחירים): every chain publishes, per
 * branch, a full price list, and one Stores file naming its branches. The XML
 * dialects differ in tag case (StoreID / StoreId, ZIPCode / ZipCode), in encoding
 * (UTF-8 with or without BOM, UTF-16LE at Rami Levy), and in whether the file is
 * gzipped or bare. This module reads all of them into two plain shapes.
 */
import { gunzipSync } from 'node:zlib';

export interface Branch {
  readonly chainId: string;
  readonly subChainId: string;
  readonly storeId: string;
  readonly name: string;
  readonly address: string;
  /** As published: a Hebrew city name, or a CBS settlement code (Shufersal, Rami Levy). */
  readonly city: string;
  readonly zip?: string;
  /** Some chains publish coordinates themselves (Hatzi Hinam's branch API); the rest are geocoded later. */
  readonly lat?: number;
  readonly lng?: number;
}

/** One branch's price list: barcode → [price in agorot, name]. Compact on purpose (it is stored and shipped as JSON). */
export type PriceIndex = Record<string, [number, string]>;

export interface PriceFile {
  readonly chainId: string;
  readonly storeId: string;
  readonly prices: PriceIndex;
}

/** Bytes → text: gunzip if compressed, then honour the BOM. */
export function decodeXml(buf: Buffer): string {
  const bytes = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  const text = bytes.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]!.trim()) : '';
};
const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  // Some chains leave carriage returns and tabs inside addresses.
  .replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Every branch in a Stores file. */
export function parseStores(xml: string): Branch[] {
  const chainId = tag(xml, 'ChainID') || tag(xml, 'ChainId');
  const out: Branch[] = [];
  // Sub-chains wrap their stores; a file without sub-chains is one implicit sub-chain.
  const subs = [...xml.matchAll(/<SubChain>([\s\S]*?)<\/SubChain>/gi)];
  const groups = subs.length ? subs.map((m) => m[1]!) : [xml];
  for (const g of groups) {
    const subChainId = tag(g, 'SubChainID') || tag(g, 'SubChainId') || '0';
    // laibcatalog's older files wrap each branch in <Branch> instead of <Store>.
    for (const s of g.matchAll(/<(Store|Branch)>([\s\S]*?)<\/\1>/gi)) {
      const b = s[2]!;
      const storeId = tag(b, 'StoreID') || tag(b, 'StoreId');
      if (!storeId) continue;
      const zip = tag(b, 'ZIPCode') || tag(b, 'ZipCode');
      out.push({ chainId: tag(b, 'ChainID') || chainId, subChainId, storeId, name: tag(b, 'StoreName'), address: tag(b, 'Address'), city: tag(b, 'City'), ...(zip ? { zip } : {}) });
    }
  }
  return out;
}

/** A PriceFull file → barcode index. Only real barcodes (8+ digits) are kept: internal codes never match a shopping list. */
export function parsePriceFull(xml: string): PriceFile {
  const head = xml.slice(0, 2000);
  const chainId = tag(head, 'ChainID') || tag(head, 'ChainId');
  const storeId = tag(head, 'StoreID') || tag(head, 'StoreId');
  const prices: PriceIndex = {};
  for (const m of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/gi)) {
    const b = m[1]!;
    const code = tag(b, 'ItemCode');
    if (!/^\d{8,14}$/.test(code)) continue;
    const price = Number(tag(b, 'ItemPrice'));
    if (!(price > 0)) continue;
    // Weighed goods are priced per kilo, not per pack: a list line "tomatoes" is not one kilo.
    if (tag(b, 'bIsWeighted') === '1') continue;
    prices[code] = [Math.round(price * 100), tag(b, 'ItemName')];
  }
  return { chainId, storeId, prices };
}

/** Store ids are zero-padded in file names ("001") and bare in Stores files ("1"). */
export const sameStoreId = (a: string, b: string): boolean => a.replace(/^0+/, '') === b.replace(/^0+/, '');

/** A club price (2ב13.90) or multi-buy (10ב30): `dealPrice` is the total for `minQty` units. */
export interface PromoDeal { readonly minQty: number; readonly dealPrice: number; readonly clubOnly: boolean }
/** One branch's live promotions: barcode → every deal that applies (the cheapest wins at pricing time). */
export type PromoIndex = Record<string, PromoDeal[]>;

/**
 * A PromoFull file → barcode → deals. `RewardType 1` ("2 for 13.90") and `3` (a flat discounted
 * price, `MinQty` 1) both give the price for `MinQty` units in `DiscountedPrice`; other reward
 * types (gifts, unclear mechanics) are skipped rather than guessed at. `AdditionalIsCoupon` marks
 * a deal that needs clipping to a card the family may never load, so it is never priced in
 * automatically ("קופון חלב תנובה קרטון 1לי ב1שח" is not the shelf price). `ClubID` is "0" for
 * everyone; anything else needs a club card or credit card the family may not hold.
 */
export function parsePromoFull(xml: string): PromoIndex {
  const out: PromoIndex = {};
  for (const p of xml.matchAll(/<Promotion>([\s\S]*?)<\/Promotion>/gi)) {
    const promo = p[1]!;
    if (tag(promo, 'AdditionalIsCoupon') === '1') continue;
    const clubId = tag(promo, 'ClubID');
    const clubOnly = clubId !== '' && clubId !== '0';
    for (const it of promo.matchAll(/<PromotionItem>([\s\S]*?)<\/PromotionItem>/gi)) {
      const item = it[1]!;
      const code = tag(item, 'ItemCode');
      if (!/^\d{8,14}$/.test(code)) continue;
      if (tag(item, 'bIsWeighted') === '1') continue;
      const rewardType = tag(item, 'RewardType');
      if (rewardType !== '1' && rewardType !== '3') continue;
      const minQty = Number(tag(item, 'MinQty')) || 1;
      const dealPrice = Number(tag(item, 'DiscountedPrice'));
      if (!(dealPrice > 0)) continue;
      (out[code] ??= []).push({ minQty, dealPrice: Math.round(dealPrice * 100), clubOnly });
    }
  }
  return out;
}

/** The cheapest way to buy `qty` units, mixing one promo's bundles with the regular price for the rest. */
export function bestDealTotal(deals: readonly PromoDeal[] | undefined, qty: number, regularUnit: number): { total: number; clubOnly: boolean } {
  let best = { total: regularUnit * qty, clubOnly: false };
  for (const d of deals ?? []) {
    if (qty < d.minQty || d.minQty <= 0) continue;
    const bundles = Math.floor(qty / d.minQty);
    const remainder = qty - bundles * d.minQty;
    const total = bundles * d.dealPrice + remainder * regularUnit;
    if (total < best.total) best = { total, clubOnly: d.clubOnly };
  }
  return best;
}
