#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ListLine } from '@fca/domain';
import { printChoice, resolveList } from './resolve.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const listPath = get('--list');
  const location = get('--address');
  if (!listPath || !location) {
    console.error('usage: npm run resolve -- --list <file.json> --address "<address>"');
    process.exit(2);
  }

  const raw = JSON.parse(await readFile(resolve(ROOT, listPath), 'utf8')) as {
    lines: Omit<ListLine, 'id'>[];
  };
  const lines: ListLine[] = raw.lines.map((l, i) => ({ id: `l${i}`, ...l }));

  console.log(`\nResolving ${lines.length} lines near ${location}…`);
  console.log('  ✓ = brand you asked for   ↓ = cheaper per unit   ↑ = dearer per unit\n');

  const choices = await resolveList(lines, location);
  for (const line of lines) printChoice(choices.get(line.id), line);

  // --- What choosing differently would be worth ----------------------------
  let cheaperCount = 0;
  for (const line of lines) {
    const c = choices.get(line.id);
    const best = c?.alternatives[0];
    if (best !== undefined && (best.percentDelta ?? 0) > 0) cheaperCount += 1;
  }

  const resolved = [...choices.values()].filter((c) => c !== undefined).length;
  const branded = lines.filter((l) => l.brand !== undefined).length;
  const honoured = lines.filter((l) => choices.get(l.id)?.brandHonoured === true).length;

  console.log('\n' + '─'.repeat(70));
  console.log(`RESOLVED   ${resolved}/${lines.length} lines`);
  if (branded > 0) console.log(`BRANDS     ${honoured}/${branded} brand requests honoured`);
  console.log(`CHEAPER    ${cheaperCount} lines have a cheaper-per-unit alternative on offer`);

  const out = resolve(ROOT, 'runs', `resolve-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(
    out,
    JSON.stringify(
      { at: new Date().toISOString(), location, choices: [...choices.entries()] },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n  saved → runs/${out.split('/').pop()}\n`);
}

main().catch((e: unknown) => {
  console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
