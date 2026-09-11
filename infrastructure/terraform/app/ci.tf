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
