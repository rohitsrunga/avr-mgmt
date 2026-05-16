#!/usr/bin/env bash
# Upload the public static HTML forms (dinner.html, housekeeping.html) to S3.
# Substitutes the live API base URL into each HTML file before upload.
#
# Run from the repo root after `sam deploy` succeeds:
#   ./scripts/upload_forms.sh                    # uses defaults (avr-mgmt, us-east-1)
#   ./scripts/upload_forms.sh my-stack us-west-2

set -euo pipefail

STACK="${1:-avr-mgmt}"
REGION="${2:-us-east-1}"

OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs" --output json)

BUCKET=$(echo "$OUTPUTS" | python3 -c "import sys, json; [print(o['OutputValue']) for o in json.load(sys.stdin) if o['OutputKey']=='PublicFormsBucket']")
API_URL=$(echo "$OUTPUTS" | python3 -c "import sys, json; [print(o['OutputValue']) for o in json.load(sys.stdin) if o['OutputKey']=='ApiUrl']")

if [ -z "$BUCKET" ] || [ -z "$API_URL" ]; then
  echo "Could not read PublicFormsBucket / ApiUrl from stack $STACK." >&2
  exit 1
fi

# strip trailing slash if any
API_URL="${API_URL%/}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp forms/styles.css "$TMP/styles.css"
# Substitute the API base into each HTML file.
for page in dinner.html housekeeping.html onboarding.html handbook.html; do
  sed "s|__API_BASE__|$API_URL|g" "forms/$page" > "$TMP/$page"
done

echo "Uploading static forms to s3://$BUCKET ..."
aws s3 cp "$TMP/styles.css"        "s3://$BUCKET/styles.css"        --region "$REGION" --content-type 'text/css; charset=utf-8'  --cache-control 'public, max-age=300'
aws s3 cp "$TMP/dinner.html"       "s3://$BUCKET/dinner.html"       --region "$REGION" --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=60'
aws s3 cp "$TMP/housekeeping.html" "s3://$BUCKET/housekeeping.html" --region "$REGION" --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=60'
aws s3 cp "$TMP/onboarding.html"   "s3://$BUCKET/onboarding.html"   --region "$REGION" --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=60'
aws s3 cp "$TMP/handbook.html"     "s3://$BUCKET/handbook.html"     --region "$REGION" --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=60'

WEBSITE_BASE="http://${BUCKET}.s3-website-${REGION}.amazonaws.com"
echo
echo "Forms uploaded. Public URLs:"
echo "  Dinner (Casco Bay):    $WEBSITE_BASE/dinner.html?p=casco_bay"
echo "  Housekeeping Casco:    $WEBSITE_BASE/housekeeping.html?p=casco_bay"
echo "  Housekeeping Saco:     $WEBSITE_BASE/housekeeping.html?p=saco_bay"
echo "  Onboarding (template): $WEBSITE_BASE/onboarding.html?token=<token>"
echo "  Handbook Casco:        $WEBSITE_BASE/handbook.html?p=casco_bay"
echo "  Handbook Saco:         $WEBSITE_BASE/handbook.html?p=saco_bay"
