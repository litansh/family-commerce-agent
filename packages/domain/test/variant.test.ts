import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupIntoVariants, variantKey } from '../src/variant.ts';
import { shekels } from '../src/money.ts';
import type { ProductCandidate } from '../src/types.ts';

const p = (id: string, brand: string, name: string, sizeQty: number, sizeUnit: string, from: number): ProductCandidate => ({
  productId: id,
  gtin: `gtin-${id}`,
  name,
  brand,
  rawBrand: brand,
  sizeQty,
  sizeUnit,
  fromPrice: shekels(from),
  pricedAtChains: 3,
});

test('milk: four brands and packagings of the same 1L 3% collapse into one variant', () => {
  const candidates = [
    p('tnuva-bag', 'תנובה', 'חלב 3% שומן שקית 1 ליטר', 1000, 'ml', 6.41),
    p('tnuva-carton', 'תנובה בע"מ', 'חלב תנובה מהדרין 3% 1 ליטר', 1000, 'ml', 7.35),
    p('tara', 'טרה', 'חלב הומוגני טרה 3% 1 ליטר', 1000, 'ml', 7.35),
    p('yotvata', 'יטבתה', 'חלב יטבתה 3% 1 ליטר', 1000, 'ml', 7.35),
  ];
  const variants = groupIntoVariants(candidates);
  assert.equal(variants.length, 1);
  assert.equal(variants[0]!.base, 'חלב');
  assert.equal(variants[0]!.attrs, '3%');
  assert.deepEqual(variants[0]!.size, { qty: 1000, unit: 'ml' });
  assert.equal(variants[0]!.candidates.length, 4);
  assert.equal(variants[0]!.brandCount, 3, 'תנובה and תנובה בע"מ are one brand');
  assert.equal(variants[0]!.priceMin, shekels(6.41));
  assert.equal(variants[0]!.priceMax, shekels(7.35));
});

test('milk: a different fat percentage and a different pack size are different variants', () => {
  const candidates = [
    p('tnuva-3-1l', 'תנובה', 'חלב תנובה 3% 1 ליטר', 1000, 'ml', 7.35),
    p('tnuva-1-1l', 'תנובה', 'חלב תנובה 1% 1 ליטר', 1000, 'ml', 6.9),
    p('tnuva-3-2l', 'תנובה', 'חלב תנובה 3% 2 ליטר', 2000, 'ml', 13.9),
  ];
  const variants = groupIntoVariants(candidates);
  assert.equal(variants.length, 3, 'fat % and pack size each define a different variant');
  const key3_1l = variantKey(candidates[0]!);
  const key1_1l = variantKey(candidates[1]!);
  const key3_2l = variantKey(candidates[2]!);
  assert.equal(key3_1l.base, key1_1l.base);
  assert.notEqual(key3_1l.attrs, key1_1l.attrs, 'fat % differs');
  assert.notEqual(key3_1l.size?.qty, key3_2l.size?.qty, 'pack size differs');
});

test('eggs: count is the size, not a separate attribute; two brands of the same dozen collapse', () => {
  const candidates = [
    p('tnuva-12', 'תנובה', 'ביצים תנובה L 12 יח', 12, 'unit', 14.9),
    p('oftov-12', 'עוף טוב', 'ביצים עוף טוב L 12 יח', 12, 'unit', 13.9),
    p('tnuva-6', 'תנובה', 'ביצים תנובה L 6 יח', 6, 'unit', 8.9),
  ];
  const variants = groupIntoVariants(candidates);
  const dozen = variants.find((v) => v.size?.qty === 12);
  const half = variants.find((v) => v.size?.qty === 6);
  assert.ok(dozen); assert.ok(half);
  assert.equal(dozen!.candidates.length, 2);
  assert.equal(dozen!.brandCount, 2);
  assert.equal(half!.candidates.length, 1);
  assert.equal(dozen!.base, half!.base, 'the same product, only the count differs');
});

test('coffee: grind is the defining attribute; a store brand of the same grind and size joins the name brand', () => {
  const candidates = [
    p('elite-ground-200', 'עלית', 'קפה טחון עלית 200 גרם', 200, 'g', 18.9),
    p('store-ground-200', 'שופרסל', 'קפה טחון 200 גרם', 200, 'g', 14.9),
    p('elite-beans-200', 'עלית', 'קפה פולים עלית 200 גרם', 200, 'g', 22.9),
    p('elite-ground-500', 'עלית', 'קפה טחון עלית 500 גרם', 500, 'g', 39.9),
  ];
  const variants = groupIntoVariants(candidates);
  const ground200 = variants.find((v) => v.attrs === 'טחון' && v.size?.qty === 200);
  assert.ok(ground200);
  assert.equal(ground200!.candidates.length, 2, 'the store brand and עלית, same grind and size');
  assert.equal(variants.length, 3, 'grind and pack size each still separate the other two');
});

test('cream: sweet and sour are different products even at the same brand, never merged by percentage alone', () => {
  const candidates = [
    p('tnuva-sweet', 'תנובה', 'שמנת מתוקה תנובה 38% 250 מ"ל', 250, 'ml', 6.9),
    p('tara-sweet', 'טרה', 'שמנת מתוקה טרה 38% 250 מ"ל', 250, 'ml', 6.5),
    p('tnuva-sour', 'תנובה', 'שמנת חמוצה תנובה 15% 250 מ"ל', 250, 'ml', 5.9),
  ];
  const variants = groupIntoVariants(candidates);
  const sweet = variants.find((v) => v.base === 'שמנת מתוקה');
  const sour = variants.find((v) => v.base === 'שמנת חמוצה');
  assert.ok(sweet); assert.ok(sour);
  assert.equal(sweet!.candidates.length, 2);
  assert.equal(sweet!.brandCount, 2);
  assert.equal(sour!.candidates.length, 1);
});

test('no candidate is dropped: every product is in exactly one variant', () => {
  const candidates = [
    p('a', 'תנובה', 'חלב תנובה 3% 1 ליטר', 1000, 'ml', 7),
    p('b', 'טרה', 'חלב טרה 1% 1 ליטר', 1000, 'ml', 6.5),
    p('c', 'עלית', 'קפה טחון עלית 200 גרם', 200, 'g', 18),
  ];
  const variants = groupIntoVariants(candidates);
  const seen = variants.flatMap((v) => v.candidates.map((c) => c.productId));
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
});
