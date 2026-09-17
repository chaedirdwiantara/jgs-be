#!/usr/bin/env bash
#
# Builds the Lambda bundle and rolls the whole stack forward.
#
# Infrastructure and code deploy together on purpose: the function's
# environment variables are produced by the same template that creates the
# tables they name, so letting the two drift apart is how you get a function
# pointing at a table that no longer exists.
#
# Usage:  ./scripts/deploy.sh [stack-name]
set -euo pipefail

STACK_NAME="${1:-jgs-be}"
REGION="${AWS_REGION:-ap-southeast-1}"
ARTIFACT_BUCKET="${ARTIFACT_BUCKET:-}"

cd "$(dirname "$0")/.."

if [[ -z "$ARTIFACT_BUCKET" ]]; then
  ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
  ARTIFACT_BUCKET="jgs-be-artifacts-${ACCOUNT_ID}"
fi

echo "==> Building bundle"
npm run build

echo "==> Packaging (uploading code to s3://${ARTIFACT_BUCKET})"
aws cloudformation package \
  --template-file infra/template.yaml \
  --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-prefix lambda \
  --output-template-file infra/packaged.yaml \
  --region "$REGION"

echo "==> Deploying stack ${STACK_NAME}"
aws cloudformation deploy \
  --template-file infra/packaged.yaml \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --region "$REGION"

echo "==> Outputs"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs' \
  --output table
