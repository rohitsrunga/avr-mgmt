# AVR Management — Hotel Operations Platform

Internal serverless web app for AVR Management (Saish LLC). Replaces paper-and-pen operations across two properties (Casco Bay Hotel, Saco Bay Hotel) with a single mobile-first React + AWS app.

## Architecture
- **Frontend**: React 18 + Vite + Tailwind, deployed to S3 + CloudFront
- **Backend**: Python 3.11 Lambda functions behind API Gateway (HTTP API + Cognito JWT authorizer)
- **Data**: DynamoDB on-demand (7 tables), Secrets Manager for Cloudbeds OAuth
- **Sync**: EventBridge → sync Lambda → Cloudbeds API every 6 hours (Saco Bay only — Casco Bay uses Choice Advantage which has no public API)
- **Auth**: Cognito User Pool with custom `role` and `property` attributes; admin-create-only

## Prerequisites (one-time)
- AWS account with credentials configured (`aws configure`)
- AWS SAM CLI 1.140+
- Node.js 20+, npm
- Python 3.11 locally **or** Docker (for `sam build --use-container`)

## Deploy from scratch

```bash
# 1. Install frontend deps + build
cd frontend
npm install
npm run build
cd ..

# 2. Build the SAM stack
#    If you have python3.11 locally:
sam build
#    Otherwise (uses Docker):
sam build --use-container

# 3. Deploy (interactive first time, accepts defaults from samconfig.toml after)
sam deploy --guided    # first time only
# subsequent deploys:
sam deploy

# 4. Wire frontend to deployed APIs
#    Grab outputs:
aws cloudformation describe-stacks --stack-name avr-mgmt \
  --query "Stacks[0].Outputs" --output table

#    Copy frontend/.env.example -> frontend/.env.local and paste in:
#       VITE_USER_POOL_ID
#       VITE_USER_POOL_CLIENT_ID
#       VITE_API_BASE_URL

#    Rebuild the frontend with the new env values:
cd frontend && npm run build && cd ..

# 5. Upload frontend to S3 + invalidate CloudFront
./scripts/upload_frontend.sh

# 6. Seed master data (shift tasks, inventory items, checklists, rooms)
python3 scripts/seed_data.py --stack avr-mgmt --region us-east-1

# 7. Create the first owner user
python3 scripts/setup_cognito.py --stack avr-mgmt --region us-east-1 \
  --email rohit_gazer@yahoo.com --name "Rohit Srungavarapu"
# Save the temporary password printed to the console.

# 8. Confirm the SNS billing-alarm subscription email
#    AWS will send a confirmation link to the OwnerEmail you set.

# 9. Visit the CloudFront URL (printed in stack outputs) and sign in.
```

## Cloudbeds setup (Saco Bay only — optional)

1. Register an app in the Cloudbeds developer portal with redirect URI `http://localhost:8765/callback`.
2. Run the interactive setup:
   ```bash
   python3 scripts/cloudbeds_oauth_setup.py --stack avr-mgmt
   ```
3. After the secret is in place, enable the EventBridge schedule:
   ```bash
   aws events enable-rule --name avr-mgmt-SyncFunctionSchedule  # name varies — see SAM output
   ```
   Or set `Enabled: true` in `template.yaml` and redeploy. The sync runs every 6 hours.

## Project layout

```
template.yaml         AWS SAM stack (Cognito, API GW, Lambdas, DynamoDB, S3, CloudFront, alarms)
samconfig.toml        Default SAM deploy config
backend/
  shared/             auth.py, dynamo.py, response.py, router.py
  shifts/  inventory/  checklists/  rooms/  parkfly/  linen/  reports/  sync/  admin/
frontend/
  src/
    auth/             AuthProvider, ProtectedRoute, LoginPage
    components/       Header, NavTabs, PropertySwitcher, MetricCard, StockBar, etc.
    hooks/            useApi, useProperty
    pages/            Dashboard, Shifts, Inventory, Checklists, Rooms, ParkFly, Linen, Reports, Admin
scripts/
  seed_data.py              Populate DynamoDB master data
  setup_cognito.py          Create the first owner user
  cloudbeds_oauth_setup.py  Interactive OAuth flow + Secrets Manager write
  upload_frontend.sh        Sync frontend/dist to S3 + invalidate CloudFront
```

## Roles
| Role          | Tabs visible |
|---------------|--------------|
| owner         | All (incl. Admin, Reports) |
| manager       | All except Admin |
| frontdesk     | Overview, Shifts, Inventory, Checklists, Rooms, Park & Fly |
| housekeeping  | Checklists, Rooms, Linen |
| grounds       | Checklists |
| breakfast     | Checklists, Inventory |

Property scoping: `owner`/`manager` always see both properties. Other roles are tied to one property (`casco_bay` or `saco_bay`) or `both` via `custom:property` Cognito attribute.

## Day-2 ops

- **Add a user** — Admin tab → "Create user" (owner only). Captures temp password to share manually.
- **Reset a password** — Admin tab → "Reset pw". Generates a temp password.
- **Edit shift task templates** — Shifts tab → "Edit tasks" (owner/manager only).
- **Add inventory items** — Inventory tab → "+ Add item" (owner/manager only).
- **Update room data** — Rooms tab → click a row → edit fields inline.
- **Force a Cloudbeds sync** — invoke the sync Lambda manually:
  ```bash
  aws lambda invoke --function-name avr-mgmt-sync --region us-east-1 /tmp/out.json
  ```

## Cost notes
- Target: $0–2/mo. Mostly free tier; CloudFront + small DynamoDB usage are the only ongoing costs after Year 1 free tier expires.
- Billing alarms fire at $5 and $20 (CloudWatch → SNS → owner email).

## Tear-down

```bash
sam delete --stack-name avr-mgmt --region us-east-1
# S3 frontend bucket may need to be emptied first:
aws s3 rm s3://avr-mgmt-frontend-<account-id> --recursive
```
