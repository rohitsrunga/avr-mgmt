#!/usr/bin/env bash
# Upload the built frontend to S3 and invalidate CloudFront.
# Run from the repo root after `cd frontend && npm run build`.
set -euo pipefail

STACK="${1:-avr-mgmt}"
REGION="${2:-us-east-1}"

BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucket'].OutputValue" --output text)

if [ -z "$BUCKET" ]; then
  echo "Could not find FrontendBucket output on stack $STACK" >&2
  exit 1
fi

DIST_ID=$(aws cloudfront list-distributions --region "$REGION" \
  --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, '$BUCKET')].Id | [0]" \
  --output text)

if [ ! -d "frontend/dist" ]; then
  echo "frontend/dist does not exist. Run 'cd frontend && npm install && npm run build' first." >&2
  exit 1
fi

echo "Uploading to s3://$BUCKET ..."
aws s3 sync frontend/dist/ "s3://$BUCKET/" --delete --region "$REGION"

if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
  echo "Invalidating CloudFront $DIST_ID ..."
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --region "$REGION"
fi

echo "Frontend uploaded."
