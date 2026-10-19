#!/usr/bin/env node
// Plan guard: the last check between a Terraform plan and an apply (ADR 0012).
//
//   node ops/plan-guard.mjs <plan.json> [--allow ops/plan-guard.allow] [--markdown out.md] [--self-test]
//
// <plan.json> is `terraform show -json tfplan`. Exit 0 when the plan is safe, 1 when it is not,
// 2 on bad input. Node 22, no dependencies.
//
// Rules, every one of them a reason to fail:
//   (a) the shared OIDC provider and the state bucket are never deleted (forgetting them is fine);
//   (b) nothing whose identity names the OIDC provider, a tfstate bucket, another project in this
//       account (adtech, finops) or the repo itself is deleted;
//   (c) every delete or forget carries an fca-prefixed identity, or is named in the allowlist;
//   (d) every delete or forget is named in the allowlist with the matching verb
//       (`destroy <address>` / `forget <address>`; `#` starts a comment; listed but absent is fine).
import { readFileSync, writeFileSync } from 'node:fs';

export const PROTECTED = new Set([
  'aws_iam_openid_connect_provider.github',
  'aws_s3_bucket.tfstate',
  'aws_s3_bucket_versioning.tfstate',
  'aws_s3_bucket_public_access_block.tfstate',
]);
export const FORBIDDEN_FRAGMENTS = [
  'oidc-provider/token.actions.githubusercontent.com',
  'fca-tfstate-',
  'family-commerce-agent-',
  'adtech',
  'finops',
];
const IDENTITY_KEYS = ['name', 'function_name', 'bucket', 'alarm_name', 'domain', 'arn', 'id', 'role', 'user', 'log_group_name', 'rule', 'topic_arn', 'url'];
const FCA_IDENTITY = /^fca[-_]|:fca[-_]|^\/fca\/|\/aws\/lambda\/fca-|\/fca-|user\/fca-|role\/fca-/;

function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* strings(v);
}

export function parseAllow(text) {
  const allow = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(destroy|forget)\s+(\S+)$/.exec(line);
    if (!m) throw new Error(`allowlist: cannot read line "${raw.trim()}" (expected "destroy <address>" or "forget <address>")`);
    allow.set(m[2], m[1]);
  }
  return allow;
}

function verbOf(actions) {
  if (actions.includes('forget')) return 'forget';
  if (actions.includes('delete')) return 'destroy';
  if (actions.includes('create')) return 'create';
  if (actions.includes('update')) return 'update';
  return 'no-op';
}

// Drops attributes that hold policy documents, so a reference inside them is not read as an identity.
function withoutPolicies(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !/policy|statement/i.test(k)));
}

export function evaluate(plan, allow) {
  if (!plan || !Array.isArray(plan.resource_changes)) throw new Error('plan.json has no resource_changes[]');
  const counts = { add: 0, change: 0, destroy: 0, forget: 0 };
  const rows = [];
  const reasons = [];
  for (const rc of plan.resource_changes) {
    const actions = rc.change?.actions ?? [];
    const before = rc.change?.before ?? {};
    const address = rc.address;
    if (actions.includes('create')) counts.add += 1;
    if (actions.includes('delete')) counts.destroy += 1;
    if (actions.includes('forget')) counts.forget += 1;
    if (actions.includes('update')) counts.change += 1;
    const verb = verbOf(actions);
    if (verb !== 'destroy' && verb !== 'forget') continue;

    const identity = IDENTITY_KEYS.map((k) => before?.[k]).find((v) => typeof v === 'string' && FCA_IDENTITY.test(v)) ?? '';
    const listed = allow.get(address);
    const problems = [];
    if (verb === 'destroy' && PROTECTED.has(address)) problems.push('protected address would be destroyed');
    if (verb === 'destroy') {
      // Policy documents name other resources as principals and ARNs by design (a role's trust policy
      // names the OIDC provider); only identity attributes say what the resource itself is.
      for (const s of strings(withoutPolicies(before))) {
        const hit = FORBIDDEN_FRAGMENTS.find((f) => s.includes(f));
        if (hit) { problems.push(`identity "${s}" names a kept resource (${hit})`); break; }
      }
    }
    if (!identity && listed === undefined) problems.push('no fca- identity and not in the allowlist');
    if (listed === undefined) problems.push(`not in the allowlist (add "${verb} ${address}")`);
    else if (listed !== verb) problems.push(`allowlist says "${listed}", plan says "${verb}"`);

    rows.push({ address, verb, identity, verdict: problems.length ? 'FAIL' : 'ok', problems });
    for (const p of problems) reasons.push(`${address}: ${p}`);
  }
  return { counts, rows, ok: reasons.length === 0, reasons };
}

export function render({ counts, rows, ok, reasons }) {
  const lines = [`Plan: ${counts.add} add, ${counts.change} change, ${counts.destroy} destroy, ${counts.forget} forget`, ''];
  if (rows.length) {
    lines.push('| address | verb | matched name | verdict |', '|---|---|---|---|');
    for (const r of rows) lines.push(`| \`${r.address}\` | ${r.verb} | ${r.identity ? `\`${r.identity}\`` : '—'} | ${r.verdict} |`);
    lines.push('');
  }
  lines.push(ok ? 'guard: ok' : `guard: FAIL — ${reasons.join('; ')}`);
  return lines.join('\n');
}

function selfTest() {
  const allow = parseAllow('forget aws_iam_openid_connect_provider.github\n# c\ndestroy aws_lambda_function.api\n');
  const plan = { resource_changes: [
    { address: 'aws_iam_openid_connect_provider.github', type: 'aws_iam_openid_connect_provider', change: { actions: ['forget'], before: { arn: 'arn:aws:iam::1:oidc-provider/token.actions.githubusercontent.com' } } },
    { address: 'aws_lambda_function.api', type: 'aws_lambda_function', change: { actions: ['delete'], before: { function_name: 'fca-api' } } },
  ] };
  const r = evaluate(plan, allow);
  if (!r.ok) throw new Error(`self-test: expected ok, got ${r.reasons.join('; ')}`);
  const bad = evaluate({ resource_changes: [{ address: 'aws_iam_openid_connect_provider.github', change: { actions: ['delete'], before: {} } }] }, allow);
  if (bad.ok) throw new Error('self-test: a deleted OIDC provider passed');
  return 'self-test: ok';
}

function main(argv) {
  const args = [...argv];
  if (args.includes('--self-test')) { console.log(selfTest()); return 0; }
  let allowPath, markdownPath, planPath;
  while (args.length) {
    const a = args.shift();
    if (a === '--allow') allowPath = args.shift();
    else if (a === '--markdown') markdownPath = args.shift();
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}`); return 2; }
    else planPath = a;
  }
  if (!planPath) { console.error('usage: node ops/plan-guard.mjs <plan.json> [--allow file] [--markdown out.md] [--self-test]'); return 2; }
  let plan, allow;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8'));
    allow = parseAllow(allowPath ? readFileSync(allowPath, 'utf8') : '');
  } catch (e) { console.error(`plan-guard: ${e.message}`); return 2; }
  let result;
  try { result = evaluate(plan, allow); } catch (e) { console.error(`plan-guard: ${e.message}`); return 2; }
  const md = render(result);
  if (markdownPath) writeFileSync(markdownPath, md + '\n');
  console.log(md);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.exit(main(process.argv.slice(2)));
