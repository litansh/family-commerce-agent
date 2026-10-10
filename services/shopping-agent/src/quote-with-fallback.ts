/**
 * Quote a basket whose lines carry confirmed barcodes, without letting a
 * storefront that lacks one exact SKU drop out of the comparison.
 *
 * The quote provider takes exactly one identifier per line. A confirmed GTIN
 * is the right identifier — it is what the family actually wants — but no
 * chain stocks every barcode, and a pinned line the storefront cannot supply
 * costs it that line, which at four or five lines pushes the whole storefront
 * under the coverage floor. The first memory-backed run produced zero options
 * for exactly this reason.
 *
 * So: two passes. Pass one prices what was asked for. Pass two re-asks, by the
 * family's own words, only for lines a storefront could not price — and only
 * where the household's substitution policy allows it. A line that came back
 * this way is marked substituted with a reason, so the family sees that this
 * storefront would give them something else, and the optimizer counts it
 * against that option.
 */

import {
  addAgorot,
  memoryKey,
  type Agorot,
  type HouseholdMemory,
  type ListLine,
  type QuotedLine,
  type StorefrontQuote,
} from '@fca/domain';
import type { QuoteProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';

export const CONFIRMED_UNAVAILABLE = 'confirmed_product_unavailable';

export interface FallbackOptions {
  /**
   * How long the whole call may take before the words pass is given up, counted from the start (the
   * barcode pass included). Past it, the barcode pass's answer stands on its own and the compare's
   * substitutes fill the gaps. Unset: as long as the provider takes.
   */
  readonly wordsPassMs?: number;
  /** Called when the words pass failed, missed its time or had none left, so the log says why a gap stayed open. */
  readonly onWordsPassSkipped?: (why: string) => void;
}

type Settled<T> = { ok: true; value: T } | { ok: false; why: string };
/** Never rejects: the answer, or why there is none (an error, or `ms` passing first). */
function settleWithin<T>(p: Promise<T>, ms: number | undefined): Promise<Settled<T>> {
  const answer = p.then((value): Settled<T> => ({ ok: true, value }), (e: unknown): Settled<T> => ({ ok: false, why: e instanceof Error ? e.message.slice(0, 160) : String(e) }));
  if (ms === undefined) return answer;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<Settled<T>>((resolve) => { timer = setTimeout(() => resolve({ ok: false, why: `words pass past ${ms} ms` }), ms); timer.unref?.(); });
  return Promise.race([answer, clock]).finally(() => clearTimeout(timer));
}

export async function quoteWithFallback(
  provider: QuoteProvider,
  req: QuoteRequest,
  memory: HouseholdMemory,
  opts: FallbackOptions = {},
): Promise<QuoteResponse> {
  const started = Date.now();
  const first = await provider.quoteBasket(req);

  // Which pinned lines could a storefront not price, and may we substitute?
  const pinned = req.lines.filter((l) => l.gtin !== undefined);
  if (pinned.length === 0) return first;

  const substitutable = new Set(
    pinned
      .filter((l) => (memory.products[memoryKey(l.query)]?.substitution ?? 'equivalent') !== 'never')
      .map((l) => l.id),
  );

  const missingAnywhere = new Set<string>();
  for (const q of first.quotes) {
    const priced = new Set(q.lines.map((l) => l.lineId));
    for (const l of pinned) if (!priced.has(l.id) && substitutable.has(l.id)) missingAnywhere.add(l.id);
  }
  if (missingAnywhere.size === 0) return first;

  // Pass two: the same lines, by query instead of barcode. It is a rung, not the answer (ADR 0010):
  // if it fails or misses its time, the barcode pass already priced the list and the compare's
  // substitutes look for each store's gaps next. With no time of its own it used to run on until
  // the caller's deadline took the barcode pass's priced answer down with it: the chaotic list's
  // 503 'stores_slow' on 2026-10-10 (the words pass for 40 lines was still running at 22 s).
  // It stays after pass one, not beside it: run together, the provider slowed the barcode pass from
  // 2.4 s to 9 s and the pair took as long as the two in a row (measured from the ops Mac, 2026-10-10).
  const left = opts.wordsPassMs === undefined ? undefined : opts.wordsPassMs - (Date.now() - started);
  if (left !== undefined && left <= 0) { opts.onWordsPassSkipped?.(`no time left after the barcode pass (${Date.now() - started} ms)`); return first; }
  const fallbackLines: ListLine[] = req.lines
    .filter((l) => missingAnywhere.has(l.id))
    .map(({ gtin: _gtin, ...rest }) => rest);
  const settled = await settleWithin(provider.quoteBasket({ ...req, lines: fallbackLines }), left);
  if (!settled.ok) { opts.onWordsPassSkipped?.(settled.why); return first; }
  const second = settled.value;
  const byStorefront = new Map(second.quotes.map((q) => [q.storefrontId, q]));

  const quotes = first.quotes.map<StorefrontQuote>((q) => {
    const priced = new Set(q.lines.map((l) => l.lineId));
    const fb = byStorefront.get(q.storefrontId);
    if (fb === undefined) return q;

    const added: QuotedLine[] = fb.lines
      .filter((l) => !priced.has(l.lineId) && missingAnywhere.has(l.lineId))
      .map((l) => ({
        ...l,
        substituted: true,
        substitutionReason: CONFIRMED_UNAVAILABLE,
      }));
    if (added.length === 0) return q;

    const lines = [...q.lines, ...added];
    const itemsSubtotal = addAgorot(...lines.map((l) => l.lineTotal));
    return {
      ...q,
      lines,
      itemsSubtotal,
      // The delivery fee from pass one stands: it was quoted against the
      // larger basket, and fee bands only ever get cheaper as baskets grow.
      deliveredTotal: addAgorot(itemsSubtotal, q.deliveryFee) as Agorot,
      pricedLines: lines.length,
    };
  });

  return {
    ...first,
    quotes,
    assumptions: [...first.assumptions, ...second.assumptions],
    latencyMs: first.latencyMs + second.latencyMs,
    raw: { first: first.raw, second: second.raw },
  };
}
