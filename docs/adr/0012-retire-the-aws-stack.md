# ADR 0012 — Retire the AWS stack

**Status:** accepted (owner, 19 October 2026).

## Context
Kaniti ran on one AWS account: a Cognito user pool, one DynamoDB table, an HTTP API in front of the
`fca-api` Lambda, the `fca-branch-prices` refresher on a nightly schedule, the `fca-alerts` Lambda on
an SNS topic, a CloudFront distribution over the `fca-web-4b19ec` bucket for the web build, an SQS
queue for orders, CloudWatch alarms, and three GitHub OIDC roles (deploy, review, terraform). The
state lived in `fca-tfstate-437075214009`; a merge to main deployed the Lambdas and applied the plan.

Three facts decided it:

- **The funnel never reached its end.** The product's promise is to *finish the shop*
  (`docs/WHAT-WE-PROMISE.md`). Families compared baskets and connected stores; no purchase was ever
  confirmed against a store's own order state (promise 9). Everything after compare stayed a ladder
  of rungs that was proven in labs, not in a family's kitchen.
- **The ops loop stalled for twelve days on the laptop side.** From 2026-10-04 the ops Mac's AWS
  session was expired and the machine slept through its launchd window (`ops/NEEDS-HUMAN.md`); the
  checks ran without the data rungs they feed, and the deals and branch rows aged out. Every repair
  needed the owner, which is the one thing the loop was built to avoid.
- **Cost against value.** The stack is serverless and nearly free when idle, but it is not free to
  keep honest: alarms, a nightly refresher, a public API with a user pool and sealed store sessions,
  three roles and an agent fleet reviewing pull requests against a product nobody is buying through.
  A live stack that nobody watches is a liability, not an asset.

## Decision
**Tear the AWS stack down, through pull requests, the same way it was built.** Nobody runs
`terraform destroy` from a laptop; each step is a plan commented on a pull request and applied from
main, and every plan passes `ops/plan-guard.mjs` (`ops/plan-guard.allow` names each destroy and
forget; the guard refuses anything else).

1. **Prepare** — the two non-empty buckets get `force_destroy`; the shared OIDC provider and the
   state bucket leave the state through `removed` blocks (`destroy = false`); the account id is
   hard-coded so no repository secret is load-bearing; the guard is wired into plan and apply.
2. **Tear down** — every resource except the terraform role and its policy is destroyed.
3. **Forget the role** — `aws_iam_role.github_terraform` and its policy leave the state; the apply
   that forgets them is the last apply.
4. **Close** — the workflow is removed, the secrets are deleted by hand.

What is kept: the repository (public, with the tag `last-live` on the last commit that ran), the
GitHub OIDC provider `token.actions.githubusercontent.com` (shared with adtech-lab and
shamir-finops-hub in the same account; this stack created it but it is not this stack's to delete),
the state bucket `fca-tfstate-437075214009` (its versions are purged by hand because they hold the
worker's access key and the Telegram token), and the bootstrap stack
(`infrastructure/terraform/bootstrap`: the account budget).

**Data loss is accepted.** The table, the sealed store sessions, the cached catalogue, the price
indexes and the user pool are deleted with the stack. There is no backup and there is no need for
one: nothing in them is a family's credential (ADR 0008), and the public price data is rebuilt from
the chains' files.

The terraform role is the last thing out, and by hand: an apply cannot delete the role it is
running as, so `fca-github-terraform` is forgotten by the stack and deleted by the owner with the
AWS CLI.

## Consequences
- The phone app, `ops/*.mjs` and the e2e scripts point at endpoints that no longer answer
  (`apps/mobile/src/lib/config.ts`, `apps/mobile/app.json`, `apps/mobile/e2e`). They stay in the
  tree as the record of what ran; a rebuild changes the values, not the shape.
- The promises in `docs/WHAT-WE-PROMISE.md` are **suspended, not weakened**: no check is edited to
  pass against a dead API, and no promise is reworded. A retired product keeps none of them and
  breaks none of them.
- `ops/repair.sh` and the launchd job have nothing to repair; the launchd job is removed.
- The rebuild path is the tag `last-live`: `git checkout last-live`, the bootstrap stack, one local
  apply to recreate the terraform role (the OIDC provider and the state bucket are already there),
  then the workflows take over as before.
- Until PR 4 merges, the `terraform` workflow stays and applies only guarded plans; the deploy and
  logs workflows go with the Lambdas they served.
