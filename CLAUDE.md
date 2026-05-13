# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Internal serverless ops platform for AVR Management, covering two hotels — Casco Bay and Saco Bay. Mobile-first React SPA + AWS SAM backend (HTTP API + Cognito + DynamoDB + Lambda), plus a tiny separately-hosted bundle of static HTML forms on S3 for unauthenticated guest/staff input. Target operating cost is $0–2/mo, so most architectural decisions favor pay-per-request / free-tier services. See [README.md](README.md) for the deploy walkthrough.

## Common commands

### Backend (SAM)
```bash
sam build                       # needs local python3.11
sam build --use-container       # otherwise (Docker)
sam deploy                      # uses samconfig.toml; stack: avr-mgmt, region: us-east-1
sam deploy --guided             # first-time only
sam validate --lint             # template syntax + best-practice lint
sam delete --stack-name avr-mgmt --region us-east-1
```
Frontend S3/CloudFront resources are gated by `DeployFrontend` (default `false`); pass `--parameter-overrides DeployFrontend=true` to provision them. The frontend can alternatively be hosted on Cloudflare Pages/Workers ([frontend/wrangler.toml](frontend/wrangler.toml)). The **public-forms S3 bucket** is always created — it holds the unauthenticated dinner-order and housekeeping forms and is publicly readable.

### Frontend (authenticated SPA)
```bash
cd frontend
npm install
npm run dev       # vite on :5173
npm run build     # outputs to frontend/dist/
./../scripts/upload_frontend.sh   # sync dist/ to S3 + invalidate CloudFront
```
Env vars (`frontend/.env.local`) — inlined by Vite at build time:
- `VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID`, `VITE_API_BASE_URL` (from stack outputs)
- `VITE_PUBLIC_FORMS_BASE_URL` (also a stack output) — surfaced in the Dinner Orders and Housekeeping dashboards as a copyable "share with staff" link
- `VITE_AWS_REGION` (defaults to `us-east-1`)

### Public S3 forms (unauthenticated)
```bash
./scripts/upload_forms.sh                    # uploads forms/{dinner,housekeeping}.html + styles.css
./scripts/upload_forms.sh my-stack us-west-2 # different stack/region
```
The script substitutes `__API_BASE__` in each HTML file with the live `ApiUrl` stack output before uploading. The forms are vanilla HTML/CSS/JS — no React, no build step — and POST to the public `/api/public/*` endpoints (no auth).

### One-off scripts
```bash
python3 scripts/seed_data.py --stack avr-mgmt --region us-east-1     # populate master data
python3 scripts/seed_data.py --stack avr-mgmt --reset                # purge + reseed
python3 scripts/setup_cognito.py --stack avr-mgmt --region us-east-1 \
  --email <email> --name "<full name>"                                # create owner user
python3 scripts/migrate_linen_to_inventory.py --stack avr-mgmt       # one-shot: linen → inventory
python3 scripts/migrate_linen_to_inventory.py --stack avr-mgmt --dry-run
```

There is **no test suite** in this repo. Don't fabricate one or claim tests passed. Vite build + `sam validate --lint` + `python3 -c "import ast; ast.parse(open(...).read())"` is the closest thing to CI.

## Architecture

### Single CloudFormation stack ([template.yaml](template.yaml))
SAM template defines: Cognito User Pool + Client, HTTP API with Cognito JWT authorizer as the default authorizer, 8 Lambdas (one per domain), 7 DynamoDB tables (PAY_PER_REQUEST), an always-on **public-forms S3 bucket** for static HTML forms, optional S3+CloudFront for the authenticated SPA, and SNS-backed CloudWatch billing alarms ($5 and $20). All Lambdas share `CodeUri: backend/` and run `python3.11` on `arm64` with a 15 s default timeout.

### Backend layout
Each domain (`shifts`, `inventory`, `checklists`, `rooms`, `parkfly`, `admin`, `dinner_orders`, `housekeeping`) is its own folder under [backend/](backend/) with a `handler.py` whose top-level `handler(event, context)` is the Lambda entry point. Routes are registered with the tiny [backend/shared/router.py](backend/shared/router.py) `Router` class via decorators like `@router.get("/api/shifts/{property_id}/tasks")`; `{name}` syntax compiles to a regex named group passed as the `params` dict. `OPTIONS` is auto-handled with a 204. All handlers wrap dispatch in a try/except and return JSON via [backend/shared/response.py](backend/shared/response.py) helpers (`ok`, `bad_request`, `forbidden`, …).

