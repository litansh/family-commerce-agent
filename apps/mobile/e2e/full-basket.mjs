/**
 * A full basket at every store (docs/design/a-full-basket-everywhere.md; promises 1, 2, 4, 9).
 *
 * Nobody orders a partial basket, so every store that delivers must be offered with a complete one —
 * its own nearest product wherever it lacks the exact one, every alternative named, and the family's
 * exact basket priced beside it. The decisions that make that honest live in `src/lib/fullBasket.ts`;
 * this lab runs those very functions over a real compare and fails when one of them would put
 * something untrue on a phone.
 *
 *   node apps/mobile/e2e/full-basket.mjs                     (the committed capture)
 *   node apps/mobile/e2e/full-basket.mjs <compare.json>      (one already captured)
 *   node apps/mobile/e2e/full-basket.mjs --live              (capture a fresh one first)
 *
 * GET/compare only — nothing is ordered. Exit 1 on any BAD.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alternativeTo, brandOf, cardsFor, headlineOf, whereExact } from '../src/lib/fullBasket.ts';

let bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'BAD '} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) bad += 1; };
const m = (v) => (v === undefined ? '   —   ' : `₪${(v / 100).toFixed(2)}`);

let file = process.argv[2];
if (!file || file === '--live') {
  if (file === '--live') {
    file = join(mkdtempSync(join(tmpdir(), 'kaniti-compare-')), 'compare.json');
    execFileSync('node', [new URL('compare-capture.mjs', import.meta.url).pathname, file], { stdio: 'inherit' });
  } else file = new URL('lab/compare.json', import.meta.url).pathname;
}
const q = JSON.parse(readFileSync(file, 'utf8'));
const nameOf = (id) => q.lines.find((l) => l.id === id)?.query ?? id;
const cards = cardsFor(q);
console.log(`     ${q.lines.length} line(s), ${q.options.length} option(s), ${q.rejected.length} rejected, ${cards.length} card(s)\n`);

// --- The screen the family would see, printed, so the PR can be read without a simulator. ---
for (const c of cards) {
  const head = headlineOf(c, null);
  const alt = alternativeTo(c, head);
  const tail = [
    c.complete ? 'סל מלא' : `ל־${c.filled} מתוך ${c.asked}`,
    head.delivered ? '' : '+ משלוח',
    c.shortOfMinimum !== undefined ? `חסר ${m(c.shortOfMinimum)} למינימום` : '',
    c.swaps.length ? `${c.swaps.length} החלפות` : '',
    alt ? `${alt.basket.mode} ${m(alt.basket.total)}` : '',
  ].filter(Boolean).join(' · ');
  console.log(`     ${m(head.total).padStart(9)}  ${c.brand.padEnd(30)} ${tail}`);
  for (const s of c.swaps) console.log(`                ${s.asked} → ${s.got}  ${m(s.lineTotal)}  [${s.kind}${s.nowhere ? ', nowhere' : s.elsewhere ? `, at ${s.elsewhere.length}` : ''}]`);
  if (!c.complete) console.log(`                אין כאן חלופה ל: ${c.unfillableLineIds.map(nameOf).join(', ')}`);
}
console.log();

// --- Coverage is a fact on a card, never a reason to hide a store (the design's first rule). ---
const priced = Object.keys(q.storefrontLines ?? {});
check(cards.length === priced.length, 'every storefront the compare priced gets a card', `${cards.length}/${priced.length}`);
const hiddenComplete = cards.filter((c) => c.complete && !c.option);
check(true, 'stores that fill the whole basket but are not options today', hiddenComplete.length ? hiddenComplete.map((c) => `${c.brand} ${m(c.full.items)}`).join(', ') : 'none');

// --- Promise 4: no total this module invented, and no number standing beside one it is not comparable with. ---
for (const c of cards) {
  const sl = q.storefrontLines[c.storefrontId] ?? {};
  const summed = Object.values(sl).reduce((n, x) => n + (x.price ?? 0), 0);
  const engine = q.options.find((o) => o.legs.length === 1 && o.legs[0].storefrontId === c.storefrontId)?.legs[0].itemsSubtotal
    ?? q.rejected.find((r) => r.storefrontId === c.storefrontId)?.itemsSubtotal;
  if (engine === undefined) { check(c.full.items === undefined, `${c.brand}: no engine total, so no number is shown`, m(c.full.items)); continue; }
  check(c.full.items === engine, `${c.brand}: the items total is the engine's own`, `card ${m(c.full.items)} = engine ${m(engine)}`);
  if (summed !== engine) check(c.full.items !== summed, `${c.brand}: the card did not sum unit prices`, `summed ${m(summed)} ≠ engine ${m(engine)}, out by ${m(Math.abs(summed - engine))}`);
  if (c.full.total !== undefined) {
    check(c.full.delivered === (c.full.deliveryFee !== undefined || !!c.option), `${c.brand}: says whether its number includes delivery`, c.full.delivered ? `delivered ${m(c.full.total)}` : `items only ${m(c.full.total)}`);
  }
}

// --- Never a silent swap: every alternative is named next to what was asked for (the design's rule 1). ---
const allSwaps = cards.flatMap((c) => c.swaps.map((s) => ({ ...s, brand: c.brand })));
for (const s of allSwaps) {
  check(!!s.asked && !!s.got && s.asked !== s.got, `${s.brand}: the swap for "${s.asked}" is named`, s.got);
  check(s.kind === 'missing' || s.kind === 'cheaper', `${s.brand}: "${s.asked}" says which kind of swap it is`, s.kind);
  if (s.lineTotal !== undefined) check(s.lineTotal > 0, `${s.brand}: "${s.asked}" carries what that line costs`, m(s.lineTotal));
}
const substituted = Object.entries(q.storefrontLines ?? {}).flatMap(([sid, lm]) => Object.entries(lm).filter(([, x]) => x.substituted).map(([id]) => `${sid}/${id}`));
check(allSwaps.filter((s) => s.kind === 'missing').length === substituted.length, 'every substitution in the response reaches a card', `${allSwaps.length} swap(s) for ${substituted.length} substitution(s)`);

// --- A gap is only honest when it is real: a line nobody nearby has is said so, once. ---
for (const l of q.lines) {
  const where = whereExact(q, l.id);
  const swapsForLine = allSwaps.filter((s) => s.lineId === l.id);
  if (!swapsForLine.length) continue;
  if (where.length === 0) check(swapsForLine.every((s) => s.nowhere), `"${l.query}": nobody has the one they pinned, and every card says so`, `${swapsForLine.length} card(s)`);
  else check(swapsForLine.every((s) => !s.nowhere && s.elsewhere?.length), `"${l.query}": the cards name where the exact one is`, where.map((w) => w.brand).join(', '));
}

// --- A partial basket is never presented as a price (the design's rule 2). ---
for (const c of cards.filter((x) => !x.complete)) {
  check(c.unfillableLineIds.length > 0, `${c.brand}: an incomplete card names what it cannot fill`, c.unfillableLineIds.map(nameOf).join(', '));
  check(c.filled < c.asked, `${c.brand}: says how much of the list it covers`, `${c.filled}/${c.asked}`);
  check(!c.states.includes('yours') && !c.states.includes('full-with-swaps'), `${c.brand}: is not claiming a full basket`, c.states.join(','));
}

// --- The exact basket is always reachable, and never invented (the design's rule 3). ---
for (const c of cards) {
  if (c.exact?.total === undefined) {
    check(!q.storefronts?.[c.storefrontId]?.exactBasket?.total, `${c.brand}: shows no exact-basket number the engine did not give`, 'none');
    continue;
  }
  const head = headlineOf(c, null);
  const alt = alternativeTo(c, head);
  check(alt !== null && alt.basket !== head, `${c.brand}: the other basket is named beside the headline`, `${alt?.basket.mode} ${m(alt?.basket.total)} (${alt && alt.diff >= 0 ? '+' : ''}${m(Math.abs(alt?.diff ?? 0))})`);
}

// --- One headline per card, and it is cash. ---
for (const c of cards) {
  const head = headlineOf(c, null);
  const alt = alternativeTo(c, head);
  check([c.full, c.exact, c.cheap].filter((b) => b === head).length === 1, `${c.brand}: exactly one basket leads the card`, head.mode);
  check(alt === null || alt.basket !== head, `${c.brand}: the alternative is not the headline again`, alt ? alt.basket.mode : 'only one basket');
  if (c.exact?.total !== undefined && c.full.total !== undefined) {
    check(head.total <= Math.min(c.exact.total, c.full.total), `${c.brand}: the cheaper of the two baskets leads`, `${m(head.total)}`);
  }
}

// --- A minimum is a fact on the card, in shekels, not a rejection. ---
for (const r of q.rejected.filter((x) => x.code === 'minimum')) {
  const c = cards.find((x) => x.storefrontId === r.storefrontId);
  check(!!c, `${r.brand}: kept on the screen despite the minimum`);
  check(c?.shortOfMinimum === r.amountToMinimum, `${r.brand}: says how far it is from its minimum`, `${m(c?.shortOfMinimum)} of ${m(r.minimumOrder)}`);
}

// --- The order: complete baskets first, then by what is comparable between stores. ---
const firstPartial = cards.findIndex((c) => !c.complete);
const lastComplete = cards.map((c) => c.complete).lastIndexOf(true);
check(firstPartial === -1 || lastComplete < firstPartial, 'no partial basket jumps a complete one', `${cards.filter((c) => c.complete).length} complete, then ${cards.filter((c) => !c.complete).length}`);
const completeRanks = cards.filter((c) => c.complete).map((c) => c.full.items ?? Infinity);
check(completeRanks.every((v, i) => i === 0 || completeRanks[i - 1] <= v), 'the complete baskets are in price order', completeRanks.map(m).join(' ≤ '));

// --- Every row of the design's state table, and which of them this compare reaches. ---
const TABLE = ['yours', 'full-with-swaps', 'exact-cheaper', 'exact-elsewhere', 'exact-nowhere', 'cannot-fill', 'under-minimum', 'cheapened', 'cheaper-none', 'fee-unknown', 'closed', 'approx'];
const seen = [...new Set(cards.flatMap((c) => c.states))];
console.log('');
for (const s of seen) check(TABLE.includes(s), `"${s}" is a state the design drew`, cards.filter((c) => c.states.includes(s)).map((c) => c.brand).slice(0, 3).join(', '));
console.log(`     states this compare does not reach: ${TABLE.filter((s) => !seen.includes(s)).join(', ') || 'none'}`);

console.log(bad === 0 ? '\nok   the compare offers a full basket at every store it can, and invents no number' : `\nBAD  ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
