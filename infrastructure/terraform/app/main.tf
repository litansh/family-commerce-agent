# Retired (ADR 0012). What is left of the product stack is the role that applied it, which an apply
# cannot delete from under itself: it leaves the state in the next pull request and the account by
# the owner's hand. The provider blocks for archive and random stay until the state no longer holds
# their resources.

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.70" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "family-commerce-agent", managed_by = "terraform" }
  }
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "name" {
  type    = string
  default = "fca"
}