### Auth model
Cognito ID-token JWT claims are surfaced by API Gateway at `event.requestContext.authorizer.jwt.claims`. [backend/shared/auth.py](backend/shared/auth.py) reads two **custom** Cognito attributes:
- `custom:role` — one of `owner | manager | frontdesk | housekeeping | grounds | breakfast`
- `custom:property` — `casco_bay | saco_bay | both`

Use `authorize(event, allowed_roles)` for role-only checks and `authorize_property(event, property_id, allowed_roles)` for property-scoped routes. **`owner` and `manager` always pass the property check**; other roles must match the route's `property_id` (or have `both`). Both helpers return `None` on success or an HTTP error response — handlers should `return err` immediately when truthy. Frontend route-level role gating lives in [frontend/src/auth/ProtectedRoute.jsx](frontend/src/auth/ProtectedRoute.jsx) and the tab map in [frontend/src/config.js](frontend/src/config.js).

User creation is **admin-only** (`AllowAdminCreateUserOnly: true`). All user CRUD goes through the `admin` Lambda — the only function holding `cognito-idp:Admin*` IAM permissions. There is no self-signup path.

### Public (unauthenticated) routes
The `dinner_orders` and `housekeeping` Lambdas each serve **two route prefixes**:
- `/api/<domain>/*` — authenticated dashboard, uses the default Cognito JWT authorizer
- `/api/public/<domain>/*` — unauthenticated, route-level `Auth: { Authorizer: NONE }` in [template.yaml](template.yaml). Consumed by the static HTML forms in S3.

Public handlers must validate their own input (length caps, allowlist of property IDs, etc.) since there is no authorizer in front of them. They should never write PII-revealing data into responses that aren't keyed by a user-supplied token. See [backend/dinner_orders/handler.py](backend/dinner_orders/handler.py) and [backend/housekeeping/handler.py](backend/housekeeping/handler.py) for the pattern.

### DynamoDB conventions
All tables use composite `PK` + `SK` strings. The dominant pattern is `PK = PROPERTY#<property_id>` with a domain prefix on `SK`. Example layouts:

| Table | PK | SK pattern(s) |
|-------|-----|----------------|
| `avr-shift-tasks` | `PROPERTY#<id>` | `SHIFT#<n>#TASK#<task_id>` (template), `DAILY#<date>#SHIFT#<n>#TASK#<task_id>` (completion), `HANDOFF#<date>#SHIFT#<n>` |
| `avr-inventory` | `PROPERTY#<id>` | `CATEGORY#<cat>#ITEM#<item_id>` — the `linen` category absorbed the old standalone Linen table |
| `avr-checklists` | `PROPERTY#<id>` (templates) / `PROPERTY#<id>#DATE#<date>` (completions) | `TEMPLATE#<list_type>#ITEM#<idx>` / `LIST#<list_type>#ITEM#<idx>` |
| `avr-rooms` | `PROPERTY#<id>` | `ROOM#<room_number>` |
| `avr-parkfly` | `PROPERTY#<id>` | `VEHICLE#<vehicle_id>` (+ `ActiveVehiclesIndex` GSI) |
| `avr-dinner-orders` | `PROPERTY#<id>` | `ORDER#<YYYY-MM-DD>#<order_id>` |
| `avr-housekeeping` | `PROPERTY#<id>` | `ROSTER#<housekeeper_id>` (lightweight name-only roster) / `ASSIGN#<YYYY-MM-DD>#<assign_id>` |

GSIs: `ShiftTasksTable.DailyTasksIndex` (date-keyed) and `ParkAndFlyTable.ActiveVehiclesIndex`.

Use [backend/shared/dynamo.py](backend/shared/dynamo.py):
- `table("TABLE_SHIFT_TASKS")` reads the table name from env (set per-Lambda by SAM `Globals`)
- `to_dynamo(value)` recursively converts floats → `Decimal` — **always wrap items before writing**
- `query_pk(tbl, pk, sk_prefix=None)` and `query_gsi(...)` paginate automatically

Table-name env vars in [template.yaml](template.yaml) `Globals.Function.Environment.Variables`: `TABLE_SHIFT_TASKS`, `TABLE_INVENTORY`, `TABLE_CHECKLISTS`, `TABLE_ROOMS`, `TABLE_PARKFLY`, `TABLE_DINNER_ORDERS`, `TABLE_HOUSEKEEPING`.

### Frontend SPA
React 18 + Vite + Tailwind, no TypeScript. Routing in [frontend/src/App.jsx](frontend/src/App.jsx) — every authenticated page sits under `/app/*` wrapped in `<ProtectedRoute>`, with extra role gates on `housekeeping` / `dinner` (owner/manager/frontdesk) and `admin` (owner).

