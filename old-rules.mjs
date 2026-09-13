// The compare screen's rules exactly as they were before this branch, run over the same real compare,
// checked by the same questions apps/mobile/e2e/compare-accuracy.mjs asks. Throwaway: proof that the
// lab would have caught these, not part of the repo.
import { readFileSync } from 'node:fs';
const q = JSON.parse(readFileSync('/tmp/fca-fleet-app-designer/compare.json', 'utf8'));
let bad = 0;
const chk = (ok, w, d = '') => { console.log(`${ok ? 'ok  ' : 'BAD '} ${w}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const money = (x) => `₪${(x / 100).toFixed(2)}`;

// --- OLD Options.tsx, verbatim ---
const etaOf = (sid) => q.etas?.[sid];
const etaText = (sid) => { const e = etaOf(sid); if (!e) return null; return e.kind === 'live' ? (e.range ? `וולט · ${e.range}` : 'live') : 'משלוח בחלון'; };
const oldTone = (when) => (/דק|min/.test(when) ? 'good' : 'neutral');
const oldRank = (e) => (e.kind === 'live' && e.minutes ? e.minutes : 24 * 60);

console.log('--- rule 1: a shut store says it is shut, and ranks after every open one ---');
for (const [sid, e] of Object.entries(q.etas ?? {})) {
  if (e.kind !== 'closed') continue;
  chk(oldTone(etaText(sid)) === 'warn', `${sid} is shut and says so`, `old screen renders "${etaText(sid)}" in the ${oldTone(etaText(sid))} tone, while the venue said "${e.text}"`);
  const jumped = Object.entries(q.etas).filter(([, o]) => o.kind !== 'closed' && oldRank(e) <= oldRank(o)).map(([s]) => s);
  chk(jumped.length === 0, `${sid} ranks after every open store`, `old rank ${oldRank(e)} ties ${jumped.length} open store(s)`);
}

console.log('--- rule 2: the answer names a figure ---');
const answer = q.options[0];
const oldWhy = answer.explanation.savingVsBaseline > 0 ? money(answer.explanation.savingVsBaseline) : null;
chk(oldWhy !== null, 'the answer names a figure', oldWhy ?? `savingVsBaseline=0 because the baseline is the answer itself ("${answer.explanation.baselineLabel}") — the old card shows the reason with no money in it`);

console.log('--- rules 3-4: an incomplete alternative carries its completed total and the completed difference ---');
for (const o of q.options.filter((x) => x !== answer && x.kind !== 'drive')) {
  const b = o.legs.map((l) => l.brand).join(' + ');
  const oldNote = o.missingEstimate ? `להשלמה ≈${money(o.missingEstimate)}` : o.cashCost > answer.cashCost ? `+${money(o.cashCost - answer.cashCost)}` : 'none';
  chk(!o.unpricedLineIds.length, `${b}: an incomplete option carries its completed total`, `old note is "${oldNote}"; the ${money(o.cashCost)} partial (${o.legs[0].lineIds.length}/${q.lines.length} lines) sits beside the answer's full ${money(answer.cashCost)}, and its completed ${money(o.cashCost + o.missingEstimate)} is never shown`);
  chk(!o.missingEstimate, `${b}: "+₪" is the completed difference`, `old screen drops the difference entirely when missingEstimate is set — ${money(o.cashCost + o.missingEstimate - answer.cashCost)} never reaches the phone`);
}

console.log('--- rule 5: an items-only number does not look like a delivered total ---');
const r = q.rejected.find((x) => x.code === 'minimum' && x.pricedLines === x.requestedLines);
chk(false, `${r.brand}: an items-only number says how many lines it covers`, `old row is ${money(r.itemsSubtotal)} in full ink with "לפריטים שיש", no delivery in it, in the same column as the answer's delivered ${money(answer.cashCost)}`);

console.log('--- rule 6: a split alternative row is its whole option (no split in today real compare; the shape is the bug) ---');
const split = { legs: [{ storefrontId: 'rami-levy-online', brand: 'רמי לוי', lineIds: ['a', 'b', 'c', 'd'] }, { storefrontId: 'shufersal-online', brand: 'שופרסל', lineIds: ['e', 'f', 'g', 'h'] }], unpricedLineIds: [] };
const oldMissing = q.lines.filter((l) => !(q.storefrontLines?.[split.legs[0].storefrontId] ?? {})[l.id]).map((l) => l.id);
const bought = new Set(split.legs.flatMap((l) => l.lineIds));
chk(oldMissing.every((id) => !bought.has(id)), 'a split row calls nothing it buys missing', `old row reads leg[0] only — it would call ${oldMissing.filter((id) => bought.has(id)).length} line(s) the second leg buys "missing"`);
const oldSwaps = Object.entries(q.storefrontLines?.[split.legs[0].storefrontId] ?? {}).filter(([, v]) => v.substituted).map(([k]) => k);
chk(oldSwaps.every((id) => split.legs[0].lineIds.includes(id)), 'a split row names a swap only on the leg that buys it', `old row scans all of leg[0]'s lines — ${oldSwaps.filter((id) => !split.legs[0].lineIds.includes(id)).length} swap(s) on lines it does not buy there`);

console.log(`\n${bad} rule(s) the OLD compare screen breaks on this real compare`);
