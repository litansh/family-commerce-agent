# What the retirement leaves (ADR 0012): the OIDC trust and the role that applies this stack.
# The deploy and review roles went with the Lambdas and the review key; this role is forgotten
# in the next pull request and deleted by the owner.

# The OIDC provider is shared with adtech-lab and shamir-finops-hub in this account: this stack
# created it, but it is not this stack's to delete. Read, never managed (ADR 0012).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

removed {
  from = aws_iam_openid_connect_provider.github
  lifecycle { destroy = false }
}

variable "github_repo" {
  type    = string
  default = "litansh/family-commerce-agent"
}

# GitHub signs this account's tokens with the immutable subject format:
#   repo:litansh@<owner id>/family-commerce-agent@<repo id>:ref:refs/heads/main
# (see `gh api repos/<repo>/actions/oidc/customization/sub`). Trust policies must match that,
# not the plain "repo:owner/name" form, or every assume-role is "Not authorized".
variable "github_owner_id" {
  type    = string
  default = "54744736"
}
variable "github_repo_id" {
  type    = string
  default = "1358500626"
}
variable "github_owner" {
  type    = string
  default = "litansh"
}
# The exact shape adtech-lab's working roles use in this account: repo:<owner>@<owner id>/*@<repo id>:...
locals {
  github_sub_any  = "repo:${var.github_owner}@${var.github_owner_id}/*@${var.github_repo_id}:*"
  github_sub_main = "repo:${var.github_owner}@${var.github_owner_id}/*@${var.github_repo_id}:ref:refs/heads/main"
}

# ---------------------------------------------------------------------------
# Terraform from GitHub Actions: state in S3, a role that applies this stack.
#
# The broad one, and honest about why: Terraform creates IAM roles, so this credential can
# create IAM roles. Every action is scoped to this project's names (fca-*) where the service
# supports it; PassRole only to fca-* roles. The real controls: a plan runs on pull requests
# (a read), an apply runs only from main after the PR was approved and merged.
# ---------------------------------------------------------------------------
data "aws_caller_identity" "me" {}

# The state bucket holds this stack's own state and outlives it (ADR 0012): forgotten here,
# never destroyed. backend.tf names it.
locals {
  tfstate_bucket_arn = "arn:aws:s3:::${var.name}-tfstate-${data.aws_caller_identity.me.account_id}"
}

removed {
  from = aws_s3_bucket.tfstate
  lifecycle { destroy = false }
}

removed {
  from = aws_s3_bucket_versioning.tfstate
  lifecycle { destroy = false }
}

removed {
  from = aws_s3_bucket_public_access_block.tfstate
  lifecycle { destroy = false }
}

resource "aws_iam_role" "github_terraform" {
  name                 = "${var.name}-github-terraform"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = local.github_sub_any }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_terraform" {
  name = "${var.name}-github-terraform"
  role = aws_iam_role.github_terraform.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "State", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], Resource = [local.tfstate_bucket_arn, "${local.tfstate_bucket_arn}/*"] },
      { Sid = "ProjectBuckets", Effect = "Allow", Action = ["s3:*"], Resource = ["arn:aws:s3:::${var.name}-*", "arn:aws:s3:::${var.name}-*/*"] },
      { Sid = "ProjectNamed", Effect = "Allow", Action = ["lambda:*", "dynamodb:*", "sqs:*", "sns:*", "events:*", "logs:*", "ssm:*", "iam:*Role*", "iam:*Policy*", "iam:*User*", "iam:*AccessKey*", "iam:PassRole"], Resource = [
        "arn:aws:lambda:${var.region}:*:function:${var.name}-*", "arn:aws:lambda:${var.region}:*:event-source-mapping:*",
        "arn:aws:dynamodb:${var.region}:*:table/${var.name}-*", "arn:aws:sqs:${var.region}:*:${var.name}-*", "arn:aws:sns:${var.region}:*:${var.name}-*",
        "arn:aws:events:${var.region}:*:rule/${var.name}-*", "arn:aws:logs:${var.region}:*:log-group:/aws/lambda/${var.name}-*", "arn:aws:logs:${var.region}:*:log-group:/aws/lambda/${var.name}-*:*",
        "arn:aws:ssm:${var.region}:*:parameter/${var.name}/*", "arn:aws:iam::*:role/${var.name}-*", "arn:aws:iam::*:user/${var.name}-*", "arn:aws:iam::*:policy/${var.name}-*", "arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com"
      ] },
      # Services whose ARNs carry no project name: the stack's API, user pool, CDN, alarms, budgets.
      { Sid = "ProjectServices", Effect = "Allow", Action = ["apigateway:*", "cognito-idp:*", "cloudfront:*", "acm:*", "cloudwatch:*", "budgets:*", "route53:*", "sts:GetCallerIdentity", "iam:GetOpenIDConnectProvider", "iam:ListOpenIDConnectProviders", "iam:CreateOpenIDConnectProvider", "iam:TagOpenIDConnectProvider", "s3:ListAllMyBuckets", "lambda:ListFunctions", "lambda:GetEventSourceMapping", "lambda:CreateEventSourceMapping", "lambda:DeleteEventSourceMapping", "lambda:UpdateEventSourceMapping", "logs:DescribeLogGroups", "ssm:DescribeParameters", "sqs:ListQueues", "sns:ListTopics", "events:ListRules", "dynamodb:ListTables", "cognito-identity:*"], Resource = "*" },
    ]
  })
}

output "github_terraform_role_arn" { value = aws_iam_role.github_terraform.arn }
