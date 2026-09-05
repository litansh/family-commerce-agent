/**
 * Household memory.
 *
 * The asset this product is built around. Every other layer is rented; this
 * one is ours, and it is what turns "חלב" from a guess into a barcode the
 * family confirmed once and never has to think about again.
 *
 * Three rules govern it:
 *  1. Memory belongs to the household, not a person. A family shares it.
 *  2. Every record is explicit, inspectable and editable. Nothing hides in
 *     an LLM's context.
 *  3. Memory writes only on a completed shop, or an explicit confirmation.
 *     An abandoned run writes nothing, so memory improves instead of drifting.
 */

import { normalizeBrand } from './brand.ts';
import type { ListLine } from './types.ts';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type SubstitutionPolicy =
  /** Never substitute; if unavailable, leave the line unpriced and say so. */
  | 'never'
  /** Another size or variant of the same brand is fine. */
  | 'same_brand'
  /** Any equivalent product is fine. */
  | 'equivalent'
  /** Whatever is cheapest per unit. */
  | 'cheapest';

/**
 * What a household means by a phrase.
 * "החלב הרגיל" → one specific GTIN, confirmed by a human, reinforced by use.
 */
export interface ProductPreference {
  /** Normalised form of the family's words. The lookup key. */
  readonly key: string;
  /** The words as the family typed them, kept for display. */
  readonly phrase: string;
  readonly gtin: string;
  readonly productName: string;
  readonly brand?: string;
  /** Set when a human said "yes, that one". Unconfirmed entries are hints. */
  readonly confirmedAt?: string;
  readonly orderCount: number;
  readonly lastOrderedAt?: string;
  /** Recent purchase timestamps, oldest first. Enough to learn a rhythm. */
  readonly purchaseHistory: readonly string[];
  readonly defaultAmount?: number;
  readonly defaultUnit?: string;
  readonly defaultPackQty?: number;
  readonly substitution: SubstitutionPolicy;
  /** Seasonal items are remembered but not suggested out of season. */
  readonly excludeFromSuggestions?: boolean;
  /** What was actually bought the last time the confirmed product was unavailable. */
  readonly lastSubstitute?: { readonly gtin: string; readonly productName: string; readonly at: string };
}

export type BrandStance = 'prefer' | 'accept' | 'never';

export interface BrandPreference {
  readonly brand: string;
  readonly stance: BrandStance;
  /** Optional scope, e.g. "dairy". Absent means everywhere. */
  readonly category?: string;
  readonly note?: string;
}

export interface HouseholdMemory {
  readonly householdId: string;
  readonly version: number;
  readonly products: Readonly<Record<string, ProductPreference>>;
  readonly brands: readonly BrandPreference[];
  readonly updatedAt: string;
}

