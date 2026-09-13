import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropUnavailableHaziHinam } from '../src/hazi-hinam-stock.ts';

test('a line the guest session says is out of stock is dropped; unknown and in-stock lines are kept', () => {
  const inStock = new Map<string, boolean>([['1', true], ['2', false]]);
  const { kept, dropped } = dropUnavailableHaziHinam([{ lineId: 'a', gtin: '1' }, { lineId: 'b', gtin: '2' }, { lineId: 'c', gtin: '3' }, { lineId: 'd' }], inStock);
  assert.deepEqual(kept.map((l) => l.lineId), ['a', 'c', 'd']);
  assert.deepEqual(dropped.map((l) => l.lineId), ['b']);
});
