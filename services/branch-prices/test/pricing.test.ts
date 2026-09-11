import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONSTANTS } from '@fca/domain';
import { branchesInCity, nearestBranches, priceAtBranch, sameCity, travelTo, haversineKm, parseCarrefourPage, storeIdOf, type GeoBranch } from '../src/index.ts';

const b = (chain: string, storeId: string, lat: number, lng: number): GeoBranch => ({ chain, brand: chain, chainId: '1', subChainId: '0', storeId, name: `סניף ${storeId}`, address: '', city: 'תל אביב', lat, lng });
const home = { lat: 32.08, lng: 34.78 };

test('cities match by name or CBS code, tolerant of hyphens and the -יפו suffix', () => {
  const names = { '5000': 'תל אביב -יפו', '3000': 'ירושלים' };
  assert.ok(sameCity('5000', 'תל אביב', names));
  assert.ok(sameCity('תל-אביב יפו', 'תל אביב', names));
  assert.ok(!sameCity('3000', 'תל אביב', names));
  assert.ok(!sameCity('ראש העין', 'ראשון לציון', names));
  assert.equal(branchesInCity([b('x', '1', 0, 0)], 'תל אביב', names).length, 1);
});

test('nearest branches: within the radius, sorted, at most N per chain', () => {
  const all = [b('rami-levy', '1', 32.09, 34.78), b('rami-levy', '2', 32.10, 34.78), b('rami-levy', '3', 32.11, 34.78), b('shufersal', '9', 32.5, 34.78)];
  const near = nearestBranches(all, home, { radiusKm: 12, perChain: 2 });
  assert.deepEqual(near.map((x) => x.storeId), ['1', '2']);
  assert.ok(near[0]!.distanceKm > 0.9 && near[0]!.distanceKm < 1.3);
});

test('the round trip is priced by distance and never summed into the basket', () => {
  const t = travelTo(4, DEFAULT_CONSTANTS);
  assert.equal(t.distanceKm, 5.2);
  assert.equal(t.fuelCost, Math.round(10.4 * 250));
  assert.ok(t.roundTripMinutes >= 20);
  assert.ok(Math.abs(haversineKm(home, { lat: 32.08, lng: 34.79 }) - 0.94) < 0.05);
});

test('a list priced at a branch by barcode: hits priced, misses left for the coverage ratio', () => {
  const branch = { ...b('rami-levy', '1', 32.09, 34.78), distanceKm: 1.1 };
  const q = priceAtBranch(branch, { '7290004131074': [735, 'חלב 3%'] }, [{ id: 'a', query: 'חלב', gtin: '7290004131074', qty: 2 }, { id: 'b', query: 'לחם', gtin: '111', qty: 1 }, { id: 'c', query: 'ביצים', qty: 1 }], DEFAULT_CONSTANTS);
  assert.equal(q.quote.itemsSubtotal, 1470);
  assert.equal(q.quote.pricedLines, 1);
  assert.equal(q.quote.requestedLines, 3);
  assert.equal(q.quote.storefrontId, 'branch:rami-levy:1');
  assert.equal(q.quote.lines[0]!.lineId, 'a');
});

test('the carrefour page and file names give the day, the files and the branch', () => {
  const p = parseCarrefourPage(`<script>const path = '20260911';\n const files = [{"name":"PriceFull7290055700007-001-002-20260911-090015.gz","size":1}];\n const branches = {};</script>`);
  assert.equal(p.path, '20260911');
  assert.equal(storeIdOf(p.files[0]!.name), '002');
  assert.equal(storeIdOf('Stores7290055700007-000-20260911-000100.xml'), undefined);
});
