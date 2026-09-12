import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchForCity, dropUnavailable, nearestBranch } from '../src/rami-levy-stock.ts';

const branches = [{ id: 179, name: 'ראש העין', city: 'ראש העין' }, { id: 1198, name: 'רחובות', city: 'רחובות' }, { id: 1306, name: 'נהריה', city: 'נהרייה' }];

test('a line the branch does not carry is dropped; unknown stock keeps the line', () => {
  const av = new Map<string, number[]>([['1', [179, 331]], ['2', [331]]]);
  const { kept, dropped } = dropUnavailable([{ lineId: 'a', gtin: '1' }, { lineId: 'b', gtin: '2' }, { lineId: 'c', gtin: '3' }, { lineId: 'd' }], 179, av);
  assert.deepEqual(kept.map((l) => l.lineId), ['a', 'c', 'd']);
  assert.deepEqual(dropped.map((l) => l.lineId), ['b']);
});

test('the branch for a city, tolerant of spelling (נהריה / נהרייה); none for an unknown city', () => {
  assert.equal(branchForCity(branches, 'רחובות'), 1198);
  assert.equal(branchForCity(branches, 'נהריה'), 1306);
  assert.equal(branchForCity(branches, 'תל אביב'), undefined);
  assert.equal(branchForCity(branches, undefined), undefined);
});

test('the nearest online branch wins, and branches without a position are skipped', () => {
  const withGeo = [
    { id: 1225, name: 'רעננה', city: 'רעננה', lat: 32.1848, lng: 34.8713 },
    { id: 306, name: 'אשדוד', city: 'אשדוד', lat: 31.8044, lng: 34.6553 },
    { id: 999, name: 'לא ידוע', city: '' },
  ];
  // Kfar Saba has no online branch of its own; Raanana is next door, Ashdod is an hour away.
  assert.equal(nearestBranch(withGeo, { lat: 32.175, lng: 34.907 })?.id, 1225);
  assert.equal(nearestBranch([{ id: 9, name: 'x', city: '' }], { lat: 32, lng: 34 }), undefined);
});
