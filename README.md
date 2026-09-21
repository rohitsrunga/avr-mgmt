# AVR Management — Hotel Operations Platform

Internal serverless web app for AVR Management. Replaces paper-and-pen operations across two properties (Casco Bay Hotel, Saco Bay Hotel) with a mobile-first React + AWS app, plus a tiny separately-hosted bundle of public static HTML forms on S3 for guest/staff input. 

## Architecture
- **Frontend** (auth'd SPA): React 18 + Vite + Tailwind, deployed to S3 + CloudFront (or Cloudflare Pages)
- **Public forms**: vanilla HTML/CSS/JS on a public-read S3 bucket — dinner orders (Casco Bay) and housekeeping room assignments (both properties)
- **Backend**: Python 3.11 Lambdas (arm64) behind API Gateway (HTTP API + Cognito JWT authorizer) with per-route auth bypass for the public form endpoints
- **Data**: DynamoDB on-demand (7 tables, all `PK`/`SK` composite)
- **Auth**: Cognito User Pool with custom `role` and `property` attributes; admin-create-only

## Prerequisites (one-time)
- AWS account with credentials configured (`aws configure`)
- AWS SAM CLI 1.140+
- Node.js 20+, npm
- Python 3.11 locally **or** Docker (for `sam build --use-container`)

## Deploy from scratch

```bash
# 1. Build the frontend SPA
cd frontend && npm install && npm run build && cd ..

# 2. Build the SAM stack
sam build                       # if you have python3.11 locally
# or
sam build --use-container       # otherwise (uses Docker)

# 3. Deploy
sam deploy --guided             # first time only
sam deploy                      # subsequent deploys

# 4. Read stack outputs (you'll need these for env vars + the upload scripts)
aws cloudformation describe-stacks --stack-name avr-mgmt \
  --query "Stacks[0].Outputs" --output table

# 5. Wire frontend env values
#    Copy frontend/.env.example -> frontend/.env.local and paste:
#       VITE_USER_POOL_ID
#       VITE_USER_POOL_CLIENT_ID
#       VITE_API_BASE_URL
#       VITE_PUBLIC_FORMS_BASE_URL   (from PublicFormsUrl output)
#    Then rebuild the frontend:
cd frontend && npm run build && cd ..

# 6. Upload the SPA to S3 + invalidate CloudFront (only if DeployFrontend=true)
./scripts/upload_frontend.sh

# 7. Upload the public static forms (dinner.html + housekeeping.html)
./scripts/upload_forms.sh

# 8. Seed master data
python3 scripts/seed_data.py --stack avr-mgmt --region us-east-1

# 9. Create the first owner user
python3 scripts/setup_cognito.py --stack avr-mgmt --region us-east-1 \
  --email owner@example.com --name "Owner Name"
# Save the temporary password printed to the console.

# 10. Confirm the SNS billing-alarm subscription email (sent to OwnerEmail)

# 11. Visit the frontend URL and sign in.
```

## In-app tabs

The authenticated SPA exposes these tabs (role-gated):

| Tab          | Description                                                                                     | Roles |
|--------------|--------------------------------------------------------------------------------------------------|-------|
| Front Desk   | Daily shift tasks, handoff notes, breakfast & groundsman lists, dinner orders (Casco Bay)        | all (some sections restricted by role) |
| Housekeeping | Cleaning progress, roster + per-day room assignments (grouped by floor), shared notes, inspections | owner / manager / frontdesk / housekeeping |
| Inventory    | Stock + par levels, low-stock alerts. Includes the **Linen** category.                           | owner / manager / frontdesk / breakfast |
| Admin        | User management (Cognito), employees, per-property feature toggles                                | owner |

## Public forms (no login)

Two static pages on S3, branded for each property, no PII collected beyond what guests/housekeepers volunteer:

- **Dinner order form (Casco Bay)** — `…/dinner.html?p=casco_bay`. Submits to `POST /api/public/dinner-orders/casco_bay`. Front-desk sees orders in real time in the Front Desk tab and checks them off as plates go out.
- **Housekeeping form (both properties)** — `…/housekeeping.html?p=casco_bay` or `…/housekeeping.html?p=saco_bay`. The housekeeper picks their name from the dropdown, sees today's assigned rooms, and taps "Done" as each is finished. Each room card carries its own free-form note box; a note sent from it lands on the shared notepad stamped with its room and author — `Room 203 (Maria): Toilet is broken`. Managers assign rooms in the Housekeeping tab.

The form URLs are printed by [`scripts/upload_forms.sh`](scripts/upload_forms.sh). In the dashboards they appear as named hyperlinks (Housekeeping Assignments, Inspector Notes, Guest Orders, Inventory Form) with a "Copy link" button — the raw URL is never printed in the UI.

## Roles
| Role          | Tabs visible |
|---------------|--------------|
| owner         | All (incl. Admin) |
| manager       | All except Admin |
| frontdesk     | Front Desk, Housekeeping, Inventory |
| housekeeping  | Front Desk, Housekeeping (day-to-day housekeepers use the public form, not this login) |
| grounds       | Front Desk |
| breakfast     | Front Desk, Inventory |

Property scoping: `owner`/`manager` always see both properties. Other roles are tied to one property (`casco_bay` or `saco_bay`) or `both` via `custom:property` Cognito attribute.

## Day-2 ops

- **Add a user** — Admin tab → "Create user" (owner only). Captures temp password to share manually.
- **Reset a password** — Admin tab → "Reset pw".
- **Edit shift task templates** — Shift Checklist tab → "Edit tasks" (owner/manager only).
- **Add inventory items / linen categories** — Inventory tab → "Add item" (owner/manager only).
- **Assign housekeeping rooms** — Housekeeping tab → pick a housekeeper from the roster, type the room numbers, press Assign. Housekeepers see their rooms in the public form within seconds.
- **Process dinner orders** — Front Desk tab → open cards as they arrive, mark each "Made" when the plate is out.
- **Push a new form change** — Edit `forms/dinner.html`, `forms/housekeeping.html`, or `forms/styles.css`, then `./scripts/upload_forms.sh`. No SAM redeploy needed.

## Cost notes
- Target: $0–2/mo. Mostly free tier; CloudFront + small DynamoDB usage are the only ongoing costs after Year 1 free tier expires.
- Billing alarms fire at $5 and $20 (CloudWatch → SNS → owner email).

## Tear-down

```bash
sam delete --stack-name avr-mgmt --region us-east-1
# S3 buckets need to be emptied first if they contain objects:
aws s3 rm s3://avr-public-forms-<account-id> --recursive
aws s3 rm s3://avr-frontend-<account-id> --recursive   # if DeployFrontend was true
```