export const emptyMemory = (householdId: string, now: Date = new Date()): HouseholdMemory => ({
  householdId,
  version: 1,
  products: {},
  brands: [],
  updatedAt: now.toISOString(),
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The family's words, normalised enough that "חלב 3%" and "חלב 3% " and
 * "חלב  3%" are one thing — and no further. We do not stem or synonymise;
 * "חלב" and "חלב 3%" are deliberately different keys, because the family
 * may mean different products by them.
 */
export function memoryKey(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/["'׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Reading — the part that moves the resolution number
// ---------------------------------------------------------------------------

export interface AppliedLine {
  readonly line: ListLine;
  readonly fromMemory: boolean;
  readonly preference?: ProductPreference;
}

/**
 * Fill in barcodes the household has already confirmed.
 *
 * A line that already carries a GTIN is left alone: an explicit barcode in the
 * request outranks memory. A line whose phrase the household confirmed before
 * gets that GTIN, and inherits the remembered brand and default quantity when
 * the line did not state its own.
 */
export function applyMemory(
  lines: readonly ListLine[],
  memory: HouseholdMemory,
): readonly AppliedLine[] {
  return lines.map((line) => {
    if (line.gtin !== undefined) return { line, fromMemory: false };

    const pref = memory.products[memoryKey(line.query)];
    if (pref === undefined || pref.confirmedAt === undefined) return { line, fromMemory: false };

    // A brand stated on the line that contradicts memory means the family
    // changed their mind for this shop; do not override them.
    if (line.brand !== undefined && pref.brand !== undefined) {
      if (normalizeBrand(line.brand) !== normalizeBrand(pref.brand)) {
        return { line, fromMemory: false };
      }
    }

    const filled: ListLine = {
      ...line,
      gtin: pref.gtin,
      ...(line.brand === undefined && pref.brand !== undefined ? { brand: pref.brand } : {}),
      ...(hasQuantity(line) ? {} : defaultQuantity(pref)),
    };
    return { line: filled, fromMemory: true, preference: pref };
  });
}

const hasQuantity = (l: ListLine): boolean =>
  l.packQty !== undefined || (l.amount !== undefined && l.unit !== undefined);

const defaultQuantity = (p: ProductPreference): Partial<ListLine> =>
  p.defaultAmount !== undefined && p.defaultUnit !== undefined
    ? { amount: p.defaultAmount, unit: p.defaultUnit }
    : p.defaultPackQty !== undefined
      ? { packQty: p.defaultPackQty }
      : {};

// ---------------------------------------------------------------------------
// Writing — only on confirmation or a completed shop
// ---------------------------------------------------------------------------

export interface Confirmation {
  readonly phrase: string;
  readonly gtin: string;
  readonly productName: string;
  readonly brand?: string;
  readonly substitution?: SubstitutionPolicy;
}

/** A human said "yes, that one". The strongest signal memory ever receives. */
export function confirm(
  memory: HouseholdMemory,
  c: Confirmation,
  now: Date = new Date(),
): HouseholdMemory {
  const key = memoryKey(c.phrase);
  const existing = memory.products[key];
  const at = now.toISOString();

  const pref: ProductPreference = {
    key,
    phrase: c.phrase,
    gtin: c.gtin,
    productName: c.productName,
    ...(c.brand !== undefined ? { brand: c.brand } : {}),
    confirmedAt: at,
    orderCount: existing?.gtin === c.gtin ? existing.orderCount : 0,
    purchaseHistory: existing?.gtin === c.gtin ? existing.purchaseHistory : [],
    ...(existing?.lastOrderedAt !== undefined && existing.gtin === c.gtin
      ? { lastOrderedAt: existing.lastOrderedAt }
      : {}),
    ...(existing?.defaultAmount !== undefined ? { defaultAmount: existing.defaultAmount } : {}),
    ...(existing?.defaultUnit !== undefined ? { defaultUnit: existing.defaultUnit } : {}),
    ...(existing?.defaultPackQty !== undefined ? { defaultPackQty: existing.defaultPackQty } : {}),
    substitution: c.substitution ?? existing?.substitution ?? 'equivalent',
  };

  return {
    ...memory,
    products: { ...memory.products, [key]: pref },
    updatedAt: at,
  };
}

export interface PurchasedLine {
  readonly phrase: string;
  readonly gtin: string;
  readonly productName: string;
  readonly brand?: string;
  readonly amount?: number;
  readonly unit?: string;
  readonly packQty?: number;
}

/** Keep only enough history to learn a rhythm. */
const HISTORY_LIMIT = 12;

/**
 * A shop was completed. Reinforce every line that was actually bought.
 *
 * This is the ONLY place `orderCount`, `lastOrderedAt`, `purchaseHistory` and
 * the default quantities change. A shop that was abandoned never reaches here.
 */
export function recordShop(
  memory: HouseholdMemory,
  bought: readonly PurchasedLine[],
  now: Date = new Date(),
): HouseholdMemory {
  const at = now.toISOString();
  const products = { ...memory.products };

  for (const b of bought) {
    const key = memoryKey(b.phrase);
    const existing = products[key];
    const sameProduct = existing?.gtin === b.gtin;

    // A confirmed preference is the family's stated choice. Buying something
    // else this week — because the storefront was out, or a substitute was
    // accepted — must not overwrite it. The first live run did exactly that:
    // a confirmed Tnuva bag became an unconfirmed Yotvata 2L carton after one
    // delivery. Record the purchase against the confirmed product (the family
    // did buy "milk"), but keep what they said milk means.
    if (existing?.confirmedAt !== undefined && !sameProduct) {
      products[key] = {
        ...existing,
        orderCount: existing.orderCount + 1,
        lastOrderedAt: at,
        purchaseHistory: [...existing.purchaseHistory, at].slice(-HISTORY_LIMIT),
        lastSubstitute: { gtin: b.gtin, productName: b.productName, at },
      };
      continue;
    }

    products[key] = {
      key,
      phrase: b.phrase,
      gtin: b.gtin,
      productName: b.productName,
      ...(b.brand !== undefined ? { brand: b.brand } : existing?.brand !== undefined ? { brand: existing.brand } : {}),
      // Buying it is not the same as confirming it: a completed shop with a
      // guessed product reinforces the guess but does not promote it.
      ...(sameProduct && existing?.confirmedAt !== undefined ? { confirmedAt: existing.confirmedAt } : {}),
      orderCount: (sameProduct ? existing.orderCount : 0) + 1,
      lastOrderedAt: at,
      purchaseHistory: [...(sameProduct ? existing.purchaseHistory : []), at].slice(-HISTORY_LIMIT),
      ...(b.amount !== undefined && b.unit !== undefined
        ? { defaultAmount: b.amount, defaultUnit: b.unit }
        : sameProduct && existing.defaultAmount !== undefined
          ? { defaultAmount: existing.defaultAmount, defaultUnit: existing.defaultUnit! }
          : {}),
      ...(b.packQty !== undefined
        ? { defaultPackQty: b.packQty }
        : sameProduct && existing.defaultPackQty !== undefined
          ? { defaultPackQty: existing.defaultPackQty }
          : {}),
      substitution: existing?.substitution ?? 'equivalent',
      ...(existing?.excludeFromSuggestions ? { excludeFromSuggestions: true } : {}),
    };
  }

  return { ...memory, products, updatedAt: at };
}

export function setBrandPreference(
  memory: HouseholdMemory,
  pref: BrandPreference,
  now: Date = new Date(),
): HouseholdMemory {
  const key = (b: BrandPreference): string => `${normalizeBrand(b.brand) ?? b.brand}|${b.category ?? ''}`;
  const brands = [...memory.brands.filter((b) => key(b) !== key(pref)), pref];
  return { ...memory, brands, updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// The forgetting check — the reason the product exists
// ---------------------------------------------------------------------------

export interface Suggestion {
  readonly preference: ProductPreference;
  readonly reason: 'overdue' | 'usual';
  /** Days since last purchase, for display. */
  readonly daysSince: number;
  /** Learned typical interval in days, when there is enough history. */
  readonly usualIntervalDays?: number;
}

const DAY_MS = 86_400_000;

/**
 * Median gap between purchases, in days. Median rather than mean so one
 * holiday gap does not teach us that milk is monthly.
 */
export function usualInterval(history: readonly string[]): number | undefined {
  if (history.length < 3) return undefined;
  const times = history.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push((times[i]! - times[i - 1]!) / DAY_MS);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

/**
 * What the household usually buys and has not put on this list.
 *
 * Two kinds, ranked overdue-first:
 *  - overdue: the item has its own learned rhythm and is past it
 *  - usual: bought often, no rhythm yet, simply absent
 *
 * The household's stated pain is forgetting an item and buying it later at
 * makolet prices. This is the fix, and it is computed from purchase history
 * alone — no model, no guess.
 */
export function suggestMissing(
  memory: HouseholdMemory,
  currentLines: readonly ListLine[],
  now: Date = new Date(),
  opts: { minOrderCount?: number; limit?: number } = {},
): readonly Suggestion[] {
  const present = new Set(currentLines.map((l) => memoryKey(l.query)));
  const presentGtins = new Set(currentLines.map((l) => l.gtin).filter(Boolean));
  const minOrders = opts.minOrderCount ?? 2;

  const out: Suggestion[] = [];
  for (const p of Object.values(memory.products)) {
    if (p.excludeFromSuggestions) continue;
    if (p.orderCount < minOrders) continue;
    if (present.has(p.key) || presentGtins.has(p.gtin)) continue;
    if (p.lastOrderedAt === undefined) continue;

    const daysSince = Math.floor((now.getTime() - Date.parse(p.lastOrderedAt)) / DAY_MS);
    const interval = usualInterval(p.purchaseHistory);

    if (interval !== undefined) {
      if (daysSince >= interval * 0.8) {
        out.push({ preference: p, reason: 'overdue', daysSince, usualIntervalDays: interval });
      }
    } else {
      out.push({ preference: p, reason: 'usual', daysSince });
    }
  }

  out.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'overdue' ? -1 : 1;
    if (a.reason === 'overdue') {
      // Most overdue relative to its own rhythm first.
      const ra = a.daysSince / (a.usualIntervalDays ?? 1);
      const rb = b.daysSince / (b.usualIntervalDays ?? 1);
      return rb - ra;
    }
    return b.preference.orderCount - a.preference.orderCount;
  });

  return out.slice(0, opts.limit ?? 10);
}

export interface PastOrder {
  readonly at: string;
  readonly lines: readonly PurchasedLine[];
}

/**
 * Seed memory from a retailer's order history. Each past order is replayed
 * as a completed shop on its own date, oldest first, so purchase rhythms
 * come out right and nothing is marked confirmed — the family did buy these,
 * but has not yet said "yes, that one".
 */
export function importHistory(memory: HouseholdMemory, orders: readonly PastOrder[]): HouseholdMemory {
  const sorted = [...orders].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return sorted.reduce((m, o) => recordShop(m, o.lines, new Date(o.at)), memory);
}
