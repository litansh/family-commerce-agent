import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shufersalCodes, readShufersalPage, sameProduct } from '../src/shufersal-page.ts';

// Shapes as Shufersal's own page shipped them on 2026-10-08 (P_915883, minced beef), trimmed.
const page = (code: string, title: string) => `<html><head>
<meta property="og:title" content="${[...title].map((c) => `&#${c.charCodeAt(0)};`).join('')}"
<meta property="og:image" content="https://res.cloudinary.com/shufersal/image/upload/f_auto,q_auto/v1551800922/prod/product_images/products_medium/BVG34_M_P_${code}_1.png"
</head><body><div data-product-code="P_${code}"></div></body></html>`;

test('a packaged barcode is tried as itself; a GS1-Israel in-store barcode also as the chain code', () => {
  assert.deepEqual(shufersalCodes('5702016617740'), ['5702016617740']);
  assert.deepEqual(shufersalCodes('7290000915883'), ['7290000915883', '915883']);
  assert.deepEqual(shufersalCodes('7290009806595'), ['7290009806595', '9806595']);
  assert.deepEqual(shufersalCodes('7290002866220'), ['7290002866220', '2866220']);
});

test('the product page gives its own title and photograph', () => {
  const p = readShufersalPage(page('915883', 'בשר בקר טחון טרי'), '915883');
  assert.deepEqual(p, { title: 'בשר בקר טחון טרי', image: 'https://res.cloudinary.com/shufersal/image/upload/f_auto,q_auto/v1551800922/prod/product_images/products_medium/BVG34_M_P_915883_1.png' });
});

test('a page for another code, the category placeholder, or a challenge page gives nothing', () => {
  assert.equal(readShufersalPage(page('915883', 'בשר'), '999999'), null);
  const placeholder = '<meta property="og:title" content="x"<meta property="og:image" content="https://res.cloudinary.com/shufersal/image/upload/prod/category_images/AIJ08_S_S.png"<div data-product-code="P_1">';
  assert.equal(readShufersalPage(placeholder, '1'), null);
  assert.equal(readShufersalPage(`<title>Just a moment...</title>${page('1', 'x y')}`, '1'), null);
});

test('the deal and the page must name the same product before a photograph is kept', () => {
  assert.ok(sameProduct('בשר בקר טחון טרי קג', 'בשר בקר טחון טרי'));
  assert.ok(sameProduct('ב2- ב 160 שח דניס שלם טרי', 'דניס נקי טרי'));
  assert.ok(sameProduct('קופסת לבנים 65 חלקים', 'קופסת לבנים'));
  assert.ok(sameProduct('שוקיים ע.טרי פרימה ארוז', 'שוקיים ע.טרי פרימה ארוז'));
  // A stripped prefix that lands on an unrelated product is refused: a drawn icon beats a wrong photo.
  assert.ok(!sameProduct('בשר בקר טחון טרי קג', 'שמפו לשיער יבש'));
  assert.ok(!sameProduct('דג אמנון שלם טרי קג', 'טרי'), 'one generic word in common is not the same product');
});
