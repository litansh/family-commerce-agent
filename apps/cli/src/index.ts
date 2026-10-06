#!/usr/bin/env node
/**
 * Phase 1 measurement instrument.
 *
 * Runs the household's real list through the quote provider and our optimizer,
 * prints the options, and writes the whole run to disk. The saved run is three
 * things at once: the resolution-accuracy evidence for the Phase 1 gate, a
 * regression fixture for the optimizer, and the seed corpus for the preference
 * store.
 *
 *   npm run shop -- --list examples/weekly.json --address "הרצל 1, רמת גן"
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONSTANTS,
  agorot,
  formatILS,
  optimize,
  subAgorot,
  type Agorot,
  type ListLine,
  type PurchaseOption,
} from '@fca/domain';
import { SuperMcpQuoteProvider } from '@fca/retailer-connectors';
import { applyMemory, suggestMissing } from '@fca/domain';
import { memoryRepo } from './memory-repo.ts';
import { quoteWithFallback } from '@fca/shopping-agent';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Args {
  list: string;
  address: string;
  pickup: boolean;
  save: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = get('--list');
  const address = get('--address');
  if (!list || !address) {
    console.error(
      'usage: npm run shop -- --list <file.json> --address "<address>" [--pickup] [--no-save]',
    );
    process.exit(2);
  }
  return {
    list,
    address,
    pickup: argv.includes('--pickup'),
    save: !argv.includes('--no-save'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(resolve(ROOT, args.list), 'utf8')) as {
    lines: Omit<ListLine, 'id'>[];
  };
  const typed: ListLine[] = raw.lines.map((l, i) => ({ id: `l${i}`, ...l }));

  // Memory first: every phrase the household confirmed before becomes a
  // barcode, and stops being guessed.
  const memory = await memoryRepo().load();
  const applied = applyMemory(typed, memory);
  const lines = applied.map((a) => a.line);
  const fromMemory = applied.filter((a) => a.fromMemory).length;

  console.log(`\n🛒 ${lines.length} lines → ${args.address}${args.pickup ? '  (pickup)' : ''}`);
  if (fromMemory > 0) console.log(`   ${fromMemory} lines resolved from household memory`);

  // The forgetting check, before anything is priced.
  const missing = suggestMissing(memory, lines);
  if (missing.length > 0) {
    console.log(`\n   ⚠ you usually buy these and they are not on the list:`);
    for (const m of missing.slice(0, 6)) console.log(`     • ${m.preference.phrase}  (${m.reason === 'overdue' ? `every ~${m.usualIntervalDays}d, last ${m.daysSince}d ago` : `${m.preference.orderCount}× before`})`);
  }
  console.log('   asking supermcp…');

  const provider = new SuperMcpQuoteProvider();
  const res = await quoteWithFallback(
    provider,
    { lines, address: args.address, serviceType: args.pickup ? 'pickup' : 'delivery' },
    memory,
  );
  console.log(`   ${res.quotes.length} storefronts in ${(res.latencyMs / 1000).toFixed(1)}s\n`);

  const { options, rejected, warnings } = optimize({
    quotes: res.quotes,
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: lines.map((l) => l.id),
  });

  // --- Options -------------------------------------------------------------
  if (options.length === 0) {
    console.log('❌ No storefront could price enough of this list to be worth offering.\n');
  }
  const letters = 'ABCDEFGH';
  const nameOf = (id: string): string => lines.find((l) => l.id === id)?.query ?? id;
  options.forEach((o, i) => printOption(letters[i] ?? '?', o, options[0], nameOf));

  // --- Resolution quality: the Phase 1 gate --------------------------------
  //
  // Not every provider assumption is an error. "עגבניות" → "עגבניות" is a fine
  // answer to a generic request; "סלמון" → smoked salmon 100g when the family
  // meant a kilo of fresh is not. Three buckets, because one number would hide
  // the difference that matters.
  const suspectIds = new Set(
    warnings.map((w) => /\(([^)]+)\)/.exec(w)?.[1] ?? '').filter(Boolean),
  );
  const assumedIds = new Set(res.assumptions.map((a) => a.lineId));

  const memoryIds = new Set(applied.filter((a) => a.fromMemory).map((a) => a.line.id));
  const exact = lines.filter((l) => memoryIds.has(l.id) || (!assumedIds.has(l.id) && !suspectIds.has(l.id)));
  const suspect = lines.filter((l) => suspectIds.has(l.id) && !memoryIds.has(l.id));
  const generic = lines.filter((l) => assumedIds.has(l.id) && !suspectIds.has(l.id) && !memoryIds.has(l.id));

  // What matters for the gate is "did we get a product the family would accept",
  // so a plausible generic counts as resolved. A suspect line does not.
  const acceptable = exact.length + generic.length;
  const pct = Math.round((acceptable / lines.length) * 100);

  console.log('─'.repeat(64));
  console.log(`RESOLUTION  ${acceptable}/${lines.length} lines acceptable (${pct}%)  ·  gate 85%, floor 70%`);
  console.log(
    `            ${exact.length} exact (${memoryIds.size} from memory)  ·  ${generic.length} generic default  ·  ${suspect.length} suspect`,
  );

  if (suspect.length > 0) {
    console.log(`\n⚠️  ${suspect.length} lines are probably matched to the wrong product:`);
    for (const w of warnings) console.log(`    ${w}`);
    console.log(`\n    Fix by confirming a barcode once — after that the line is never guessed again.`);
  }

  if (generic.length > 0) {
    console.log(`\n  ${generic.length} generic defaults — confirm to stop them being guessed:`);
    for (const a of res.assumptions) {
      if (suspectIds.has(a.lineId)) continue;
      console.log(`    "${a.query}" → ${a.selectedName}`);
    }
  }

  if (rejected.length > 0) {
    console.log(`\n  Not offered (${rejected.length}):`);
    for (const r of rejected) console.log(`    ${r.brand} — ${r.reason}`);
  }

  // --- Persist the run -----------------------------------------------------
  if (args.save) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = resolve(ROOT, 'runs');
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${stamp}.json`);
    await writeFile(
      file,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          address: args.address,
          serviceType: args.pickup ? 'pickup' : 'delivery',
          lines,
          resolution: {
            total: lines.length,
            exact: exact.length,
            generic: generic.length,
            suspect: suspect.length,
            acceptablePct: pct,
            suspectQueries: suspect.map((l) => l.query),
          },
          assumptions: res.assumptions,
          warnings,
          rejected,
          options,
          // gtin + name per line from the best storefront, so `memory done`
          // can record what was actually bought.
          quotedLines: Object.fromEntries(
            (res.quotes.find((q) => q.storefrontId === options[0]?.legs[0]?.storefrontId)?.lines ?? [])
              .map((l) => [l.lineId, { gtin: l.gtin, productName: l.productName }]),
          ),
          provider: { id: res.providerId, latencyMs: res.latencyMs },
          raw: res.raw,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\n  saved → runs/${stamp}.json`);
  }
  console.log();
}

function printOption(
  letter: string,
  o: PurchaseOption,
  baseline: PurchaseOption | undefined,
  nameOf: (id: string) => string,
): void {
  const saving: Agorot =
    baseline && baseline !== o ? subAgorot(baseline.cashCost, o.cashCost) : agorot(0);
  console.log(`Option ${letter} — ${o.label}`);
  for (const leg of o.legs) {
    console.log(
      `  ${leg.brand.padEnd(28)} items ${formatILS(leg.itemsSubtotal).padStart(10)}` +
        `  fee ${formatILS(leg.deliveryFee).padStart(8)}  (${leg.lineIds.length} lines)`,
    );
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${formatILS(o.cashCost).padStart(16)}`);
  if (o.timeCost > 0) console.log(`  ${'time (shown separately)'.padEnd(28)} ${formatILS(o.timeCost).padStart(16)}`);
  if (o.travel) console.log(`  ${'travel'.padEnd(28)} ${o.travel.distanceKm} km · ${o.travel.roundTripMinutes} min round trip`);
  if (saving > 0) console.log(`  saves ${formatILS(saving)} vs the cheapest option`);
  else if (saving < 0) console.log(`  costs ${formatILS(agorot(-saving))} more than Option A`);
  console.log(`  coverage ${Math.round(o.coverageRatio * 100)}%  ·  ${o.substitutedLineCount} substitutions`);
  if (o.unpricedLineIds.length > 0) {
    // The whole point of the product: an item missing here is an item bought at
    // makolet prices later. Never hide it behind a coverage percentage.
    console.log(`  ⚠ not available: ${o.unpricedLineIds.map(nameOf).join(', ')}`);
  }
  console.log(`  why: ${o.explanation.reason}`);
  console.log();
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
