# Ordering: the API enqueues a job; a worker on the family's own machine
# picks it up, drives the retailer, and writes progress back to the table.
# The worker gets its own least-privilege identity — receive/delete on this
# queue, read/update on the table — and nothing else.

resource "aws_sqs_queue" "orders" {
  name                       = "${var.name}-orders"
  visibility_timeout_seconds = 2700 # 45 min: a full cart + waiting for approval
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
}

resource "aws_iam_role_policy" "api_orders" {
  name = "${var.name}-api-orders"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.orders.arn }]
  })
}

resource "aws_iam_user" "worker" {
  name = "${var.name}-order-worker"
}

resource "aws_iam_user_policy" "worker" {
  name = "${var.name}-order-worker"
  user = aws_iam_user.worker.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.orders.arn },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"]
        Resource = aws_dynamodb_table.main.arn
        # Only order rows: the worker never reads memory or members.
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["HOUSEHOLD#*"] } }
      },
    ]
  })
}

resource "aws_iam_access_key" "worker" {
  user = aws_iam_user.worker.name
}

output "orders_queue_url" { value = aws_sqs_queue.orders.url }
output "worker_access_key_id" { value = aws_iam_access_key.worker.id }
output "worker_secret_access_key" {
  value     = aws_iam_access_key.worker.secret
  sensitive = true
}
