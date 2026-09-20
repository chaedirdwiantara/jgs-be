#!/usr/bin/env bash
#
# One-time setup, before the first deploy.
#
# Creates the two things CloudFormation cannot create for itself:
#   1. the S3 bucket that holds the packaged Lambda code, and
#   2. the SSM SecureString parameters (CloudFormation can only create plain
#      String parameters, so a secret written from a template would be stored
#      unencrypted and visible in the stack's events).
#
# Safe to re-run: every step is skipped if it already exists, and an existing
# secret is never overwritten.
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"
PREFIX="${NAME_PREFIX:-jgs}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ARTIFACT_BUCKET="jgs-be-artifacts-${ACCOUNT_ID}"

echo "==> Account ${ACCOUNT_ID}, region ${REGION}"

# ── 1. Artifact bucket ───────────────────────────────────────────────────────
if aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" 2>/dev/null; then
  echo "    artifact bucket already exists: ${ARTIFACT_BUCKET}"
else
  echo "==> Creating artifact bucket ${ARTIFACT_BUCKET}"
  aws s3api create-bucket \
    --bucket "$ARTIFACT_BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null

  aws s3api put-public-access-block \
    --bucket "$ARTIFACT_BUCKET" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  aws s3api put-bucket-encryption \
    --bucket "$ARTIFACT_BUCKET" \
    --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

  # Old build artifacts are dead weight the moment the next deploy lands.
  aws s3api put-bucket-lifecycle-configuration \
    --bucket "$ARTIFACT_BUCKET" \
    --lifecycle-configuration \
      '{"Rules":[{"ID":"expire-old-artifacts","Status":"Enabled","Filter":{"Prefix":"lambda/"},"Expiration":{"Days":30}}]}'
fi

# ── 2. Secrets ───────────────────────────────────────────────────────────────
put_parameter() {
  local name="$1" value="$2" type="$3" description="$4"

  if aws ssm get-parameter --name "$name" --region "$REGION" >/dev/null 2>&1; then
    echo "    parameter already set, leaving alone: ${name}"
    return
  fi

  aws ssm put-parameter \
    --name "$name" \
    --value "$value" \
    --type "$type" \
    --description "$description" \
    --region "$REGION" >/dev/null

  echo "    created ${name}"
}

echo "==> Creating SSM parameters"

# 48 random bytes. Rotating it later invalidates every signed-in session, which
# is exactly what you want if it ever leaks.
JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
put_parameter "/${PREFIX}/prod/jwt-secret" "$JWT_SECRET" SecureString \
  "Signing key for admin console access tokens"

# Placeholders: the operator fills these in after creating the bot. The API
# treats "unset" as "Telegram not configured" and carries on without it.
put_parameter "/${PREFIX}/prod/telegram-bot-token" "unset" SecureString \
  "Telegram bot token from @BotFather"
put_parameter "/${PREFIX}/prod/telegram-chat-id" "unset" String \
  "Telegram group chat id that receives new application alerts"
put_parameter "/${PREFIX}/prod/telegram-rental-chat-id" "unset" String \
  "Telegram group chat id that receives rental schedule and payment alerts"

echo
echo "Bootstrap complete. Next: ./scripts/deploy.sh"
