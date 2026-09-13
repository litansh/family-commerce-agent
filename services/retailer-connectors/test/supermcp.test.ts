import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuperMcpQuoteProvider } from '../src/supermcp.ts';

const sseBody = (result: unknown) => `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } })}\n`;

function withFetch<T>(result: unknown, run: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(sseBody(result), { status: 200 })) as typeof fetch;
  return run().finally(() => { globalThis.fetch = orig; });
}

const PLAN = (lines: unknown[]) => ({
  plans: [{ serviceSlug: 's1', brand: 'Store', itemsSubtotal: 10, pricedLines: lines.length, requestedLines: lines.length, lines }],
});

test('a barcode the catalogue lacks, quote-time substituted by the vendor into an unrelated product, is dropped — not priced as an answer', async () => {
  const raw = PLAN([{ itemIndex: 0, name: 'תרד לא שטוף יח ( ניוזילנדי )', qty: 1, unitPrice: 5, lineTotal: 5, substituted: true, substitutionReason: 'class_fallback' }]);
  const res = await withFetch(raw, () =>
    new SuperMcpQuoteProvider('https://example.test/mcp').quoteBasket({
      lines: [{ id: 'l0', query: 'לא קיים', gtin: '9999999999999' }],
      address: 'x',
    }),
  );
  assert.equal(res.quotes[0]!.lines.length, 0, 'the vendor\'s own free-text guess must not survive as a priced line');
});

test('the same vendor substitution is kept when it actually shares a word with what was asked', async () => {
  const raw = PLAN([{ itemIndex: 0, name: 'חלב תנובה 3% 1 ליטר', qty: 1, unitPrice: 7, lineTotal: 7, substituted: true, substitutionReason: 'class_fallback' }]);
  const res = await withFetch(raw, () =>
    new SuperMcpQuoteProvider('https://example.test/mcp').quoteBasket({
      lines: [{ id: 'l0', query: 'חלב 3%' }],
      address: 'x',
    }),
  );
  assert.equal(res.quotes[0]!.lines.length, 1);
  assert.equal(res.quotes[0]!.lines[0]!.productName, 'חלב תנובה 3% 1 ליטר');
});

test('the provider\'s own cross-chain resolution (chain_equivalent) is never treated as a swap to filter', async () => {
  const raw = PLAN([{ itemIndex: 0, name: 'משהו שלא חולק מילה', qty: 1, unitPrice: 3, lineTotal: 3, substituted: true, substitutionReason: 'chain_equivalent: same product' }]);
  const res = await withFetch(raw, () =>
    new SuperMcpQuoteProvider('https://example.test/mcp').quoteBasket({
      lines: [{ id: 'l0', query: 'חלב 3%' }],
      address: 'x',
    }),
  );
  assert.equal(res.quotes[0]!.lines.length, 1, 'chain_equivalent is the same product at this chain, not a free-text guess');
  assert.equal(res.quotes[0]!.lines[0]!.substituted, false);
});
