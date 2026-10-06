/**
 * The compare is accurate (docs/design/compare-accuracy.md; promises 2, 3, 4, 9).
 *
 * "איך לקנות" is the screen the whole product is for, and every number on it must be one the family
 * could recompute from the same response — with nothing standing beside a number it is not comparable
 * with. The screen's decisions live in `src/lib/compare.ts`; this lab runs those very functions over a
 * real compare for the test family and fails when one of them would put something untrue on a phone.
 *
 *   node apps/mobile/e2e/compare-accuracy.mjs                 (capture a fresh compare, then check it)
 *   node apps/mobile/e2e/compare-accuracy.mjs <compare.json>   (check one already captured)
 *
 * GET/compare only — nothing is ordered. Exit 1 on any BAD.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completedTotal, etaRank, etaTone, exceptionsOf, exceptionsOfStore, isComplete, opensAt, rowsFor, savingOf } from '../src/lib/compare.ts';

let bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'BAD '} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) bad += 1; };

let file = process.argv[2];
if (!file) {
  file = join(mkdtempSync(join(tmpdir(), 'kaniti-compare-')), 'compare.json');
  execFileSync('node', [new URL('compare-capture.mjs', import.meta.url).pathname, file], { stdio: 'inherit' });
}
const q = JSON.parse(readFileSync(file, 'utf8'));
const nameOf = (id) => q.lines.find((l) => l.id === id)?.query ?? id;
const brandOf = (o) => o.legs.map((l) => l.brand).join(' + ');
console.log(`     ${q.lines.length} line(s), ${q.options.length} option(s), ${q.rejected.length} rejected store(s)\n`);

// --- Promise 2: a store that is shut is never offered as one that delivers, and never ranks first. ---
const etas = Object.entries(q.etas ?? {});
const closed = etas.filter(([, e]) => e.kind === 'closed');
const open = etas.filter(([, e]) => e.kind !== 'closed');
for (const [sid, e] of closed) {
  check(etaTone(e) === 'warn', `${sid} is shut and says so`, `tone=${etaTone(e)}, "${e.text ?? opensAt(e) ?? ''}"`);
  const jumped = open.filter(([, o]) => etaRank(e) <= etaRank(o)).map(([s]) => s);
  check(jumped.length === 0, `${sid} is shut and ranks after every open store`, jumped.length ? `ranks at or before ${jumped.join(', ')}` : `${etaRank(e)} min`);
}
check(true, `${closed.length} shut storefront(s), ${open.length} open`);
// The fastest single delivery the screen would offer may not be a shut one.
const oneDelivery = q.options.filter((o) => o.legs.length === 1 && o.kind !== 'pickup' && o.kind !== 'drive');
const fastest = [...oneDelivery].sort((a, b) => Math.max(...a.legs.map((l) => etaRank(q.etas?.[l.storefrontId]))) - Math.max(...b.legs.map((l) => etaRank(q.etas?.[l.storefrontId]))) || a.cashCost - b.cashCost)[0];
if (fastest) check(q.etas?.[fastest.legs[0].storefrontId]?.kind !== 'closed', '"הכי מהר" does not name a shut store', brandOf(fastest));

// --- Promise 2: the answer states its difference in money. ---
const answer = q.options[0];
if (!answer) { check(false, 'there is an answer to show'); }
else {
  const saving = savingOf(q, answer);
  const others = q.options.filter((o) => o !== answer && o.kind !== 'drive');
  check(saving !== null || others.length === 0, 'the answer names a figure, or there is genuinely no alternative', saving ? `${(saving.minor / 100).toFixed(2)} vs ${saving.brand}${saving.approx ? ' (≈, completed)' : ''}` : `${others.length} alternative(s) and no figure`);
  if (saving) {
    const yard = others.find((o) => brandOf(o) === saving.brand);
    check(!!yard, 'the figure names a store that is on this compare', saving.brand);
    if (yard) {
      const want = (saving.approx ? completedTotal(yard) : yard.cashCost) - answer.cashCost;
      check(want === saving.minor, 'the figure can be recomputed from the response', `${(want / 100).toFixed(2)} = ${(saving.approx ? completedTotal(yard) : yard.cashCost) / 100} − ${answer.cashCost / 100}`);
      check(saving.approx === !isComplete(yard), 'the figure is marked approximate exactly when it rests on an estimate', `approx=${saving.approx}, yardstick complete=${isComplete(yard)}`);
    }
  }
}

// --- Promises 3 and 4: every row tells the truth about its own option. ---
const rows = rowsFor(q, answer);
check(rows.length === q.options.filter((o) => o !== answer && o.kind !== 'drive').length + q.rejected.length, 'every store reaches the screen, as a row or as the answer', `${rows.length} row(s)`);
for (const row of rows) {
  const where = `${row.brands.map((b) => b.brand).join(' + ')}`;
  // 4: a number in the price column either is a delivered total or says it is not.
  if (!row.deliveredTotal) check(row.pricedLines !== undefined, `${where}: an items-only number says how many lines it covers`, `${row.pricedLines}/${q.lines.length}`);
  // 4: a partial basket is never set beside a full one without its completed total.
  if (row.missingLineIds.length && row.option) {
    check(row.completed !== undefined, `${where}: an incomplete option carries its completed total`, row.completed !== undefined ? `${(row.price / 100).toFixed(2)} → ${(row.completed / 100).toFixed(2)}` : `missing ${row.missingLineIds.map(nameOf).join(', ')}`);
    if (row.completed !== undefined) check(row.completed === row.price + (row.option.missingEstimate ?? 0) && row.approx, `${where}: the completed total is recomputable and marked ≈`);
  }
  // 4: the difference from the answer is computed on the completed totals of both, never on a partial.
  if (row.moreThanAnswer !== undefined && answer) {
    check(row.moreThanAnswer === (row.completed ?? row.price) - answer.cashCost, `${where}: "+₪" is the completed difference`, `+${(row.moreThanAnswer / 100).toFixed(2)}`);
  }
  // 3 and 4: the row's missing lines are its option's own, not one leg's line map.
  if (row.option) {
    const legLines = new Set(row.option.legs.flatMap((l) => l.lineIds));
    check(row.missingLineIds.every((id) => !legLines.has(id)), `${where}: nothing it buys is called missing`, row.missingLineIds.map(nameOf).join(', ') || 'nothing missing');
    check(row.missingLineIds.length + legLines.size === q.lines.length, `${where}: every line is either bought or named missing`, `${legLines.size} bought + ${row.missingLineIds.length} missing of ${q.lines.length}`);
    // A swap may only be named on the leg that actually buys that line.
    for (const sw of row.swaps) {
      const leg = row.option.legs.find((l) => l.storefrontId === sw.storefrontId);
      check(!!leg && leg.lineIds.includes(sw.lineId), `${where}: the swap for "${nameOf(sw.lineId)}" is named on the leg that buys it`, sw.productName);
    }
  }
  // Promise 1: every leg of a row can be unfolded to its own store's own products.
  for (const b of row.brands) {
    const sl = q.storefrontLines?.[b.storefrontId] ?? {};
    const named = b.lineIds.filter((id) => sl[id]).length;
    if (row.option) check(named === b.lineIds.length, `${where}: ${b.brand} names its own product for every line it buys`, `${named}/${b.lineIds.length}`);
  }
}

// --- The answer card itself obeys the same rules as a row. ---
if (answer) {
  const ex = exceptionsOf(q, answer);
  const legLines = new Set(answer.legs.flatMap((l) => l.lineIds));
  check(ex.missingLineIds.every((id) => !legLines.has(id)), 'the answer calls nothing it buys missing', ex.missingLineIds.map(nameOf).join(', ') || 'nothing missing');
  for (const sw of ex.swaps) {
    const leg = answer.legs.find((l) => l.storefrontId === sw.storefrontId);
    check(!!leg && leg.lineIds.includes(sw.lineId), `the answer's swap for "${nameOf(sw.lineId)}" is named on the leg that buys it`, sw.productName);
  }
  check(answer.legs.reduce((n, l) => n + l.itemsSubtotal + l.deliveryFee, 0) === answer.cashCost, "the answer's cash is its legs' items + fees", `${(answer.cashCost / 100).toFixed(2)}`);
}

// --- Nothing internal reaches the screen: a rejected store is still a store with a name and a number. ---
for (const r of q.rejected) {
  const ex = exceptionsOfStore(q, r.storefrontId);
  check(r.brand && !/^[a-z0-9-]+$/.test(r.brand), `rejected ${r.storefrontId} has a name a person reads`, r.brand);
  check(ex.missingLineIds.length === q.lines.length - r.pricedLines, `rejected ${r.brand}: the lines it lacks are named, not counted`, ex.missingLineIds.map(nameOf).join(', ') || 'none');
}

console.log(bad ? `\nBAD  ${bad} rule(s) the compare screen would break on a real phone` : '\nok   every number on the compare can be recomputed from the response');
process.exit(bad ? 1 : 0);
