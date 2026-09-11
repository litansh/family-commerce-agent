# In-store prices ("and if we drive there?"): a refresher Lambda reads the
# chains' published price files for the branches near each household and keeps
# a small per-branch barcode index in S3. Nightly, and on demand from the API.

resource "aws_s3_bucket" "branch_prices" {
  bucket = "${var.name}-branch-prices"
}

resource "aws_s3_bucket_public_access_block" "branch_prices" {
  bucket                  = aws_s3_bucket.branch_prices.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "branch_prices" {
  bucket = aws_s3_bucket.branch_prices.id
  rule {
    id     = "expire-stale-indexes"
    status = "Enabled"
    filter { prefix = "index/" }
    expiration { days = 14 }
  }
}

resource "aws_iam_role" "refresh" {
  name = "${var.name}-branch-prices"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "refresh" {
  name = "${var.name}-branch-prices"
  role = aws_iam_role.refresh.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.branch_prices.arn}/*" },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.branch_prices.arn },
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Scan", "dynamodb:Query"], Resource = aws_dynamodb_table.main.arn },
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:${var.region}:*:log-group:/aws/lambda/${var.name}-branch-prices*" },
    ]
  })
}

# The API reads the indexes and asks for a refresh.
resource "aws_iam_role_policy" "api_branches" {
  name = "${var.name}-api-branches"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.branch_prices.arn}/*" },
      { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.refresh.arn },
    ]
  })
}

resource "aws_cloudwatch_log_group" "refresh" {
  name              = "/aws/lambda/${var.name}-branch-prices"
  retention_in_days = 14
}

resource "aws_lambda_function" "refresh" {
  function_name    = "${var.name}-branch-prices"
  role             = aws_iam_role.refresh.arn
  runtime          = "nodejs22.x"
  handler          = "refresh.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 900 # a few chains' portals, geocoding at one request a second, several 10 MB price files
  memory_size      = 2048
  architectures    = ["arm64"]

  environment {
    variables = {
      TABLE_NAME    = aws_dynamodb_table.main.name
      BRANCH_BUCKET = aws_s3_bucket.branch_prices.bucket
      NODE_OPTIONS  = "--enable-source-maps"
    }
  }

  depends_on = [aws_cloudwatch_log_group.refresh]
}

# Nightly, after the chains publish (most do between 01:00 and 05:00 Israel time).
resource "aws_cloudwatch_event_rule" "refresh_nightly" {
  name                = "${var.name}-branch-prices-nightly"
  schedule_expression = "cron(30 3 * * ? *)" # 06:30 Israel
}

resource "aws_cloudwatch_event_target" "refresh_nightly" {
  rule = aws_cloudwatch_event_rule.refresh_nightly.name
  arn  = aws_lambda_function.refresh.arn
}

resource "aws_lambda_permission" "refresh_nightly" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.refresh.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.refresh_nightly.arn
}
