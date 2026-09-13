import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupIntoVariants, shekels } from '@fca/domain';
import {
  brandGroups, carriedNearby, cheapestOf, choiceOf, lineFromHit, lineFromVariant,
  pinBrand, soleProduct, spanOf, unpin, variantId, variantWords,
} from '../src/lib/choice.ts';
import type { SearchHit, SearchVariant } from '../src/lib/api.ts';

// Real Israeli milk, as the chains spell it. The same shelf the domain's variant test uses,
// so the app and the domain group the family's words the same way.
const hit = (id: string, brand: string, name: string, qty: number, unit: string, from: number | undefined, chains = 3): SearchHit => ({
  productId: id, gtin: `g-${id}`, name, brand, rawBrand: brand,
  sizeQty: qty, sizeUnit: unit, ...(from !== undefined ? { fromPrice: shekels(from) } : {}),
  pricedAtChains: chains, imageUrl: from !== undefined ? `https://img/${id}.jpg` : null,
});

const MILK: SearchHit[] = [
  hit('tnuva-bag', 'תנובה', 'חלב 3% שומן שקית 1 ליטר', 1000, 'ml', 5.9),
  hit('tnuva-carton', 'תנובה בע"מ', 'חלב תנובה מהדרין 3% 1 ליטר', 1000, 'ml', 7.5),
  hit('tara', 'טרה', 'חלב הומוגני טרה 3% 1 ליטר', 1000, 'ml', 7.2),
  hit('yotvata', 'יטבתה', 'חלב יטבתה 3% 1 ליטר', 1000, 'ml', 8.4),
  hit('tnuva-3-2l', 'תנובה', 'חלב תנובה 3% 2 ליטר', 2000, 'ml', 10.9),
];

const variantsOf = (hits: SearchHit[]): SearchVariant[] =>
  groupIntoVariants(hits).map((v) => ({
    base: v.base, attrs: v.attrs, ...(v.size ? { size: v.size } : {}),
    brandCount: v.brandCount, ...(v.priceMin !== undefined ? { priceMin: v.priceMin } : {}),
    ...(v.priceMax !== undefined ? { priceMax: v.priceMax } : {}),
    products: v.candidates as SearchHit[],
  }));

test('a variant card adds "כל מותג": the variant\'s own words, and no pin', () => {
  const oneLitre = variantsOf(MILK).find((v) => v.size?.qty === 1000)!;
  const line = lineFromVariant(oneLitre);

  // The bug this holds: tapping a search result used to pin a barcode, so "חלב" meant
  // תנובה's carton at every store and the compare stopped being a comparison.
  assert.equal(choiceOf(line), 'any');
  assert.equal(line.gtin, undefined, 'a variant card must not pin a barcode');
  assert.equal(line.brand, undefined, 'a variant card must not name a brand');

  // The size has to be in the words: only query/gtin/brand/quantity reach the quote, so a
  // line that says only "חלב 3%" invites a store to price the 2 ℓ bottle (promise 4).
  assert.equal(line.query, 'חלב 3% 1 ליטר');
  assert.equal(line.size, '1 ליטר');
  assert.equal(line.imageUrl, 'https://img/tnuva-bag.jpg', 'the cheapest one lends its picture');
});

test('the 1 ℓ and the 2 ℓ are two cards, and two different lines', () => {
  const vs = variantsOf(MILK);
  assert.equal(vs.length, 2, '1 ℓ and 2 ℓ are not the same thing');
  const queries = vs.map((v) => variantWords(v)).sort();
  assert.deepEqual(queries, ['חלב 3% 1 ליטר', 'חלב 3% 2 ליטר']);
  assert.notEqual(variantId(vs[0]!), variantId(vs[1]!));
});

test('the card counts brands, not products: תנובה בע"מ is תנובה', () => {
  const oneLitre = variantsOf(MILK).find((v) => v.size?.qty === 1000)!;
  assert.equal(oneLitre.products.length, 4);
  assert.equal(oneLitre.brandCount, 3);
  assert.deepEqual(spanOf(oneLitre.products), { min: shekels(5.9), max: shekels(8.4) });
});

