# Store trouble seen by real phones. Every store screen reports load errors, HTTP 4xx/5xx
# and Cloudflare guards to the API (one JSON log line per report). These filters count
# them; the alarm e-mails the owner the same hour a store breaks for a family.

variable "alert_email" {
  type    = string
  default = "litansh@gmail.com"
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_log_metric_filter" "store_http_errors" {
  name           = "${var.name}-store-http-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.event = \"import-history\" && $.diag.httpError.statusCode >= 400 }"
  metric_transformation {
    name      = "StoreHttpErrors"
    namespace = "Kaniti"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "store_load_errors" {
  name           = "${var.name}-store-load-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.event = \"import-history\" && $.diag.loadError.code = * }"
  metric_transformation {
    name      = "StoreLoadErrors"
    namespace = "Kaniti"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "store_errors" {
  alarm_name          = "${var.name}-store-errors"
  alarm_description   = "Phones are hitting store load/HTTP errors. Run ops/repair.sh and read the import-history log lines."
  namespace           = "Kaniti"
  metric_name         = "StoreHttpErrors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "store_load_errors" {
  alarm_name          = "${var.name}-store-load-errors"
  alarm_description   = "Phones cannot load a store's page. Run ops/repair.sh."
  namespace           = "Kaniti"
  metric_name         = "StoreLoadErrors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Alerts on the owner's phone: a small Lambda subscribed to the topic posts each alarm to a
# Telegram chat. Set telegram_bot_token / telegram_chat_id in terraform.tfvars to turn it on.
variable "telegram_bot_token" {
  type      = string
  default   = ""
  sensitive = true
}
variable "telegram_chat_id" {
  type    = string
  default = ""
}

resource "aws_iam_role" "alerts" {
  name = "${var.name}-alerts"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "alerts" {
  name = "${var.name}-alerts"
  role = aws_iam_role.alerts.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:${var.region}:*:log-group:/aws/lambda/${var.name}-alerts*" }]
  })
}

resource "aws_lambda_function" "alerts" {
  function_name    = "${var.name}-alerts"
  role             = aws_iam_role.alerts.arn
  runtime          = "nodejs22.x"
  handler          = "alerts.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 20
  memory_size      = 256
  architectures    = ["arm64"]
  environment {
    variables = {
      TELEGRAM_BOT_TOKEN = var.telegram_bot_token
      TELEGRAM_CHAT_ID   = var.telegram_chat_id
    }
  }
}

resource "aws_sns_topic_subscription" "alerts_telegram" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.alerts.arn
}

resource "aws_lambda_permission" "alerts_sns" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alerts.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alerts.arn
}
