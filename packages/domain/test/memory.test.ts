import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMemory,
  confirm,
  emptyMemory,
  memoryKey,
  recordShop,
  suggestMissing,
  usualInterval,
} from '../src/memory.ts';
import type { ListLine } from '../src/types.ts';

const T0 = new Date('2026-09-01T10:00:00Z');
const days = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);
const line = (query: string, over: Partial<ListLine> = {}): ListLine => ({ id: query, query, ...over });

const MILK = { phrase: 'חלב 3%', gtin: '7290000042015', productName: 'חלב 3% שקית 1 ליטר', brand: 'תנובה' };

// --- keys ------------------------------------------------------------------

test('memory key normalises whitespace and quotes, nothing more', () => {
  assert.equal(memoryKey('  חלב   3% '), 'חלב 3%');
  assert.equal(memoryKey("קוטג' 5%"), 'קוטג 5%');
  assert.notEqual(memoryKey('חלב'), memoryKey('חלב 3%'), 'different phrases stay different');
});

// --- confirm → apply: the loop that moves the resolution number ------------

test('a confirmed phrase resolves to its barcode with no human input', () => {
  const m = confirm(emptyMemory('h1'), MILK, T0);
  const [applied] = applyMemory([line('חלב 3%')], m);
  assert.ok(applied);
  assert.equal(applied.fromMemory, true);
  assert.equal(applied.line.gtin, MILK.gtin);
  assert.equal(applied.line.brand, 'תנובה', 'the remembered brand comes along');
});

test('an unconfirmed entry is a hint, not an answer', () => {
  // A completed shop with a guessed product reinforces the guess but does
  // not promote it to confirmed.
  const m = recordShop(emptyMemory('h1'), [MILK], T0);
  const [applied] = applyMemory([line('חלב 3%')], m);
  assert.equal(applied?.fromMemory, false);
  assert.equal(applied?.line.gtin, undefined);
});

test('an explicit barcode on the line outranks memory', () => {
  const m = confirm(emptyMemory('h1'), MILK, T0);
  const [applied] = applyMemory([line('חלב 3%', { gtin: 'other' })], m);
  assert.equal(applied?.fromMemory, false);
  assert.equal(applied?.line.gtin, 'other');
});

test('a brand stated on the line that contradicts memory wins for this shop', () => {
  const m = confirm(emptyMemory('h1'), MILK, T0);
  const [applied] = applyMemory([line('חלב 3%', { brand: 'טרה' })], m);
  assert.equal(applied?.fromMemory, false, 'the family changed their mind; do not override them');
  assert.equal(applied?.line.brand, 'טרה');
});

test('remembered default quantity fills a line that stated none', () => {
  let m = confirm(emptyMemory('h1'), MILK, T0);
  m = recordShop(m, [{ ...MILK, amount: 6, unit: 'יח' }], days(1));
  const [bare] = applyMemory([line('חלב 3%')], m);
  assert.equal(bare?.line.amount, 6);
  assert.equal(bare?.line.unit, 'יח');
  const [stated] = applyMemory([line('חלב 3%', { amount: 2, unit: 'יח' })], m);
  assert.equal(stated?.line.amount, 2, 'a stated quantity is never overridden');
});

// --- write discipline ------------------------------------------------------

test('recordShop is the only thing that advances order count', () => {
  let m = confirm(emptyMemory('h1'), MILK, T0);
  assert.equal(m.products[memoryKey('חלב 3%')]?.orderCount, 0, 'confirming is not buying');
  m = recordShop(m, [MILK], days(1));
  m = recordShop(m, [MILK], days(5));
  assert.equal(m.products[memoryKey('חלב 3%')]?.orderCount, 2);
  assert.equal(m.products[memoryKey('חלב 3%')]?.confirmedAt, T0.toISOString(), 'confirmation survives');
});

test('switching to a different product for the same phrase resets its history', () => {
  let m = recordShop(emptyMemory('h1'), [MILK], T0);
  m = recordShop(m, [MILK], days(3));
  m = recordShop(m, [{ ...MILK, gtin: 'tara', productName: 'חלב טרה' }], days(6));
  const p = m.products[memoryKey('חלב 3%')];
  assert.equal(p?.gtin, 'tara');
  assert.equal(p?.orderCount, 1, 'history belongs to the product, not the phrase');
});

test('memory is immutable — writes return a new object', () => {
  const before = emptyMemory('h1');
  const after = confirm(before, MILK, T0);
  assert.notEqual(before, after);
  assert.deepEqual(before.products, {});
});

// --- the forgetting check --------------------------------------------------

test('learns a purchase rhythm from history using the median gap', () => {
  const h = [0, 4, 8, 12, 40, 44].map((d) => days(d).toISOString()); // one holiday gap of 28
  assert.equal(usualInterval(h), 4, 'the 28-day holiday gap does not teach us milk is monthly');
  assert.equal(usualInterval(h.slice(0, 2)), undefined, 'two purchases is not a rhythm');
});

test('suggests an item overdue against its own rhythm', () => {
  let m = emptyMemory('h1');
  for (const d of [0, 4, 8, 12]) m = recordShop(m, [MILK], days(d));
  // Day 16 = exactly one interval after the last purchase.
  const s = suggestMissing(m, [line('ביצים')], days(16));
  assert.equal(s[0]?.preference.gtin, MILK.gtin);
  assert.equal(s[0]?.reason, 'overdue');
  assert.equal(s[0]?.usualIntervalDays, 4);
});

test('does not suggest what is already on the list', () => {
  let m = emptyMemory('h1');
  for (const d of [0, 4, 8]) m = recordShop(m, [MILK], days(d));
  assert.deepEqual(suggestMissing(m, [line('חלב 3%')], days(20)), []);
  assert.deepEqual(suggestMissing(m, [line('milk', { gtin: MILK.gtin })], days(20)), [], 'matched by barcode too');
});

test('does not suggest an item bought only once, or one marked seasonal', () => {
  let m = recordShop(emptyMemory('h1'), [MILK], T0);
  assert.deepEqual(suggestMissing(m, [], days(30)), [], 'one purchase is not a habit');
  m = recordShop(m, [MILK], days(3));
  m = { ...m, products: { ...m.products, [memoryKey('חלב 3%')]: { ...m.products[memoryKey('חלב 3%')]!, excludeFromSuggestions: true } } };
  assert.deepEqual(suggestMissing(m, [], days(30)), []);
});

test('ranks overdue items before merely usual ones, most overdue first', () => {
  let m = emptyMemory('h1');
  const eggs = { phrase: 'ביצים', gtin: 'eggs', productName: 'ביצים L' };
  const oil = { phrase: 'שמן זית', gtin: 'oil', productName: 'שמן זית' };
  for (const d of [0, 4, 8, 12]) m = recordShop(m, [MILK], days(d)); // rhythm 4d
  for (const d of [0, 14, 28, 42]) m = recordShop(m, [eggs], days(d)); // rhythm 14d
  m = recordShop(m, [oil], days(0));
  m = recordShop(m, [oil], days(1)); // 2 orders, no rhythm → "usual"
  const s = suggestMissing(m, [], days(60));
  assert.deepEqual(
    s.map((x) => [x.preference.gtin, x.reason]),
    [[MILK.gtin, 'overdue'], ['eggs', 'overdue'], ['oil', 'usual']],
  );
});
