import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseAllow, render } from '../plan-guard.mjs';

const OIDC_ARN = 'arn:aws:iam::437075214009:oidc-provider/token.actions.githubusercontent.com';
const change = (address, actions, before) => ({ address, type: address.split('.')[0], change: { actions, before } });
const plan = (...changes) => ({ resource_changes: changes });
const allow = parseAllow(`
  # retirement allowlist
  forget aws_iam_openid_connect_provider.github
  destroy aws_lambda_function.api
`);

test('deleting the OIDC provider fails even when the allowlist says forget', () => {
  const r = evaluate(plan(change('aws_iam_openid_connect_provider.github', ['delete'], { arn: OIDC_ARN, url: 'https://token.actions.githubusercontent.com' })), allow);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('\n'), /protected address would be destroyed/);
  assert.match(render(r), /^guard: FAIL/m);
});

test('forgetting the OIDC provider passes when the allowlist says forget', () => {
  const r = evaluate(plan(change('aws_iam_openid_connect_provider.github', ['forget'], { arn: OIDC_ARN })), allow);
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.counts.forget, 1);
  assert.equal(r.counts.destroy, 0);
  assert.match(render(r), /^guard: ok$/m);
});

test("deleting another project's bucket fails", () => {
  const strict = parseAllow('destroy aws_s3_bucket.other\n');
  const r = evaluate(plan(change('aws_s3_bucket.other', ['delete'], { bucket: 'adtech-lab-artifacts-437075214009', arn: 'arn:aws:s3:::adtech-lab-artifacts-437075214009' })), strict);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('\n'), /names a kept resource \(adtech\)/);
});

test('a destroy that is not in the allowlist fails', () => {
  const r = evaluate(plan(change('aws_dynamodb_table.main', ['delete'], { name: 'fca-main', arn: 'arn:aws:dynamodb:eu-central-1:1:table/fca-main' })), allow);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('\n'), /not in the allowlist \(add "destroy aws_dynamodb_table.main"\)/);
});

test('an allowed fca- destroy passes, and the counts and table are right', () => {
  const r = evaluate(plan(
    change('aws_lambda_function.api', ['delete'], { function_name: 'fca-api', arn: 'arn:aws:lambda:eu-central-1:1:function:fca-api' }),
    change('aws_s3_bucket.web', ['update'], { bucket: 'fca-web-4b19ec' }),
    change('aws_sns_topic.new', ['create'], null),
  ), allow);
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.deepEqual(r.counts, { add: 1, change: 1, destroy: 1, forget: 0 });
  const md = render(r);
  assert.match(md, /^Plan: 1 add, 1 change, 1 destroy, 0 forget$/m);
  assert.match(md, /\| `aws_lambda_function.api` \| destroy \| `fca-api` \| ok \|/);
});

test('an allowlist line with the wrong verb fails', () => {
  const r = evaluate(plan(change('aws_lambda_function.api', ['forget'], { function_name: 'fca-api' })), allow);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('\n'), /allowlist says "destroy", plan says "forget"/);
});

test('a malformed allowlist line is rejected', () => {
  assert.throws(() => parseAllow('delete aws_lambda_function.api\n'), /cannot read line/);
});
