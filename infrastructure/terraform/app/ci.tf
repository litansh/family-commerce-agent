# Continuous deployment from GitHub Actions, with no long-lived keys: the workflow on `main`
# assumes this role through GitHub's OIDC provider and may only update the three Lambdas'
# code. Everything else (IAM, tables, buckets, schedules) stays with terraform apply.

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

variable "github_repo" {
  type    = string
  default = "litansh/family-commerce-agent"
}

resource "aws_iam_role" "github_deploy" {
  name = "${var.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "${var.name}-github-deploy"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
      Resource = [aws_lambda_function.api.arn, aws_lambda_function.refresh.arn, aws_lambda_function.alerts.arn]
    }]
  })
}

output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }

# ---------------------------------------------------------------------------
# Terraform from GitHub Actions: state in S3, a role that applies this stack.
#
# The broad one, and honest about why: Terraform creates IAM roles, so this credential can
# create IAM roles. Every action is scoped to this project's names (fca-*) where the service
# supports it; PassRole only to fca-* roles. The real controls: a plan runs on pull requests
# (a read), an apply runs only from main after the PR was approved and merged.
# ---------------------------------------------------------------------------
data "aws_caller_identity" "me" {}

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.name}-tfstate-${data.aws_caller_identity.me.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role" "github_terraform" {
  name                 = "${var.name}-github-terraform"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*" }
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
      { Sid = "State", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], Resource = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"] },
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
