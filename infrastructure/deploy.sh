#!/usr/bin/env bash
# Deploy the agent-tripwire IoC seeder Lambda + S3 bucket + EventBridge schedule.
#
# Prereqs: aws CLI configured (we use the default profile), pnpm, Node 22.
#
# Idempotent: run repeatedly to update. CloudFormation handles drift / change-sets.

set -euo pipefail

cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-agent-tripwire-seeder}"
REGION="${AWS_REGION:-us-east-1}"
CODE_BUCKET="${CODE_BUCKET:-agent-trip-wire-git}"
CODE_PREFIX="${CODE_PREFIX:-lambda-code}"
SNAPSHOTS_BUCKET="${SNAPSHOTS_BUCKET:-agent-tripwire-snapshots-190236274723}"
SCHEDULE="${SCHEDULE:-cron(0 6 * * ? *)}"

echo ">>> Building Lambda bundle"
pnpm --filter @tripwire/lambda-seeder build

ZIP_FILE=$(mktemp -d)/handler.zip
(
  cd packages/lambda-seeder/dist
  zip -q -j "$ZIP_FILE" handler.mjs
)
SHA=$(shasum -a 256 "$ZIP_FILE" | awk '{print $1}' | cut -c1-12)
CODE_KEY="$CODE_PREFIX/handler-$SHA.zip"

echo ">>> Uploading $ZIP_FILE -> s3://$CODE_BUCKET/$CODE_KEY"
aws s3 cp "$ZIP_FILE" "s3://$CODE_BUCKET/$CODE_KEY" --region "$REGION"

echo ">>> Deploying CloudFormation stack $STACK_NAME"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file infrastructure/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    CodeS3Bucket="$CODE_BUCKET" \
    CodeS3Key="$CODE_KEY" \
    Schedule="$SCHEDULE" \
    SnapshotsBucketName="$SNAPSHOTS_BUCKET"

echo ">>> Updating Lambda function code (CloudFormation only picks up new code on parameter change)"
aws lambda update-function-code \
  --region "$REGION" \
  --function-name agent-tripwire-seeder \
  --s3-bucket "$CODE_BUCKET" \
  --s3-key "$CODE_KEY" >/dev/null

echo ">>> Waiting for function update to complete"
aws lambda wait function-updated \
  --region "$REGION" \
  --function-name agent-tripwire-seeder

echo
echo ">>> Stack outputs"
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table
