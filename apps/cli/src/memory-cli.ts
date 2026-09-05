#!/usr/bin/env node
/**
 * Household memory from the command line.
 *
 *   npm run memory -- confirm "חלב 3%" 7290000042015 "חלב 3% שקית 1 ליטר" [תנובה]
 *   npm run memory -- done  runs/<shop-run>.json      # a shop was completed
 *   npm run memory -- suggest examples/weekly.json    # what did we forget?
 *   npm run memory -- show
 *
 * Memory lives in ./memory/household-<id>.json (gitignored). HOUSEHOLD=<id>
 * selects the household; default "home".
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirm, recordShop, suggestMissing, type ListLine, type PurchaseOption } from '@fca/domain';
import { memoryRepo } from './memory-repo.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const repo = memoryRepo();
  const mem = await repo.load();

  switch (cmd) {
    case 'confirm': {
      const [phrase, gtin, productName, brand] = rest;
      if (!phrase || !gtin || !productName) throw new Error('confirm <phrase> <gtin> <product name> [brand]');
      await repo.save(confirm(mem, { phrase, gtin, productName, ...(brand ? { brand } : {}) }));
      console.log(`✓ "${phrase}" → ${gtin}  ${productName}${brand ? `  (${brand})` : ''}`);
      console.log('  This line will never be guessed again.');
      return;
    }
    case 'done': {
      const [runPath] = rest;
      if (!runPath) throw new Error('done <runs/shop-run.json>');
      const run = JSON.parse(await readFile(resolve(ROOT, runPath), 'utf8')) as {
        lines: ListLine[];
        options: PurchaseOption[];
        quotes?: unknown;
      };
      const chosen = run.options[0];
      if (!chosen) throw new Error('run has no options');
      // What was actually bought: every priced line of the chosen option.
      const byId = new Map(run.lines.map((l) => [l.id, l]));
      const bought = chosen.legs.flatMap((leg) => leg.lineIds).flatMap((id) => {
        const l = byId.get(id);
        const q = (run as { quotedLines?: Record<string, { gtin?: string; productName: string }> }).quotedLines?.[id];
        if (!l || !q?.gtin) return [];
        return [{ phrase: l.query, gtin: q.gtin, productName: q.productName, ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined && l.unit ? { amount: l.amount, unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }];
      });
      await repo.save(recordShop(mem, bought));
      console.log(`✓ recorded ${bought.length} purchased lines. Memory learns only from completed shops.`);
      return;
    }
    case 'suggest': {
      const [listPath] = rest;
      const lines: ListLine[] = listPath
        ? (JSON.parse(await readFile(resolve(ROOT, listPath), 'utf8')) as { lines: Omit<ListLine, 'id'>[] }).lines.map((l, i) => ({ id: `l${i}`, ...l }))
        : [];
      const s = suggestMissing(mem, lines);
      if (s.length === 0) { console.log('Nothing you usually buy is missing.'); return; }
      console.log(`\nYou usually buy these and they are not on the list:\n`);
      for (const x of s) {
        const why = x.reason === 'overdue' ? `overdue — every ~${x.usualIntervalDays}d, last ${x.daysSince}d ago` : `bought ${x.preference.orderCount}×, last ${x.daysSince}d ago`;
        console.log(`  • ${x.preference.phrase.padEnd(24)} ${x.preference.productName.slice(0, 36).padEnd(38)} ${why}`);
      }
      console.log();
      return;
    }
    case 'show': {
      const ps = Object.values(mem.products);
      console.log(`household ${mem.householdId} · v${mem.version} · ${ps.length} products · ${mem.brands.length} brand rules\n`);
      for (const p of ps) console.log(`  ${p.confirmedAt ? '✓' : '·'} ${p.phrase.padEnd(24)} ${p.gtin.padEnd(15)} ${p.productName.slice(0, 40).padEnd(42)} ×${p.orderCount}`);
      return;
    }
    default:
      throw new Error('usage: memory confirm|done|suggest|show');
  }
}
main().catch((e: unknown) => { console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
