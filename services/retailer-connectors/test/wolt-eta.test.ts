import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaForStorefront, parseWoltFront, woltEtasNear } from '../src/wolt-eta.ts';

const feed = {
  sections: [
    { items: [{ venue: { slug: 'wolt-market-bialik', name: 'וולט מרקט | ביאליק', estimate: 50, estimate_range: '45-55', online: true, delivers: true } }] },
    { items: [
      { venue: { slug: 'victory-ramat-gan', name: 'ויקטורי | רמת גן', estimate: 70, estimate_range: '65-75', online: true, delivers: true } },
      { venue: { slug: 'wolt-market-bialik', name: 'dup', estimate: 99 } },
      { venue: { slug: 'closed-place', name: 'x' } },
      { title: 'not a venue' },
    ] },
  ],
};

test('the feed parses into one estimate per venue, first sighting wins, venues without an estimate are skipped', () => {
  const etas = parseWoltFront(feed);
  assert.deepEqual(Object.keys(etas).sort(), ['victory-ramat-gan', 'wolt-market-bialik']);
  assert.equal(etas['wolt-market-bialik']!.minutes, 50);
  assert.equal(etas['wolt-market-bialik']!.range, '45-55');
});

test('a SuperMCP wolt storefront id maps to its venue; other storefronts have no live estimate', () => {
  const etas = parseWoltFront(feed);
  assert.equal(etaForStorefront('wolt-victory-ramat-gan', etas)?.minutes, 70);
  assert.equal(etaForStorefront('rami-levy-online', etas), undefined);
  assert.equal(etaForStorefront('wolt-unknown', etas), undefined);
});

test('a failing feed never blocks: empty estimates', async () => {
  const etas = await woltEtasNear(32.08, 34.81, (async () => { throw new Error('down'); }) as unknown as typeof fetch);
  assert.deepEqual(etas, {});
  const etas2 = await woltEtasNear(32.09, 34.82, (async () => new Response(JSON.stringify(feed), { status: 200 })) as unknown as typeof fetch);
  assert.equal(etas2['victory-ramat-gan']!.minutes, 70);
});
