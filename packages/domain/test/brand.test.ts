import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandMatches, inferBrandFromName, nameSatisfiesQuery, normalizeBrand, resolveBrand, sharesWordWithQuery } from '../src/brand.ts';

test('collapses the ways the catalogue spells one firm', () => {
  // All three appeared in a single real search for "חלב 3%".
  assert.equal(normalizeBrand('תנובה'), 'תנובה');
  assert.equal(normalizeBrand('תנובה בע"מ'), 'תנובה');
  assert.equal(normalizeBrand('תנובה חלב'), 'תנובה');
});

test('maps sub-brands onto the firm a shopper names', () => {
  assert.equal(normalizeBrand('עלית'), 'שטראוס');
  assert.equal(normalizeBrand('שטראוס עלית'), 'שטראוס');
  assert.equal(normalizeBrand('אסם נסטלה'), 'אסם');
});

test('matches Latin and Hebrew spellings of the same brand', () => {
  assert.equal(normalizeBrand('Tnuva'), 'תנובה');
  assert.equal(normalizeBrand('Pampers'), 'פמפרס');
  assert.equal(normalizeBrand("אנג'ל"), 'אנגל');
  assert.equal(normalizeBrand('אנג׳ל'), 'אנגל');
});

test('treats a blank or missing brand as unusable, not as a brand', () => {
  assert.equal(normalizeBrand(null), undefined);
  assert.equal(normalizeBrand(''), undefined);
  assert.equal(normalizeBrand('   '), undefined);
  assert.equal(normalizeBrand('בע"מ'), undefined);
});

test('a family asking for תנובה matches every Tnuva spelling', () => {
  for (const spelling of ['תנובה', 'תנובה בע"מ', 'תנובה חלב', 'Tnuva']) {
    assert.ok(brandMatches('תנובה', spelling), `${spelling} should match`);
  }
});

test('a family asking for תנובה does not match a rival', () => {
  assert.equal(brandMatches('תנובה', 'טרה'), false);
  assert.equal(brandMatches('תנובה', 'מחלבת יטבתה'), false);
  assert.equal(brandMatches('תנובה', null), false);
});

test('no brand asked for means every brand is acceptable', () => {
  assert.ok(brandMatches(undefined, 'טרה'));
  assert.ok(brandMatches(undefined, null));
});

test('recovers a brand from the product name when the catalogue left it blank', () => {
  // Real: five Pampers products came back with brand null.
  assert.equal(inferBrandFromName('חיתולי פמפרס בייבי דריי מידה 4 29 יח'), 'פמפרס');
  assert.equal(inferBrandFromName("קוטג' תנובה 5% שומן 250 ג' בד\"צ"), 'תנובה');
  assert.equal(inferBrandFromName('לחם אחיד פרוס אנג׳ל 900 גרם'), 'אנגל');
});

test('the consumer brand in the name beats the manufacturer in the field', () => {
  // Real catalogue rows: the field is the maker or importer, not the brand.
  assert.equal(resolveBrand('PROCTER&GAMBLE', 'חיתולי פמפרס בייבי דריי מידה 4'), 'פמפרס');
  assert.equal(resolveBrand('דיפלומט', 'חיתולים פמפרס פרימיום מידה 4'), 'פמפרס');
  assert.equal(resolveBrand('מחלבת אלון תבור', "קוטג' תנובה 5% שומן 250 ג'"), 'תנובה');
  // …and the field is still used when the name carries nothing known.
  assert.equal(resolveBrand('טרה', 'חלב הומוגני 1 ליטר'), 'טרה');
  assert.equal(resolveBrand(null, 'לחם אחיד 750 גרם'), undefined);
});

test('numbers in the query are constraints on the product name', () => {
  assert.ok(nameSatisfiesQuery('חיתולי פמפרס מידה 4', 'חיתולי פמפרס בייבי דריי מידה 4 29 יח'));
  assert.equal(nameSatisfiesQuery('חיתולי פמפרס מידה 4', 'חיתולי פמפרס פרימיום מידה 1 44 יח'), false, '44 must not satisfy 4');
  assert.ok(nameSatisfiesQuery('חלב 3%', 'חלב תנובה 3% 1 ליטר'));
  assert.equal(nameSatisfiesQuery('חלב 3%', 'חלב תנובה 1% 1 ליטר'), false);
  assert.ok(nameSatisfiesQuery('חלב', 'חלב 1% שקית'), 'no numbers in the query means no constraint');
});

test('takes the longest brand match so a sub-string does not win', () => {
  assert.equal(inferBrandFromName('חלב רמי לוי 3%'), 'רמי לוי');
});

test('a name shares a real word with the query, or nothing in the query matches anything', () => {
  assert.ok(sharesWordWithQuery('חלב 3%', 'חלב תנובה 3% 1 ליטר'), 'a shared word is enough');
  assert.equal(sharesWordWithQuery('12345', 'לק קריסטל גלו 651 יח'), false, 'a bare number matching nothing');
  assert.equal(sharesWordWithQuery('מיץ קקטוס קפוא נדיר מהחלל', 'ויויל-סוכריות ללא סוכר טעם לימון'), false, 'real words, none of them shared');
  assert.equal(sharesWordWithQuery('', 'חלב 3%'), false, 'an empty query matches nothing, honestly');
});
