# What the retirement leaves (ADR 0012): nothing managed. The role that applied this stack cannot
# delete itself from under a running apply, so it leaves the state here and the account by the
# owner's hand (ops/NEEDS-HUMAN.md). After this apply the state is empty; the next pull request
# removes the directory and the workflow.

# Forgotten in retire(1/4); kept as the record of what this stack once created and still exists.
removed {
  from = aws_iam_openid_connect_provider.github
  lifecycle { destroy = false }
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

# retire(3/4): the applying role and its policy leave the state but not the account. The owner
# deletes them once nothing applies this stack any more.
removed {
  from = aws_iam_role.github_terraform
  lifecycle { destroy = false }
}

removed {
  from = aws_iam_role_policy.github_terraform
  lifecycle { destroy = false }
}
