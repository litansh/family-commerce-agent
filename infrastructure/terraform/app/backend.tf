# Remote state, so Terraform runs from GitHub Actions and a laptop alike. The bucket is created
# by this stack (ci.tf) on the first local apply; `terraform init -migrate-state` then moves the
# state into it once, and no laptop needs AWS credentials for this stack again.
# The bucket is `fca-tfstate-<account id>`, passed at init so the account id stays out of the tree:
#   terraform init -backend-config="bucket=fca-tfstate-$AWS_ACCOUNT_ID"
terraform {
  backend "s3" {
    key          = "app/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
