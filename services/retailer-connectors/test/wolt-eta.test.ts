import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaForStorefront, parseWoltFront, parseWoltVenueDynamic, woltEtasNear, woltNextOpen } from '../src/wolt-eta.ts';

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

test('the chains\' venues live on the grocery page, not the front page: both are read, the front page wins on a repeat', async () => {
  const front = { sections: [{ items: [{ venue: { slug: 'wolt-market-bialik', name: 'וולט מרקט | ביאליק', estimate: 30, estimate_range: '25-35', online: true, delivers: true } }] }] };
  const grocery = { sections: [{ items: [
    { venue: { slug: 'wolt-market-bialik', name: 'dup', estimate: 99 } },
    { venue: { slug: 'victory-rothschild', name: 'ויקטורי | רוטשילד', estimate: 50, online: false, delivers: false } },
  ] }] };
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => { seen.push(url); return new Response(JSON.stringify(/category-grocery/.test(url) ? grocery : front), { status: 200 }); }) as unknown as typeof fetch;
  const etas = await woltEtasNear(32.1, 34.83, fetchImpl);
  assert.equal(seen.length, 2);
  assert.equal(etas['wolt-market-bialik']!.minutes, 30);
  assert.equal(etaForStorefront('wolt-victory-rothschild', etas)?.online, false);
  // One page down does not lose the other.
  const half = (async (url: string) => (/category-grocery/.test(url) ? new Response(JSON.stringify(grocery), { status: 200 }) : new Response('', { status: 500 }))) as unknown as typeof fetch;
  const etas2 = await woltEtasNear(32.11, 34.84, half);
  assert.equal(etas2['victory-rothschild']!.minutes, 50);
});

test('the venue page\'s open status parses; a page that does not say yields undefined', () => {
  const open = parseWoltVenueDynamic({ venue: { delivery_open_status: { is_open: false, next_open: '2026-09-14T07:00:00+03:00', value: 'נפתח ביום שני' } } });
  assert.deepEqual(open, { isOpen: false, nextOpen: '2026-09-14T07:00', text: 'נפתח ביום שני' });
  assert.equal(parseWoltVenueDynamic({}), undefined);
  assert.equal(parseWoltVenueDynamic({ venue: {} }), undefined);
});

test('woltNextOpen reads the venue\'s dynamic page and never blocks on failure', async () => {
  const ok = await woltNextOpen('wolt-market-bialik', 32.08, 34.81, (async () => new Response(JSON.stringify({ venue: { delivery_open_status: { is_open: true } } }), { status: 200 })) as unknown as typeof fetch);
  assert.deepEqual(ok, { isOpen: true });
  const failed = await woltNextOpen('some-other-venue', 32.08, 34.81, (async () => { throw new Error('down'); }) as unknown as typeof fetch);
  assert.equal(failed, undefined);
});
