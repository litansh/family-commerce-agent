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
   * How long the words pass may take, counted from the start. Past it, the barcode pass's answer
   * stands on its own and the compare's substitutes fill the gaps. Unset: as long as the provider takes.
   */
  readonly wordsPassMs?: number;
  /** Called when the words pass failed or missed its time, so the log says why a gap stayed open. */
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
  // Which pinned lines may be asked for by words if a storefront lacks the barcode?
  const pinned = req.lines.filter((l) => l.gtin !== undefined);
  const substitutable = new Set(
    pinned
      .filter((l) => (memory.products[memoryKey(l.query)]?.substitution ?? 'equivalent') !== 'never')
      .map((l) => l.id),
  );

  // Pass two starts beside pass one rather than after it: the same lines, by words instead of
  // barcode. Waiting for pass one first put it in front of the slow pass every time (2026-10-10,
  // the week for five: barcodes 2.4 s, then words 18.6 s; with eighteen stores, some thin, nearly
  // every pinned line is missing somewhere, so pass two ran for 35 of 39 lines anyway). It asks for
  // every substitutable pinned line; only the ones a storefront really lacks are merged below.
  const fallbackLines: ListLine[] = req.lines
    .filter((l) => substitutable.has(l.id))
    .map(({ gtin: _gtin, ...rest }) => rest);
  const firstP = provider.quoteBasket(req);
  const secondP = fallbackLines.length > 0 ? settleWithin(provider.quoteBasket({ ...req, lines: fallbackLines }), opts.wordsPassMs) : undefined;

  const first = await firstP;
  if (secondP === undefined) return first;

  const missingAnywhere = new Set<string>();
  for (const q of first.quotes) {
    const priced = new Set(q.lines.map((l) => l.lineId));
    for (const l of pinned) if (!priced.has(l.id) && substitutable.has(l.id)) missingAnywhere.add(l.id);
  }
  if (missingAnywhere.size === 0) return first;

  // The words pass is a rung, not the answer (ADR 0010). If it fails or misses its time, the barcode
  // pass already priced the list, and the compare's substitutes look for each store's gaps next. A
  // slow words pass used to throw that answer away: the chaotic list's 503 'stores_slow' (2026-10-10,
  // the barcode pass answered in 10 s, the words pass for 40 lines was still running at 22 s).
  const settled = await secondP;
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
    // Only the lines pass two was used for, as before it asked for every pinned line.
    assumptions: [...first.assumptions, ...second.assumptions.filter((a) => missingAnywhere.has(a.lineId))],
    // The two passes overlap, so the wait is the longer of them.
    latencyMs: Math.max(first.latencyMs, second.latencyMs),
    raw: { first: first.raw, second: second.raw },
  };
}
