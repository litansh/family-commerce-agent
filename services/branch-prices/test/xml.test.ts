import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeXml, parsePriceFull, parseStores, sameStoreId } from '../src/xml.ts';

const stores = `﻿<?xml version="1.0" encoding="UTF-8"?><Chain><ChainID>7290027600007</ChainID><SubChains><SubChain><SubChainID>1</SubChainID><Stores>
<Store><StoreID>756</StoreID><StoreName>שלי באר יעקב</StoreName><Address>17 יצחק שמיר</Address><City>2530</City><ZIPCode>7030336</ZIPCode></Store>
<Store><StoreID>374</StoreID><StoreName>שלי הרצליה</StoreName><Address>הבנים 46</Address><City>6400</City></Store>
</Stores></SubChain></SubChains></Chain>`;

test('a Stores file: every branch with its sub-chain, address and city (a name or a CBS code)', () => {
  const b = parseStores(stores);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], { chainId: '7290027600007', subChainId: '1', storeId: '756', name: 'שלי באר יעקב', address: '17 יצחק שמיר', city: '2530', zip: '7030336' });
  assert.equal(b[1]!.zip, undefined);
});

test('a flat Stores file (no sub-chains) with lower-case tags parses the same', () => {
  const b = parseStores('<Root><ChainId>1</ChainId><Stores><Store><StoreId>001</StoreId><StoreName>מרכז</StoreName><Address>הרצל 1</Address><City>ירושלים</City><ZipCode>9</ZipCode></Store></Stores></Root>');
  assert.deepEqual(b, [{ chainId: '1', subChainId: '0', storeId: '001', name: 'מרכז', address: 'הרצל 1', city: 'ירושלים', zip: '9' }]);
});

test('bytes decode whatever the chain chose: gzip, UTF-8 BOM, UTF-16LE BOM', () => {
  assert.equal(decodeXml(gzipSync(Buffer.from(stores))).slice(0, 5), '<?xml');
  assert.equal(decodeXml(Buffer.from('﻿<a/>')), '<a/>');
  assert.equal(decodeXml(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<a>ש</a>', 'utf16le')])), '<a>ש</a>');
});

test('a PriceFull file: barcodes only, agorot, weighed goods and internal codes skipped', () => {
  const xml = `<Root><ChainID>7290058140886</ChainID><SubChainID>001</SubChainID><StoreID>001</StoreID><Items>
<Item><ItemCode>7290004131074</ItemCode><ItemName>חלב 3%</ItemName><bIsWeighted>0</bIsWeighted><ItemPrice>7.35</ItemPrice></Item>
<Item><ItemCode>12345</ItemCode><ItemName>פנימי</ItemName><ItemPrice>1.00</ItemPrice></Item>
<Item><ItemCode>7290000000001</ItemCode><ItemName>עגבניות</ItemName><bIsWeighted>1</bIsWeighted><ItemPrice>6.90</ItemPrice></Item>
<Item><ItemCode>7290000000002</ItemCode><ItemName>חינם</ItemName><ItemPrice>0.00</ItemPrice></Item>
</Items></Root>`;
  const p = parsePriceFull(xml);
  assert.equal(p.storeId, '001');
  assert.deepEqual(p.prices, { '7290004131074': [735, 'חלב 3%'] });
});

test('entities and stray control characters in addresses are cleaned', () => {
  const b = parseStores('<Root><ChainId>1</ChainId><Stores><Store><StoreId>7</StoreId><StoreName>רמת החייל</StoreName><Address>דבורה הנביאה 127&#x0D;</Address><City>תל אביב &amp; יפו</City></Store></Stores></Root>');
  assert.equal(b[0]!.address, 'דבורה הנביאה 127');
  assert.equal(b[0]!.city, 'תל אביב & יפו');
});

test('store ids match across zero padding', () => {
  assert.ok(sameStoreId('001', '1'));
  assert.ok(!sameStoreId('010', '1'));
});
