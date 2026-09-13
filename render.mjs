// The screen's own composition over the real compare, so the design note's mockup is real numbers.
import { readFileSync } from 'node:fs';
import { etaTone, exceptionsOf, opensAt, rowsFor, savingOf } from '/private/tmp/fca-fleet-app-designer/apps/mobile/src/lib/compare.ts';
const q = JSON.parse(readFileSync('/tmp/fca-fleet-app-designer/compare.json', 'utf8'));
const money = (x) => `₪${(x / 100).toFixed(2)}`;
const nameOf = (id) => q.lines.find((l) => l.id === id)?.query ?? id;
const shortName = (x) => (x.length > 28 ? x.slice(0, 27) + '…' : x);
const etaText = (sid) => { const e = q.etas?.[sid]; if (!e) return null; if (e.kind === 'live') return e.range ? `וולט · ${e.range} דק׳` : `וולט · ~${e.minutes} דק׳`; if (e.kind === 'closed') return e.text ?? (opensAt(e) ? `סגור · נפתח ב־${opensAt(e)}` : 'סגור עכשיו'); return 'משלוח בחלון'; };

const answer = q.options[0];
const vs = savingOf(q, answer);
const ex = exceptionsOf(q, answer);
console.log('=== THE ANSWER CARD ===');
console.log(`[הכי זול] ${answer.legs.map((l) => l.brand).join(' + ')}    ${money(answer.cashCost)}`);
console.log(`  ${answer.legs.map((l) => etaText(l.storefrontId)).join(' · ')}`);
console.log(`  ${vs ? (vs.approx ? `חוסך ≈${money(vs.minor)} לעומת ${vs.brand} עם השלמה` : `חוסך ${money(vs.minor)} לעומת הכל ב${vs.brand}`) : '—'}`);
if (ex.swaps.length) console.log(`  חלופה: ${ex.swaps.map((s) => s.reason ?? s.productName).join(' · ')}`);
console.log(`  ▸ ${answer.legs.map((l) => `${l.lineIds.length} פריטים ב${l.brand}`).join(' · ')}`);

console.log('\n=== עוד דרכים לקנות ===');
for (const r of rowsFor(q, answer)) {
  const note = [
    r.completed !== undefined ? `≈${money(r.completed)} כולל השלמה` : null,
    r.moreThanAnswer !== undefined ? `+${money(r.moreThanAnswer)}` : null,
    r.deliveredTotal ? null : `ל־${r.pricedLines} פריטים, בלי משלוח`,
  ].filter(Boolean).join(' · ');
  const second = [
    r.shortOfMinimum !== undefined ? `חסרים ${money(r.shortOfMinimum)} למינימום הזמנה` : null,
    r.missingLineIds.length ? `חסר: ${r.missingLineIds.slice(0, 3).map((i) => shortName(nameOf(i))).join(', ')}${r.missingLineIds.length > 3 ? '…' : ''}` : null,
    r.swaps.length ? `חלופה: ${r.swaps.slice(0, 2).map((s) => s.reason ?? s.productName).join(' · ')}` : null,
  ].filter(Boolean).join(' · ');
  const tone = { good: '✓', warn: '!', neutral: ' ' }[etaTone(q.etas?.[r.storefrontId])];
  console.log(`${r.deliveredTotal ? ' ' : '·'} ${r.brands.map((b) => b.brand).join(' + ')}  [${tone}${etaText(r.storefrontId) ?? ''}]   ${money(r.price)}${note ? `  (${note})` : ''}`);
  if (second) console.log(`    ${second}`);
}
