import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAIB_CHAINS, getBytes, laibPortal, parseLaibFiles } from '../src/portals.ts';
import { parseStores } from '../src/xml.ts';
import { gzipSync } from 'node:zlib';

const listing = JSON.stringify([
  { branchNumber: 0, fileName: 'Stores7290696200003-000-20260912060100-060100.gz', fileType: 'stores', fileDate: '2026-09-12 06:01:00', fileSize: '2.42 KB' },
  { branchNumber: 16, fileName: 'PriceFull7290696200003-001-016-20260911-051134.gz', fileType: 'pricefull', fileDate: '2026-09-11 05:11:34', fileSize: '544.64 KB' },
  { branchNumber: 16, fileName: 'PriceFull7290696200003-001-016-20260912-051134.gz', fileType: 'pricefull', fileDate: '2026-09-12 05:11:34', fileSize: '544.64 KB' },
  { branchNumber: 16, fileName: 'Price7290696200003-001-016-20260912-100739.gz', fileType: 'price', fileDate: '2026-09-12 10:07:39', fileSize: '545.04 KB' },
  { branchNumber: 16, fileName: 'PromoFull7290696200003-001-016-20260912-051150.gz', fileType: 'promofull', fileDate: '2026-09-12 05:11:51', fileSize: '167.24 KB' },
  { branchNumber: 60, fileName: 'PriceFull7290696200003-001-060-20260912-051112.gz', fileType: 'pricefull', fileDate: '2026-09-12 05:11:12', fileSize: '530.02 KB' },
]);

test('laibcatalog listing: every file with its branch and lower-case type; garbage is empty', () => {
  const f = parseLaibFiles(listing);
  assert.equal(f.length, 6);
  assert.deepEqual(f[1], { branch: '16', name: 'PriceFull7290696200003-001-016-20260911-051134.gz', type: 'pricefull', date: '2026-09-11 05:11:34' });
  assert.deepEqual(parseLaibFiles('<html>'), []);
  assert.deepEqual(parseLaibFiles('{"message":"FilesRootPath is invalid"}'), []);
});

const storesXml = '<Root><ChainID>7290696200003</ChainID><SubChains><SubChain><SubChainId>001</SubChainId><Stores><Store><StoreID>016</StoreID><StoreName>פלורנטין</StoreName><Address>סלמה 53</Address><City>תל אביב</City><ZipCode>6606034</ZipCode></Store></Stores></SubChain></SubChains></Root>';

test('the Victory portal: Stores from the listing, the newest PriceFull of a branch, downloads under /webapi/<chain>/', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.includes('/webapi/api/getfiles?edi=7290696200003')) return new Response(listing, { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/webapi/7290696200003/Stores7290696200003-000-20260912060100-060100.gz')) return new Response(gzipSync(Buffer.from(storesXml)));
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const p = laibPortal('victory', fetchImpl);
  assert.equal(p.brand, 'ויקטורי');
  const stores = await p.stores();
  assert.deepEqual(stores, [{ chainId: '7290696200003', subChainId: '001', storeId: '016', name: 'פלורנטין', address: 'סלמה 53', city: 'תל אביב', zip: '6606034' }]);
  const ref = await p.priceFile('16');
  assert.equal(ref?.name, 'PriceFull7290696200003-001-016-20260912-051134.gz');
  assert.equal(ref?.url, 'https://laibcatalog.co.il/webapi/7290696200003/PriceFull7290696200003-001-016-20260912-051134.gz');
  assert.equal(await p.priceFile('99'), undefined);
  // One listing fetch served the stores and both price lookups.
  assert.equal(calls.filter((u) => u.includes('getfiles')).length, 1);
  assert.equal(Object.keys(LAIB_CHAINS).length, 3);
});

test('a Stores file that wraps branches in <Branch> (H. Cohen) parses like one with <Store>', () => {
  const b = parseStores('<Store Date="12/09/26"><Branches><Branch><ChainID>7290455000004</ChainID><SubChainID>001</SubChainID><StoreID>001</StoreID><StoreName>המלאכה</StoreName><Address> </Address><City /><ZIPCode /></Branch></Branches></Store>');
  assert.deepEqual(b, [{ chainId: '7290455000004', subChainId: '001', storeId: '001', name: 'המלאכה', address: '', city: '' }]);
});

// 2026-10-07 04:05Z: laibcatalog's listing and a Shufersal branch listing each hung past the
// deadline once, while the next request answered at the usual speed.
const hangsUntilAborted = (init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError'))));

test('a portal request that hangs once is tried again on a fresh request', async () => {
  let n = 0;
  const fetchImpl = (async (_u: string, init?: RequestInit) => (++n === 1 ? hangsUntilAborted(init) : new Response('ok'))) as unknown as typeof fetch;
  assert.equal((await getBytes('https://laibcatalog.co.il/webapi/api/getfiles?edi=1', fetchImpl, {}, 30)).toString(), 'ok');
  assert.equal(n, 2);
});

test('a portal that hangs every time fails naming the request and the deadline, not a bare abort; an HTTP error is not retried', async () => {
  let n = 0;
  const hang = (async (_u: string, init?: RequestInit) => { n++; return hangsUntilAborted(init); }) as unknown as typeof fetch;
  await assert.rejects(getBytes('https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=117', hang, {}, 30), (e: Error) => e.message === 'no answer in 0.03s (2 attempts): https://prices.shufersal.co.il/FileObject/UpdateCategory');
  assert.equal(n, 2);
  let m = 0;
  const gone = (async () => { m++; return new Response('', { status: 404 }); }) as unknown as typeof fetch;
  await assert.rejects(getBytes('https://x.example/a.gz', gone), /HTTP 404/);
  assert.equal(m, 1);
});
