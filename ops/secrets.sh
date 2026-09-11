#!/usr/bin/env bash
# Put the agents' Anthropic key into SSM (SecureString), the migration-agent way: prompted, never
# echoed, never on a command line (shell history), never in Terraform state. Terraform creates the
# parameter with a placeholder and ignores its value.
#   ops/secrets.sh              prompts for the key
#   ops/secrets.sh --copy       copies /migration-agent/anthropic-key (us-east-1) into /fca/anthropic-key
set -euo pipefail
PROFILE=personal-cfo; REGION=eu-central-1; NAME=/fca/anthropic-key
if [ "${1:-}" = "--copy" ]; then
  VALUE=$(aws --profile "$PROFILE" --region us-east-1 ssm get-parameter --name /migration-agent/anthropic-key --with-decryption --query Parameter.Value --output text)
else
  read -r -s -p "Anthropic API key (sk-ant-…): " VALUE; echo
fi
[ -n "$VALUE" ] || { echo "empty; nothing written"; exit 1; }
aws --profile "$PROFILE" --region "$REGION" ssm put-parameter --name "$NAME" --type SecureString --overwrite --value "$VALUE" --query Version --output text | sed "s|^|$NAME → version |"
