import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirm, emptyMemory, shekels, type ListLine, type QuotedLine, type StorefrontQuote } from '@fca/domain';
import type { QuoteProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';
import { CONFIRMED_UNAVAILABLE, quoteWithFallback } from '../src/index.ts';

const ql = (lineId: string, total: number): QuotedLine => ({
  lineId, query: lineId, productName: `product-${lineId}`, qty: 1,
  unitPrice: shekels(total), lineTotal: shekels(total),
  substituted: false, clubOnly: false, resolutionSource: 'provider',
});
const sq = (id: string, lines: QuotedLine[], requested: number): StorefrontQuote => {
  const sub = lines.reduce((a, l) => a + l.lineTotal, 0);
  return {
    storefrontId: id, brand: id, chainId: id, serviceType: 'delivery',
    itemsSubtotal: shekels(sub / 100), deliveryFee: shekels(35.9), deliveredTotal: shekels(sub / 100 + 35.9),
    meetsMinimum: true, requestedLines: requested, pricedLines: lines.length, lines,
    deliveryTermsConfidence: 'verified', priceFeedStale: false,
  };
};

/** A provider that stocks the milk barcode only at Rami Levy. */
class FakeProvider implements QuoteProvider {
  readonly id = 'fake';
  readonly calls: QuoteRequest[] = [];
  async quoteBasket(req: QuoteRequest): Promise<QuoteResponse> {
    this.calls.push(req);
    const n = req.lines.length;
    const rl = req.lines.map((l) => ql(l.id, 10));
    const sh = req.lines.filter((l) => !(l.gtin === 'milk-gtin')).map((l) => ql(l.id, l.gtin ? 12 : 9));
    return { quotes: [sq('rami-levy', rl, n), sq('shufersal', sh, n)], assumptions: [], providerId: 'fake', latencyMs: 1, raw: null };
  }
}

const lines: ListLine[] = [
  { id: 'milk', query: 'חלב 3%', gtin: 'milk-gtin' },
  { id: 'bread', query: 'לחם' },
];

test('a storefront lacking the exact barcode gets the line by query, marked as a substitution', async () => {
  const p = new FakeProvider();
  const memory = confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk' });
  const res = await quoteWithFallback(p, { lines, address: 'x' }, memory);

  const sh = res.quotes.find((q) => q.storefrontId === 'shufersal')!;
  assert.equal(sh.pricedLines, 2, 'shufersal now prices both lines');
  const milk = sh.lines.find((l) => l.lineId === 'milk')!;
  assert.equal(milk.substituted, true);
  assert.equal(milk.substitutionReason, CONFIRMED_UNAVAILABLE);
  assert.equal(sh.itemsSubtotal, shekels(18), 'totals recomputed from the merged lines');
  assert.equal(sh.deliveredTotal, shekels(53.9));

  const rl = res.quotes.find((q) => q.storefrontId === 'rami-levy')!;
  assert.equal(rl.lines.find((l) => l.lineId === 'milk')?.substituted, false, 'rami levy had the barcode; untouched');
});

test('second pass asks by words only, for only the missing lines', async () => {
  const p = new FakeProvider();
  const memory = confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk' });
  await quoteWithFallback(p, { lines, address: 'x' }, memory);
  assert.equal(p.calls.length, 2);
  assert.deepEqual(p.calls[1]!.lines.map((l) => [l.id, l.gtin]), [['milk', undefined]]);
});

// --- 2026-10-10 health run: the words pass had no time of its own, so a slow one cost the whole compare ---

const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const answerFor = (req: QuoteRequest): QuoteResponse => {
  const n = req.lines.length;
  const rl = req.lines.map((l) => ql(l.id, 10));
  const sh = req.lines.filter((l) => !(l.gtin === 'milk-gtin')).map((l) => ql(l.id, l.gtin ? 12 : 9));
  return { quotes: [sq('rami-levy', rl, n), sq('shufersal', sh, n)], assumptions: [], providerId: 'fake', latencyMs: 1, raw: null };
};
/** The barcode pass answers when the test says so; the words pass as `words` decides. */
class ControlledProvider implements QuoteProvider {
  readonly id = 'controlled';
  readonly calls: QuoteRequest[] = [];
  readonly barcodes = deferred<void>();
  readonly words: (req: QuoteRequest) => Promise<QuoteResponse>;
  constructor(words: (req: QuoteRequest) => Promise<QuoteResponse>) { this.words = words; }
  async quoteBasket(req: QuoteRequest): Promise<QuoteResponse> {
    this.calls.push(req);
    if (req.lines.some((l) => l.gtin)) { await this.barcodes.promise; return answerFor(req); }
    return this.words(req);
  }
}
const milkMemory = () => confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk' });

test('a words pass past its time leaves the barcode pass standing, instead of costing the whole compare', { timeout: 2_000 }, async () => {
  const skipped: string[] = [];
  const p = new ControlledProvider(() => new Promise<QuoteResponse>(() => {})); // never answers
  p.barcodes.resolve();
  const t0 = Date.now();
  const res = await quoteWithFallback(p, { lines, address: 'x' }, milkMemory(), { wordsPassMs: 40, onWordsPassSkipped: (why) => skipped.push(why) });
  assert.ok(Date.now() - t0 < 1_000, 'answers at the words pass\'s time, not whenever the provider does');
  const sh = res.quotes.find((q) => q.storefrontId === 'shufersal')!;
  assert.equal(sh.pricedLines, 1, 'the barcode pass\'s own answer: shufersal lacks the milk barcode');
  assert.equal(sh.lines.some((l) => l.lineId === 'milk'), false, 'nothing invented for the gap; the substitutes look next');
  assert.equal(res.quotes.find((q) => q.storefrontId === 'rami-levy')!.pricedLines, 2);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!, /past 40 ms/);
});

