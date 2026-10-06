import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirm } from '@fca/domain';
import { FileMemoryRepository, VersionConflict } from '../src/index.ts';

const MILK = { phrase: 'חלב 3%', gtin: '7290000042015', productName: 'חלב' };

test('a repository for one household cannot see another household\'s memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fca-'));
  const h1 = new FileMemoryRepository('h1', dir);
  const h2 = new FileMemoryRepository('h2', dir);

  await h1.save(confirm(await h1.load(), MILK));

  const seenByH2 = await h2.load();
  assert.deepEqual(seenByH2.products, {}, 'h2 must see nothing of h1');
  assert.equal(seenByH2.householdId, 'h2');
});

test('a repository refuses to write memory that belongs to another household', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fca-'));
  const h1 = new FileMemoryRepository('h1', dir);
  const h2 = new FileMemoryRepository('h2', dir);
  const h2memory = confirm(await h2.load(), MILK);
  await assert.rejects(() => h1.save(h2memory), /Refusing to save memory for h2/);
  assert.deepEqual(await readdir(dir), [], 'and nothing was written');
});

test('household ids that could escape the directory are rejected', () => {
  assert.throws(() => new FileMemoryRepository('../h2', '/tmp'), RangeError);
  assert.throws(() => new FileMemoryRepository('h1/../h2', '/tmp'), RangeError);
});

test('two members saving from the same version: second one is told to reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fca-'));
  const repo = new FileMemoryRepository('h1', dir);
  const base = await repo.load();

  const parent = confirm(base, MILK);
  const child = confirm(base, { ...MILK, phrase: 'ביצים', gtin: 'eggs' });

  await repo.save(parent);
  await assert.rejects(() => repo.save(child), VersionConflict);

  const fresh = await repo.load();
  assert.equal(fresh.version, 2);
  assert.ok(fresh.products['חלב 3%'], 'the first write stands');
});