The **NavTabs** ([frontend/src/components/NavTabs.jsx](frontend/src/components/NavTabs.jsx)) filters by both role (`ROLES` allowlist in config) **and** current property — the `dinner` tab is hidden unless the active property is in `DINNER_ENABLED_PROPERTIES` (currently `casco_bay` only).

Three state providers, composed in [frontend/src/main.jsx](frontend/src/main.jsx):
- **`AuthProvider`** ([auth/AuthProvider.jsx](frontend/src/auth/AuthProvider.jsx)) — wraps `amazon-cognito-identity-js`, persists sessions via the SDK's default localStorage, handles `NEW_PASSWORD_REQUIRED` challenge on first login. JWT claims are manually base64-decoded to populate `user.role` / `user.property`.
- **`PropertyProvider`** ([hooks/useProperty.jsx](frontend/src/hooks/useProperty.jsx)) — owner/manager (or `property === 'both'`) see a property switcher; single-property users are pinned. Selection persists in localStorage under `avr.property`.
- API calls go through [hooks/useApi.js](frontend/src/hooks/useApi.js), which injects `Authorization: Bearer <idToken>` and force-logs-out on 401. There is no fetch library — just `fetch` + a JSON wrapper.

### Design system
Light Apple-inspired palette defined in [frontend/tailwind.config.js](frontend/tailwind.config.js): `surface/line/ink/brand` color scales, `system-ui` / SF Pro font stack, 8–22px radii. Component primitives (`.btn-primary`, `.card`, `.input`, `.badge-*`, `.page-title`, `.section-title`, `.table-clean`) live in the `@layer components` block of [frontend/src/styles.css](frontend/src/styles.css). The static forms in [forms/styles.css](forms/styles.css) mirror these tokens as CSS variables — keep the two palettes in sync when adjusting.

### Static public forms ([forms/](forms/))
`forms/dinner.html` and `forms/housekeeping.html` are vanilla HTML+CSS+JS pages served from a public-read S3 bucket. They contain a `window.__API_BASE = '__API_BASE__'` placeholder which [scripts/upload_forms.sh](scripts/upload_forms.sh) substitutes with the live `ApiUrl` stack output via `sed` at upload time. Each form picks its property from the `?p=<property_id>` query string (default `casco_bay`). The housekeeping form remembers the picked housekeeper in localStorage under `avr.housekeeper.<property>` so a phone left at a cart auto-resumes.

The forms POST to `/api/public/*` and never carry credentials. They are intentionally branded for the property (no AVR-internal info, no PII echoed back).

## Conventions and pitfalls

- **Adding a new domain Lambda**: create `backend/<domain>/handler.py` with a `Router`, add a `<Domain>Function` resource in [template.yaml](template.yaml) mirroring the existing pattern (proxy path `/api/<domain>/{proxy+}`, GET/POST/PUT/DELETE events, `DynamoDBCrudPolicy` on the relevant table). The `Globals` block already adds Cognito/table env vars to every function.
- **Adding a public route to an existing Lambda**: add a separate `HttpApi` event with `Auth: { Authorizer: NONE }` and the `/api/public/<domain>/{proxy+}` path. The Router will dispatch based on the path, so just register the public path under a different decorator. **Validate everything server-side** — assume the request is hostile.
- **Always call `to_dynamo(...)` before writing.** Direct floats raise; the helper converts to `Decimal`. The `_DecimalEncoder` in `response.py` converts back on the way out.
- **Date defaults are UTC.** Handlers fall back to `datetime.now(timezone.utc).strftime("%Y-%m-%d")` when no `date` is supplied — keep this consistent or the partition split for daily records won't line up.
- **CORS lives in two places.** API Gateway returns the allow-list from [template.yaml](template.yaml) (which includes the public-forms bucket's website endpoint). The Lambda `response.py` also returns `Access-Control-Allow-Origin: *` for safety; don't tighten one without the other.
- **Don't add a self-signup flow.** User creation is admin-only by design.
- **Frontend env values are baked at build time.** Changing `VITE_*` requires re-running `npm run build` and re-uploading.
- **Public-form changes require re-running `upload_forms.sh`** — they are not part of the React build.
- **Casco Bay vs Saco Bay scoping for new features**: gate visibility in `ROLES`/`DINNER_ENABLED_PROPERTIES` (frontend) **and** in the Lambda (`ENABLED_PROPERTIES` allowlist or equivalent — see [backend/dinner_orders/handler.py](backend/dinner_orders/handler.py)).
- **The `housekeeping` Cognito role does NOT log into the SPA day-to-day.** Day-of-work housekeepers use the public static form. The authenticated `housekeeping` role exists only so a property-pinned manager could log in as a backup — that's why its tabs allowlist is minimal.