test('the brand sheet: one row per brand, its own span, cheapest first', () => {
  const oneLitre = variantsOf(MILK).find((v) => v.size?.qty === 1000)!;
  const gs = brandGroups(oneLitre.products);
  assert.deepEqual(gs.map((g) => g.brand), ['תנובה', 'טרה', 'יטבתה']);

  // תנובה's two packagings are one row spanning both prices — the family chooses a brand,
  // not a packaging, and gets that brand's cheapest.
  assert.equal(gs[0]!.products.length, 2);
  assert.equal(gs[0]!.priceMin, shekels(5.9));
  assert.equal(gs[0]!.priceMax, shekels(7.5));
  assert.equal(gs[0]!.cheapest.productId, 'tnuva-bag');
});

test('pinning a brand keeps the family\'s words and adds the pin; unpinning takes it off', () => {
  const oneLitre = variantsOf(MILK).find((v) => v.size?.qty === 1000)!;
  const any = { id: 'l1', ...lineFromVariant(oneLitre) };

  const pinned = pinBrand(any, brandGroups(oneLitre.products)[1]!);
  assert.equal(choiceOf(pinned), 'pinned');
  assert.equal(pinned.brand, 'טרה');
  assert.equal(pinned.gtin, 'g-tara');
  assert.equal(pinned.query, 'חלב 3% 1 ליטר', 'the words on the list stay the family\'s');
  assert.equal(pinned.productName, 'חלב הומוגני טרה 3% 1 ליטר');

  const back = unpin(pinned);
  assert.equal(choiceOf(back), 'any');
  assert.ok(!('gtin' in back), 'gtin is dropped, not blanked — "" is still an instruction');
  assert.ok(!('brand' in back), 'brand is dropped, not blanked');
  assert.equal(back.query, 'חלב 3% 1 ליטר');
  assert.equal(back.size, '1 ליטר');
});

test('one product behind a variant means there is nothing to choose: the product is the card', () => {
  const single = variantsOf([hit('solo', 'יטבתה', 'חלב יטבתה 1% 1 ליטר', 1000, 'ml', 6.4)]);
  const sole = soleProduct(single[0]!)!;
  assert.equal(sole.productId, 'solo');
  const line = lineFromHit(sole);
  assert.equal(choiceOf(line), 'pinned', 'one product is itself the choice');
  assert.equal(line.brand, 'יטבתה');
  assert.equal(line.size, '1 ליטר');
});

test('a variant no nearby store carries is greyed and named, never dropped', () => {
  const nowhere = variantsOf([hit('gone', 'תנובה', 'חלב תנובה 3% 3 ליטר', 3000, 'ml', undefined, 0)]);
  assert.equal(nowhere.length, 1, 'it stays on the screen');
  assert.equal(carriedNearby(nowhere[0]!), false);
  assert.equal(spanOf(nowhere[0]!.products), undefined, 'no price is claimed for it');
  // Still addable: the family's words go on the list and the compare tries every store.
  assert.equal(choiceOf(lineFromVariant(nowhere[0]!)), 'any');
});

test('a product with no price at all still lends the card its identity', () => {
  assert.equal(cheapestOf([hit('u', 'תנובה', 'חלב תנובה 3% 1 ליטר', 1000, 'ml', undefined, 0)])?.productId, 'u');
  assert.equal(cheapestOf([]), undefined);
});

test('a product the catalogue gives no brand for is not a brand to choose', () => {
  const unbranded: SearchHit = { productId: 'x', name: 'חלב 3% 1 ליטר', sizeQty: 1000, sizeUnit: 'ml', fromPrice: shekels(6), pricedAtChains: 2, imageUrl: null };
  assert.deepEqual(brandGroups([unbranded, ...MILK]).map((g) => g.brand), ['תנובה', 'טרה', 'יטבתה']);
});
