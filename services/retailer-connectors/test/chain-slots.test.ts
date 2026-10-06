import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainWindow, nowInIsrael, parseRamiLevySupply, ramiLevyWindow } from '../src/chain-slots.ts';

const supply = {
  data: {
    '2026-09-13': [
      { fromHour: '08:00', toHour: '10:00', active: false },
      { fromHour: '10:00', toHour: '12:00', active: true },
      { fromHour: '20:00', toHour: '22:00', active: true },
    ],
    '2026-09-14': [{ fromHour: '07:00', toHour: '09:00', active: true }],
  },
};

test('the earliest active window still ahead of now wins, inactive and past windows are skipped', () => {
  const w = parseRamiLevySupply(supply, '2026-09-13T09:00');
  assert.deepEqual(w, { earliest: '2026-09-13T10:00', until: '12:00', windowHours: 2 });
});

test('every window today already started: tomorrow\'s earliest is used', () => {
  const w = parseRamiLevySupply(supply, '2026-09-13T21:00');
  assert.equal(w?.earliest, '2026-09-14T07:00');
});

test('a malformed or empty answer yields no window, never throws', () => {
  assert.equal(parseRamiLevySupply(undefined, '2026-09-13T09:00'), undefined);
  assert.equal(parseRamiLevySupply({}, '2026-09-13T09:00'), undefined);
  assert.equal(parseRamiLevySupply({ data: [] }, '2026-09-13T09:00'), undefined);
});

test('nowInIsrael formats as a comparable wall-clock string', () => {
  assert.match(nowInIsrael(new Date('2026-01-01T00:00:00Z')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('rami-levy asks the site\'s own autocomplete then its supply-date, address only, never a session', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/city?')) return new Response(JSON.stringify({ data: [{ city_id: 5, city_name: 'תל אביב' }] }), { status: 200 });
    if (String(url).includes('/street?')) return new Response(JSON.stringify({ data: [{ street_id: 9, street_name: 'הרצל' }] }), { status: 200 });
    return new Response(JSON.stringify(supply), { status: 200 });
  }) as unknown as typeof fetch;
  const w = await ramiLevyWindow({ city: 'תל אביב', street: 'הרצל', number: '1' }, fetchImpl, '2026-09-13T09:00');
  assert.deepEqual(w, { earliest: '2026-09-13T10:00', until: '12:00', windowHours: 2 });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => !c.includes('cookie') && !/session|token/i.test(c)));
});

test('a failing lookup never blocks: undefined, not a throw', async () => {
  const fetchImpl = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  assert.equal(await ramiLevyWindow({ city: 'x', street: 'y' }, fetchImpl), undefined);
  assert.equal(await ramiLevyWindow({}, fetchImpl), undefined);
});

test('chainWindow only knows rami-levy today; other storefronts get no published window', async () => {
  assert.equal(await chainWindow('victory-ramat-gan', { city: 'x', street: 'y' }), undefined);
  assert.equal(await chainWindow('shufersal-online', { city: 'x', street: 'y' }), undefined);
});
