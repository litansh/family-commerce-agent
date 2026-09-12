import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchForCity, dropUnavailable } from '../src/rami-levy-stock.ts';

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
