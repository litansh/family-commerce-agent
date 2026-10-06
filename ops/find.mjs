/**
 * Retrieval for the agents: which files (and which lines in them) speak about a question.
 *
 *   node ops/find.mjs "store session cookies capture rami levy"        (top 8 files, 3 lines each)
 *   node ops/find.mjs -n 15 "delivery slots chain"                      (more files)
 *
 * A tiny tf-idf over the repo's own text (docs, charters, ops, source, tests) - no model, no key, no
 * network. An agent asks this first and then reads only the files it names, instead of walking
 * directories and reading whole screens: that walk is what emptied the session's usage budget.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ROOTS = ['docs', '.claude/agents', 'ops', 'CLAUDE.md', 'apps/api/src', 'apps/mobile/src', 'apps/mobile/e2e', 'apps/mobile/maestro', 'services', 'packages', 'infrastructure/terraform/app', '.github/workflows'];
const SKIP = /node_modules|\/dist\/|dist-types|\.tsbuildinfo|\.png$|\.jpg$|\.lock$|package-lock|\/shots\//;
const EXT = /\.(md|ts|tsx|mjs|js|sh|yml|yaml|tf|json)$/;

const args = process.argv.slice(2);
let top = 8;
const ni = args.indexOf('-n');
if (ni >= 0) { top = Number(args[ni + 1]) || 8; args.splice(ni, 2); }
const question = args.join(' ').trim();
if (!question) { console.error('usage: node ops/find.mjs [-n files] "<words>"'); process.exit(2); }

const tokens = (s) => (s.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []);
// A crude stem so "sessions" finds "session" and "connected" finds "connect".
const stem = (w) => w.replace(/(ings?|ed|es|s|ים|ות|ה)$/u, '');
const q = [...new Set(tokens(question).map(stem))];

const files = [];
const walk = (p) => {
  let st; try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) { for (const e of readdirSync(p)) { const f = join(p, e); if (!SKIP.test(f)) walk(f); } return; }
  if (EXT.test(p) && !SKIP.test(p) && st.size < 400_000) files.push(p);
};
for (const r of ROOTS) walk(join(ROOT, r));

const df = new Map();
const docs = files.map((f) => {
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');
  const tf = new Map();
  for (const w of tokens(text).map(stem)) tf.set(w, (tf.get(w) ?? 0) + 1);
  for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  return { f, lines, tf, len: Math.max(50, tokens(text).length) };
});
const N = docs.length;
const idf = (w) => Math.log(1 + N / (1 + (df.get(w) ?? 0)));
const scored = docs
  .map((d) => {
    let score = 0;
    const hits = [];
    for (const w of q) { const c = d.tf.get(w) ?? 0; if (c) { hits.push(w); score += (1 + Math.log(c)) * idf(w) / Math.log(d.len); } }
    // Files that carry more of the question's words rank above one word repeated.
    score *= hits.length / q.length;
    return { d, score, hits };
  })
  .filter((s) => s.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, top);

if (scored.length === 0) { console.log(`nothing in the repo speaks of: ${question}`); process.exit(0); }
for (const { d, hits } of scored) {
  const rel = relative(ROOT, d.f);
  const best = d.lines
    .map((l, i) => ({ i, l, n: q.filter((w) => tokens(l).map(stem).includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i);
  console.log(`\n${rel}  (${hits.join(', ')})`);
  for (const b of best) console.log(`  ${String(b.i + 1).padStart(4)}: ${b.l.trim().slice(0, 140)}`);
}
