# Remote state, so Terraform runs from GitHub Actions and a laptop alike. The bucket was created
# by this stack on the first local apply and is now kept outside it (ci.tf, `removed` block):
# it outlives the stack (ADR 0012). The account id is hard-coded on purpose, so no repository
# secret is load-bearing for init.
terraform {
  backend "s3" {
    bucket       = "fca-tfstate-437075214009"
    key          = "app/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
