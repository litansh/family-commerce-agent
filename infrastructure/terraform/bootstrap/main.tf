# Bootstrap: the one thing that must exist before anything else — a spending
# guard on the account. Applied once, by hand, before any product infrastructure.
#
#   cd infrastructure/terraform/bootstrap
#   AWS_PROFILE=personal-cfo terraform init && terraform apply
#
# Budgets is a global service; the provider region is irrelevant to it.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { project = "family-commerce-agent", managed_by = "terraform" }
  }
}

variable "alert_email" {
  type        = string
  description = "Where budget alerts go."
}

variable "monthly_limit_usd" {
  type        = number
  default     = 50
  description = "Hard target for the whole account. The product is expected to run at ~$5."
}

# --- The budget ------------------------------------------------------------
#
# Three thresholds, because a single alert at 100% arrives after the money is
# spent. 50% is a heads-up, 80% is "look now", and the FORECASTED 100% fires
# early in the month when the run-rate alone would blow the limit — which is
# the alert that actually saves money.

resource "aws_budgets_budget" "account_monthly" {
  name         = "family-commerce-agent-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit       = false
    include_refund       = false
    include_subscription = true
    include_support      = true
    include_tax          = true
    use_amortized        = false
    use_blended          = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# --- A second, independent tripwire ----------------------------------------
#
# Budgets evaluates a few times a day; a CloudWatch billing alarm is a separate
# mechanism with its own cadence. Two cheap guards beat one. Requires billing
# alerts to be enabled once in the console (Billing → Preferences → "Receive
# CloudWatch billing alerts"); the alarm is inert until then and harmless.

resource "aws_sns_topic" "billing" {
  name = "family-commerce-agent-billing"
}

resource "aws_sns_topic_subscription" "billing_email" {
  topic_arn = aws_sns_topic.billing.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "estimated_charges" {
  alarm_name          = "family-commerce-agent-estimated-charges"
  alarm_description   = "Estimated month-to-date charges crossed the monthly limit."
  namespace           = "AWS/Billing"
  metric_name         = "EstimatedCharges"
  statistic           = "Maximum"
  period              = 21600 # 6h — billing metrics update a few times a day
  evaluation_periods  = 1
  threshold           = var.monthly_limit_usd
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { Currency = "USD" }
  alarm_actions       = [aws_sns_topic.billing.arn]
}

output "budget_name" { value = aws_budgets_budget.account_monthly.name }
output "billing_topic" { value = aws_sns_topic.billing.arn }