test('a words pass that fails leaves the barcode pass standing', async () => {
  const skipped: string[] = [];
  const p = new ControlledProvider(async () => { throw new Error('optimize_delivery: internal_error'); });
  p.barcodes.resolve();
  const res = await quoteWithFallback(p, { lines, address: 'x' }, milkMemory(), { onWordsPassSkipped: (why) => skipped.push(why) });
  assert.equal(res.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 1);
  assert.deepEqual(skipped, ['optimize_delivery: internal_error']);
});

test('a barcode pass that fails still fails the try, so the caller can retry or say the stores are slow', async () => {
  const p: QuoteProvider = { id: 'down', quoteBasket: async (req) => { if (req.lines.some((l) => l.gtin)) throw new Error('This operation was aborted'); return answerFor(req); } };
  await assert.rejects(quoteWithFallback(p, { lines, address: 'x' }, milkMemory(), { wordsPassMs: 40 }), /aborted/);
});

test('a barcode pass that used up the time leaves none for the words pass, and is not thrown away', { timeout: 2_000 }, async () => {
  const skipped: string[] = [];
  const p = new ControlledProvider(async (req) => answerFor(req));
  setTimeout(() => p.barcodes.resolve(), 60);
  const res = await quoteWithFallback(p, { lines, address: 'x' }, milkMemory(), { wordsPassMs: 30, onWordsPassSkipped: (why) => skipped.push(why) });
  assert.equal(p.calls.length, 1, 'the words pass is not even asked for');
  assert.equal(res.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 1, 'the barcode pass\'s answer stands');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!, /no time left/);
});

test('the words pass gets only what is left of its time after the barcode pass', { timeout: 2_000 }, async () => {
  const skipped: string[] = [];
  const p = new ControlledProvider((req) => new Promise((r) => setTimeout(() => r(answerFor(req)), 80)));
  setTimeout(() => p.barcodes.resolve(), 60);
  const t0 = Date.now();
  // 100 ms in all: 60 for the barcode pass leaves 40, and the words pass takes 80, so it is given up.
  const res = await quoteWithFallback(p, { lines, address: 'x' }, milkMemory(), { wordsPassMs: 100, onWordsPassSkipped: (why) => skipped.push(why) });
  assert.ok(Date.now() - t0 < 135, `answered at ${Date.now() - t0} ms, not at the words pass's own 140`);
  assert.equal(res.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 1);
  assert.equal(skipped.length, 1);
});

test('respects a household that said never substitute', async () => {
  const p = new FakeProvider();
  const memory = confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk', substitution: 'never' });
  const res = await quoteWithFallback(p, { lines, address: 'x' }, memory);
  assert.equal(p.calls.length, 1, 'no second pass');
  assert.equal(res.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 1, 'the line stays unpriced there');
});

test('no pinned lines means a single pass', async () => {
  const p = new FakeProvider();
  await quoteWithFallback(p, { lines: [{ id: 'bread', query: 'לחם' }], address: 'x' }, emptyMemory('h'));
  assert.equal(p.calls.length, 1);
});
