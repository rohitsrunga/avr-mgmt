# AVR Management — Hotel Operations Platform

## Claude Code Project Brief

Build a complete, production-ready hotel operations web application for AVR Management (Saish LLC). The app runs on AWS serverless infrastructure and serves as a centralized platform for hotel staff across three properties. Deploy everything with AWS SAM/CDK, connect to the Cloudbeds PMS API, and deliver a polished React frontend.

---

## 1. Business Context

### Company Structure

- **Entity**: Saish LLC (DBA AVR Management)
- **Owners**: Rohit Srungavarapu, Abhijit Srungavarapu, Vasu Danda
- **Properties**:
  - **Casco Bay Hotel** — South Portland, ME (Choice Hotels Ascend Collection). Currently operational, uses Cloudbeds as PMS.
  - **Saco Bay Hotel** — Saco, ME (independent, formerly Ramada by Wyndham). Currently operational, uses Cloudbeds as PMS. Recently rebranded.
  - **TownePlace Suites / Fairfield Inn & Suites** — Saco, ME (Marriott dual-brand). Under construction. Will be added to the app later.
- **Staff Roles**: Front desk (3 shifts), housekeeping, groundsman, breakfast staff, ownership/management.
- **Key Programs**: MEPS military lodging contract (Casco Bay Hotel), Park & Fly airport parking program (Casco Bay Hotel).

### What This App Replaces

Currently, all of the following are managed on **printed paper sheets and handwritten notes**:
- Shift task checklists for all 3 shifts
- Dinner menu and prep instructions
- Breakfast inventory tracking (food, beverages, paper/plastic supplies)
- Housekeeping supply inventory
- Room amenity inventory (soap, shampoo, K-cups, etc.)
- Front desk office supply inventory
- Weekly linen/towel counts
- Room-by-room equipment audit (Keurig, iron, microwave, fridge, etc.)
- Breakfast cleanup checklist
- Groundsman daily checklist
- Park & Fly vehicle tracking and billing
- Credit card release forms
- Shift handoff notes

The goal is to digitize ALL of this into a single web app that staff can access from any device — phone, tablet, or desktop at the front desk.

---

## 2. Architecture

### AWS Services (Serverless — target $0–2/mo)

```
Users (Browser/Mobile)
    │
    ▼
CloudFront + S3  ─── React SPA (static hosting)
    │
    ▼
API Gateway (HTTP API)  ─── Cognito Authorizer (JWT validation)
    │
    ▼
Lambda Functions (Python 3.12)
    │
    ├── /shifts     ─── Shift task management, handoff notes
    ├── /inventory  ─── Stock tracking, reorder alerts
    ├── /checklists ─── Breakfast, grounds, custom checklists
    ├── /rooms      ─── Room equipment audit, maintenance flags
    ├── /parkfly    ─── Park & Fly vehicle log and billing
    ├── /reports    ─── Revenue, occupancy, ADR from cached Cloudbeds data
    └── /sync       ─── Scheduled Cloudbeds data pull (EventBridge trigger)
    │
    ▼
DynamoDB (7 tables)  +  Secrets Manager (Cloudbeds OAuth tokens)
    │
    ▼
External: Cloudbeds API (OAuth 2.0)
```

### Infrastructure as Code

Use **AWS SAM** (template.yaml) for all infrastructure. The entire stack should be deployable with a single `sam build && sam deploy`.

Include:
- S3 bucket + CloudFront distribution for frontend
- Cognito User Pool + App Client
- API Gateway HTTP API with Cognito authorizer
- Lambda functions (Python, organized by domain)
- DynamoDB tables with on-demand capacity
- Secrets Manager secret for Cloudbeds credentials
- EventBridge rule for scheduled Cloudbeds sync (every 6 hours)
- IAM roles with least-privilege policies

### Cost Constraints

This is an internal tool for a small team (<10 users). The architecture MUST stay within AWS Free Tier for year 1 and under $2/mo after that. No NAT Gateway, no RDS, no ECS/EKS, no ALB. Lambda + DynamoDB + S3/CloudFront only.

---

## 3. Authentication & Authorization

### Cognito User Pool Setup

- **Sign-in**: Email + password
- **MFA**: Optional (TOTP), not required initially
- **Password policy**: Minimum 8 chars, require uppercase + number
- **Self-service signup**: DISABLED — admin creates accounts only

### Roles (Custom Cognito Attribute: `custom:role`)

| Role | Access |
|------|--------|
| `owner` | Everything. Full read/write. Reports. Multi-property view. User management. |
| `manager` | Everything except user management and financial reports. |
| `frontdesk` | Shift tasks, inventory, checklists, Park & Fly, room status. Read-only reports. |
| `housekeeping` | Checklists (their own), room equipment audit, linen counts. |
| `grounds` | Groundsman checklist only. |
| `breakfast` | Breakfast checklist, breakfast inventory only. |

### Authorization Logic

Every Lambda function checks the JWT `custom:role` claim. Implement a shared `auth.py` utility:

```python
def authorize(event, allowed_roles):
    claims = event['requestContext']['authorizer']['jwt']['claims']
    role = claims.get('custom:role', '')
    if role not in allowed_roles:
        return {'statusCode': 403, 'body': json.dumps({'error': 'Forbidden'})}
    return None  # Authorized
```

---

## 4. DynamoDB Table Schemas

### 4.1 ShiftTasks

Stores the master task list for each shift, plus daily completion records.

```
Table: ShiftTasks
PK: PROPERTY#<property_id>
SK: SHIFT#<1st|2nd|3rd>#TASK#<task_id>

Attributes:
- task_text (S): The task description
- category (S): Grouping (e.g., "Opening", "Dinner Prep", "MEPS", "Front Desk")
- sort_order (N): Display order within category
- is_template (BOOL): True for master templates, false for daily instances

GSI: DailyTasksIndex
PK: PROPERTY#<property_id>#DATE#<YYYY-MM-DD>
SK: SHIFT#<shift>#TASK#<task_id>
Attributes:
- completed (BOOL)
- completed_by (S): Staff name
- completed_at (S): ISO timestamp
- handoff_notes (S): Free-text notes for next shift
```

### Master Task Data (transcribed from operational meeting notes)

#### 1st Shift — 7:00 AM to 3:00 PM (Front Desk)

**Opening:**
1. Clock in
2. Cash count
3. Check messages from previous shift → triage

**Breakfast:**
4. Refill breakfast items
5. Breakfast cleanup: leftovers, wipe counters, put away stuff

**Front Desk:**
6. Handle checkouts (account posting)
7. CAN the room (after 11:00 AM)
8. Coordinate with housekeeping for opening rooms
9. Update departures
10. Coordinate with housekeeping/maintenance on checkout reviews/feedback

**Housekeeping Coordination:**
11. 11:00 AM – 3:00 PM (approx): Housekeeping cleans rooms
12. Pending — someone needs to assign rooms to housekeepers (manager)

**Check-in:**
13. Check in guests
14. If busy times: check with housekeeping on which rooms are clean, keep updating availability

**Inventory:**
15. If time: document inventory for breakfast (# of bananas left, # of croissants left, etc.) → communicate

**MEPS:**
16. Coordinate with housekeeping on MEPS room assignments (8–10 rooms, men & women separate floors)
17. MEPS rooms need to be done by 2 PM max (1 PM assignment target)
18. Make keys for MEPS rooms, give keys + brochures to liaison

**Handoff:**
19. Dinner prep begins (transition to 2nd shift)

#### 2nd Shift — 3:00 PM to 11:00 PM

**Dinner Menu Items:**
- Salad bags
- Mixed veggies
- Mac & cheese
- Tater tots / fries / potato wedge
- Sandwiches (buns): chicken tender, beef burger, veggie patty — with lettuce + cheese
- Hot dogs (buns + dogs)
- Other veggies/condiments: pickles, tomatoes, onions
- Croutons + dressing + chicken topping
- Cookies (dessert)
- Yogurt (dessert)
- Fruit (dessert)
- Drinks: water bottles, sodas

**Dinner Prep Order:**
1. Ninja Air Fryer: chicken tenders (read the bag for instructions)
2. Weave tray in the other toaster oven/air fryer (the one that is black): veggie patty, beef patty
3. Assemble burgers: lettuce, cheese, and burgers — half-wrap in foil
4. Cook hot dogs and assemble hot dogs (half-wrap in foil)
5. Microwave the following: Mac & cheese — 7 min, stir, 5 min
6. Air fry veggies
7. Air fry tater tots (in lobby air fryer)
8. Pour salad into bowl
9. Salad toppings: cut onion, tomatoes, pickles — put in bowl
10. Move X number of water bottles + soda to fridge in lobby eating area (note: by # of MEPS)
11. Set up fruit + cookies (they will be under the cabinet)
12. Bring yogurt from fridge

**Closing:**
13. 10 PM: Clean up / wrap up dinner
14. Print emergency reports: arrivals, in-house, vacant rooms, credit checks

#### 3rd Shift — 11:00 PM to 7:00 AM

1. Finish dinner clean up (if anything pending)
2. Print out leftover arrivals registration cards (approx. midnight)
3. Charge virtual cards (approx. 2 AM)
4. 3 AM: Night audit (day rolls over automatically in system)
5. Print out the departures
   - When someone checks out, cross the room off
   - So housekeeping knows which rooms to start cleaning
6. Breakfast Prep — MEPS: start at 3:00 AM
7. Breakfast Prep — Non-MEPS: start at 5:00 AM
   - Breakfast menu is the same, except MEPS get additional boiled eggs
8. Office inventory check (supplies)

### 4.2 Inventory

```
Table: Inventory
PK: PROPERTY#<property_id>
SK: CATEGORY#<category>#ITEM#<item_id>

Attributes:
- item_name (S)
- category (S): "breakfast_food", "breakfast_beverage", "breakfast_supply", "housekeeping", "amenity", "front_desk"
- current_stock (N)
- par_level (N): Target stock level
- unit (S): "each", "box", "case", "bag"
- last_updated (S): ISO timestamp
- updated_by (S): Staff name
- reorder_threshold (N): Percentage of par that triggers alert (default 30%)
```

#### Breakfast Inventory Items (from printed sheet)

**Food Items:**
Apples, Bananas, Yogurt, Danishes, Muffins, English muffins, Bagels, Bread, Waffle mix, Frosted Flakes, Cheerios, Fruit Loops, Raisin Bran, Oatmeal packets, Whole milk, 2% milk, Croissant, Egg patties, Sausage patties, Sausage links, French Toast, Honey Bun, Cream cheese, Oil, Butter, Peanut butter, Jellies, Syrup

**Coffee/Juice Items:**
Apple juice, Orange juice, Cranberry juice, Light roast, Medium roast, Dark roast, Green tea, Lipton (tea), Sugar, Hot chocolate, Sweeteners, Half & Half

**Paper/Plastic Items:**
Coffee cups, Juice cups, Waffle cups, Lids, Stirrers, Filter paper, Paper filter roll, Paper plates, Paper bowls, Knives, Forks, Spoons, Napkins, Paper towels, Food handling gloves, Non-stick spray

#### Housekeeping Inventory Items (from printed sheet)

Reg K-cups, Decaf K-cups, 2 ply toilet paper, Glass Cleaner, Furniture polisher, Stainless steel cleaner, Mr. Clean Magic Eraser, Disinfecting wipes, Bleach, Lemon Lift, Stain Blaster, Lysol, Lysol toilet gel, Gloves (M&L), Mop heads, Febreze, Fabuloso, Pine Sol, Ice bags, Bin liners, Garbage bags, Laundry bags, Tide pods, Dryer sheets

#### Amenity Inventory Items (from printed sheet)

Soap, Lotion, Shampoo, Conditioner, Hand sanitizer, Facial tissue, Toilet paper, Ice bucket, Toothpaste packs, K cups (reg), K cups (decaf), Stirrers, Coffee cups (room), Coffee cups (breakfast), Lids

Columns for amenity tracking: BACK In Use, All Closets Total, Total, Week 1 Total, Week 2 Total, Week 3 Total, Week 4 Total

#### Front Desk Office Supplies (from printed sheet)

Pens, Bic pens, Pencils, Sharpie, Printer Paper, Wite Out, Notepad, PostIt, Toner, Staples, Tape, Envelope (cash), Envelope (file), Elastic band, Keys, Key holders, AAA batteries, AA batteries

### 4.3 Checklists

```
Table: Checklists
PK: PROPERTY#<property_id>#DATE#<YYYY-MM-DD>
SK: LIST#<checklist_type>#ITEM#<item_index>

Attributes:
- task_text (S)
- completed (BOOL)
- staff_initials (S)
- completed_at (S): ISO timestamp
- notes (S): Optional notes
```

#### Breakfast Checklist Items (from "Property Breakfast Check List")

1. Take down breakfast.
2. Sweep and mop breakfast area.
3. Clean stains off the chairs in breakfast area.
4. Wash breakfast supplies, sweep and mop kitchen.
5. Sweep and mop lobby area and wipe down glass in lobby area.
6. Check breakfast list and make a note of the stocks we need or running low on.
7. Clean Public Bathrooms each day. (Make sure toilet bowls and urinals are clean, also replenish toilet paper and toilet towels).
8. Empty the towel bin in the gym area, put used towels in the laundry room and make sure water supply is accurate.
9. Turn off Coffee machine in the kitchen before leaving.
10. Put out fresh pot of coffee both regular and decaf before leaving.
11. Empty the Coffee machine grounds bin each day.

#### Groundsman Checklist Items (from "Property Groundman Check List")

1. Empty Trash inside and outside of the building (Morning and Evening).
2. Water Flowers twice daily (Morning and Evening).
3. Double check with front desk to make sure laundry facility is open at 9AM.
4. Check landscaping, make sure the lawn is in good upkeeping (Mow and blow when needed).
5. Check all surrounding areas to make sure it's free from trash, litter, debris and weed.
6. Pick up trash and cigarette buds outside.
7. Pull Weeds that are growing wild.
8. Make sure the gravels/loose stones are swept out of the walking area at the front entrance.
9. Inspect the dumpster gate and lock to make sure they are in good condition.
10. Check meter reading outside.
11. Walk the floors to make sure all trash/Garbage are cleared from guest door and luggage carts are brought down to the lobby area.

### 4.4 RoomEquipment

```
Table: RoomEquipment
PK: PROPERTY#<property_id>
SK: ROOM#<room_number>

Attributes:
- comforter_cover (S): "yes" | "no" | "note text"
- cabinet (S): "yes" | "old" | "no"
- ironing_board (S): "yes" | "no"
- iron_hanger (S): "yes" | "no"
- iron (S): "yes" | "no"
- luggage_rack (S): "yes" | "no"
- hangers (S): "X1" | "X2" | "X3" | "" (empty = none)
- microwave (S): "yes" | "no"
- fridge (S): "yes" | "no"
- ice_bucket (S): "yes" | "no"
- keurig (S): "yes" | "no"
- desk_chair (S): "yes" | "Chair" | "no"
- lounge_chair (S): "yes" | "Chair" | "no"
- hairdryer (S): "yes" | "no" | "Not Attached" | "Melting"
- soap_dish (S): "yes" | "no"
- last_audited (S): ISO timestamp
- audited_by (S): Staff name
- notes (S): Free text for any room-specific issues
```

#### Room Data (from printed room audit matrix — Casco Bay Hotel)

Rooms: 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 201, 202, 203, 204, 205

Notable issues flagged in the audit:
- Room 131: Hairdryer "Not Attached"
- Room 134: Hairdryer "Not Attached"
- Room 204: Hairdryer "Melting" — needs immediate replacement
- Room 205: Hairdryer "Not Attached"
- Multiple rooms missing luggage racks
- Room 113: Missing most equipment (comforter cover, cabinet, ironing board, iron, microwave, fridge, ice bucket, Keurig)

### 4.5 LinenCounts

```
Table: LinenCounts
PK: PROPERTY#<property_id>#MONTH#<YYYY-MM>
SK: ITEM#<linen_type>#WEEK#<week_number>

Attributes:
- count (N)
- counted_by (S)
- counted_at (S): ISO timestamp
```

#### Linen Items (from "Casco Bay Hotel Jan - 2024" linen tracking sheet)

**Towels:** Bath, Hand, Wash, Mats
**Bedding:** Pillowcase, Pillow covers, King fitted, King flat, Queen fitted, Queen flat, Blankets, Mattress protectors

Tracked weekly: Week 1, Week 2, Week 3, Week 4

### 4.6 ParkAndFly

```
Table: ParkAndFly
PK: PROPERTY#<property_id>
SK: VEHICLE#<vehicle_id>

Attributes:
- guest_name (S)
- phone (S)
- check_in (S): ISO date
- check_out (S): ISO date
- vehicle_make_model (S)
- license_plate (S)
- parking_days (N)
- total_fee (N): parking_days × 10
- tag_number (S): "PF-001" format
- staff_name (S): Front desk staff who issued
- issued_at (S): ISO timestamp
- paid (BOOL)
- notes (S)

GSI: ActiveVehiclesIndex
PK: PROPERTY#<property_id>#STATUS#active
SK: check_out (for sorting by upcoming departures)
```

**Pricing**: $10 per night. Payment at check-in or in advance.

**Park & Fly Terms** (from printed agreement):
- Guests park in designated areas only. Additional charges for oversized vehicles.
- Guests must display Park & Fly Tag on dashboard at all times.
- Hotel not responsible for theft, damage, or loss.
- Vehicles left beyond 2 days without notice may be towed at owner's expense.
- Complimentary shuttle service to/from airport available.
- Extra fees for parking beyond reserved period.
- Front Desk contact: (207) 772-3838

### 4.7 CachedReports

```
Table: CachedReports
PK: PROPERTY#<property_id>
SK: REPORT#<report_type>#DATE#<YYYY-MM-DD>

Attributes:
- data (M): Map containing report-specific fields
- synced_at (S): ISO timestamp
- source (S): "cloudbeds"

Report types:
- "daily_stats" → occupancy_pct, adr, revpar, total_revenue, rooms_sold, rooms_available
- "reservations" → arriving_today, departing_today, in_house, no_shows
- "monthly_summary" → monthly aggregates of the above
```

---

## 5. Cloudbeds Integration

### OAuth 2.0 Flow

Cloudbeds uses OAuth 2.0 Authorization Code flow.

1. **Initial setup** (one-time, manual): Register an app in the Cloudbeds developer portal. Get client_id and client_secret. Perform the OAuth authorization flow manually to get the initial refresh_token.
2. **Store in Secrets Manager**: Store client_id, client_secret, and refresh_token per property as a single JSON secret.
3. **Token rotation**: The sync Lambda refreshes the access_token using the refresh_token before each sync. If the refresh_token is also rotated, update Secrets Manager.

### Sync Lambda (EventBridge — every 6 hours)

```python
# Pseudocode for sync logic
def handler(event, context):
    for property_id in ['casco_bay', 'saco_bay']:
        # 1. Get credentials from Secrets Manager
        creds = get_secret(f'avr/{property_id}/cloudbeds')

        # 2. Refresh access token
        access_token = refresh_oauth_token(creds)

        # 3. Pull data from Cloudbeds API
        reservations = cloudbeds_get('/v1.1/getReservations', access_token)
        dashboard = cloudbeds_get('/v1.1/getDashboard', access_token)
        transactions = cloudbeds_get('/v1.1/getTransactions', access_token)

        # 4. Transform and cache in DynamoDB
        cache_daily_stats(property_id, dashboard)
        cache_reservations(property_id, reservations)
        cache_revenue(property_id, transactions)
```

### Key Cloudbeds API Endpoints to Integrate

| Endpoint | Data | Use |
|----------|------|-----|
| `GET /v1.1/getDashboard` | Occupancy, ADR, RevPAR, rooms available | Overview dashboard metrics |
| `GET /v1.1/getReservations` | Reservation list with status, dates, guest info | Arrivals/departures, in-house count |
| `GET /v1.1/getTransactions` | Revenue transactions | Revenue reports, monthly summaries |
| `GET /v1.1/getHousekeepingStatus` | Room cleaning status | Room status board (clean/dirty/inspected) |
| `GET /v1.1/getRooms` | Room list with types | Room inventory baseline |
| `GET /v1.1/getGuests` | Guest details | MEPS guest identification |

### Error Handling

- If Cloudbeds returns 401, attempt token refresh. If refresh fails, log error and alert (write to DynamoDB error log).
- If Cloudbeds is down, serve stale cached data. Show "last synced: X hours ago" in the UI.
- Rate limit: Cloudbeds allows 200 requests per minute. The sync Lambda should batch and throttle.

---

## 6. Frontend Specification

### Tech Stack

- **React 18** (Vite or Create React App)
- **React Router v6** for navigation
- **Recharts** for charts/graphs
- **AWS Amplify Libraries** (or raw `amazon-cognito-identity-js`) for auth
- **Tailwind CSS** for styling (utility-first, dark theme)
- Deploy as static build to S3 + CloudFront

### Design System

**Theme**: Dark, professional, utilitarian. Think "hotel operations command center" not "consumer SaaS."

**Color palette**:
- Background: `#0c1017` (deepest), `#0f1520` (surfaces), `#141924` (cards)
- Borders: `#1a2235` (subtle), `#1e2a3a` (interactive)
- Text: `#e2e8f0` (primary), `#c8d2de` (body), `#8a96a8` (secondary), `#5a6778` (muted)
- Accents:
  - Teal `#2d8e72` — primary action, success, Casco Bay
  - Amber `#e8a838` — warnings, Saco Bay, 1st shift
  - Blue `#4a6fa5` — info, 3rd shift
  - Red `#e85d4a` — critical alerts, errors
  - Green (shifts) `#2d8e72` — 2nd shift

**Typography**:
- Display/headings: `Fraunces` (serif, Google Fonts)
- Body: `DM Sans` (sans-serif, Google Fonts)
- Mono/labels: `Courier Prime` (monospace, Google Fonts)

**Spacing**: 4px base grid. Cards have 16–20px padding. Sections separated by 24–28px.

### Page Structure

#### Header (persistent)
- AVR Management logo/mark (teal "A" badge)
- Property switcher (toggle: Casco Bay / Saco Bay)
- Current user name + role badge
- Logout button

#### Navigation (horizontal tabs)
Overview | Shifts | Inventory | Checklists | Rooms | Park & Fly | Reports

Tabs are role-filtered. Housekeeping only sees: Checklists, Rooms. Grounds only sees: Checklists. Breakfast only sees: Checklists, Inventory.

#### Page: Overview (Dashboard)
- Property name + "Today's snapshot" subtitle
- 4 metric cards: Occupancy %, ADR, RevPAR, Arrivals Today
- 2-column layout:
  - Left: Shift progress widget (shows current shift's task completion %, with shift toggle)
  - Right: Low stock alerts (top 5 items below reorder threshold, with click-through to Inventory)
- Bottom: Occupancy trend line chart (12 months, both properties overlaid)

#### Page: Shifts
- Shift selector (1st / 2nd / 3rd) with time ranges and color-coded buttons
- Progress bar showing X of Y tasks complete
- Task list grouped by category (Opening, Breakfast, Front Desk, Dinner Prep, MEPS, Closing, etc.)
- Each task: tap-to-complete checkbox with checkmark animation
- Completed tasks: strikethrough + dimmed text
- Bottom: Handoff notes textarea (persisted per shift per day)
- Staff can only complete tasks for the current shift (based on time of day) unless role is owner/manager

#### Page: Inventory
- Sub-tabs: Breakfast | Housekeeping | Amenities | Office
- Table layout: Item name | Category | Stock / Par (visual bar + numeric)
- Visual stock bars: green (>60%), amber (30–60%), red (<30%)
- Critical items (<20%) get red background highlight
- Inline editing: tap stock number to update count
- "Last updated by [name] at [time]" per item
- Export/print button for ordering

#### Page: Checklists
- Sub-tabs: Breakfast Cleanup | Groundsman | (extensible for custom checklists)
- Date picker (defaults to today)
- Task list: tap-to-complete, records staff initials + timestamp
- Completion percentage at top
- Notes field at bottom
- Historical view: select past dates to review completed checklists

#### Page: Rooms (Equipment Audit)
- Scrollable table: rows = rooms, columns = equipment items
- Cell states: ✓ (green), — (gray/missing), text note (amber), alert text (red)
- Click a room row to expand detail view with notes and last-audited date
- "Flag issue" button per room opens a quick note modal
- Filter: "Show rooms with issues" toggle

#### Page: Park & Fly
- Card layout: one card per active vehicle
- Card shows: guest name, vehicle make/model, plate, tag #, dates, total fee, paid/unpaid badge
- "New vehicle" button opens form:
  - Guest name, phone, check-in date, check-out date
  - Vehicle make/model, license plate
  - Auto-calculates: # nights, total fee ($10 × nights)
  - Auto-assigns tag number (sequential PF-XXX)
- Mark as paid button
- Archive view for past vehicles

#### Page: Reports (Owner/Manager only)
- 4 metric cards: YTD Revenue, Avg ADR (90-day), Avg Occupancy (90-day), RevPAR
- Bar chart: Monthly revenue by property (Casco Bay teal, Saco Bay amber)
- Line chart: Occupancy trend (12 months, both properties)
- "Last synced from Cloudbeds: [timestamp]" indicator
- Data from CachedReports DynamoDB table (populated by sync Lambda)

---

## 7. API Routes

All routes are behind API Gateway with Cognito JWT authorizer.

### Shifts

```
GET    /api/shifts/{property_id}/tasks?shift=1st&date=2025-05-04
POST   /api/shifts/{property_id}/tasks/{task_id}/complete
POST   /api/shifts/{property_id}/handoff
GET    /api/shifts/{property_id}/handoff?shift=1st&date=2025-05-04
```

### Inventory

```
GET    /api/inventory/{property_id}?category=breakfast_food
PUT    /api/inventory/{property_id}/items/{item_id}    (update stock count)
GET    /api/inventory/{property_id}/alerts              (low stock items)
```

### Checklists

```
GET    /api/checklists/{property_id}?type=breakfast&date=2025-05-04
POST   /api/checklists/{property_id}/items/{item_index}/complete
```

### Rooms

```
GET    /api/rooms/{property_id}
PUT    /api/rooms/{property_id}/{room_number}           (update equipment status)
GET    /api/rooms/{property_id}/issues                  (rooms with flagged issues)
```

### Park & Fly

```
GET    /api/parkfly/{property_id}?status=active
POST   /api/parkfly/{property_id}                       (new vehicle)
PUT    /api/parkfly/{property_id}/{vehicle_id}           (update, mark paid)
GET    /api/parkfly/{property_id}/archive
```

### Reports

```
GET    /api/reports/{property_id}/dashboard              (today's metrics)
GET    /api/reports/{property_id}/occupancy?period=12m
GET    /api/reports/{property_id}/revenue?period=12m
GET    /api/reports/sync-status                          (last sync timestamp)
```

### Auth / Admin

```
POST   /api/admin/users                                  (create user — owner only)
GET    /api/admin/users                                  (list users — owner only)
DELETE /api/admin/users/{user_id}                         (remove user — owner only)
```

---

## 8. Project Structure

```
avr-hotel-ops/
├── README.md
├── template.yaml                    # AWS SAM template
├── samconfig.toml                   # SAM deploy config
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── auth/
│       │   ├── AuthProvider.jsx      # Cognito context
│       │   ├── LoginPage.jsx
│       │   └── ProtectedRoute.jsx
│       ├── components/
│       │   ├── Header.jsx
│       │   ├── NavTabs.jsx
│       │   ├── MetricCard.jsx
│       │   ├── StockBar.jsx
│       │   ├── TaskCheckbox.jsx
│       │   └── PropertySwitcher.jsx
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── Shifts.jsx
│       │   ├── Inventory.jsx
│       │   ├── Checklists.jsx
│       │   ├── Rooms.jsx
│       │   ├── ParkFly.jsx
│       │   └── Reports.jsx
│       ├── hooks/
│       │   ├── useApi.js             # Fetch wrapper with auth headers
│       │   └── useProperty.js        # Property context
│       └── utils/
│           └── api.js                # API base URL + helpers
│
├── backend/
│   ├── requirements.txt
│   ├── shared/
│   │   ├── auth.py                   # JWT role validation
│   │   ├── dynamo.py                 # DynamoDB helpers
│   │   └── response.py              # Standard HTTP response builders
│   ├── shifts/
│   │   └── handler.py
│   ├── inventory/
│   │   └── handler.py
│   ├── checklists/
│   │   └── handler.py
│   ├── rooms/
│   │   └── handler.py
│   ├── parkfly/
│   │   └── handler.py
│   ├── reports/
│   │   └── handler.py
│   ├── sync/
│   │   └── handler.py               # Cloudbeds sync (EventBridge)
│   └── admin/
│       └── handler.py               # User management
│
├── scripts/
│   ├── seed_data.py                  # Populate DynamoDB with initial data
│   ├── setup_cognito.py              # Create initial admin user
│   └── cloudbeds_oauth_setup.py      # One-time OAuth flow helper
│
└── tests/
    ├── test_shifts.py
    ├── test_inventory.py
    └── test_auth.py
```

---

## 9. Seed Data Script

The `scripts/seed_data.py` must populate:

1. **ShiftTasks** — all master task templates for all 3 shifts (from Section 4.1 above)
2. **Inventory** — all items with initial par levels (from Section 4.2 above). Stock values start at 0 (staff will do first count).
3. **Checklists** — breakfast and groundsman master templates (from Section 4.3 above)
4. **RoomEquipment** — all rooms with current audit data (from Section 4.4 above)
5. **LinenCounts** — linen item templates (from Section 4.5 above)

Set `property_id = "casco_bay"` for all initial data. Saco Bay will be configured after launch.

---

## 10. Deployment Steps

1. `cd frontend && npm install && npm run build`
2. `cd .. && sam build`
3. `sam deploy --guided` (first time) or `sam deploy` (subsequent)
4. Upload `frontend/dist/` to the S3 bucket created by SAM
5. Run `python scripts/seed_data.py` to populate DynamoDB
6. Run `python scripts/setup_cognito.py` to create the first admin user (Rohit)
7. Manually complete Cloudbeds OAuth setup using `scripts/cloudbeds_oauth_setup.py`
8. Verify CloudFront distribution URL works

---

## 11. Implementation Order

Build in this sequence for fastest time to usable:

**Phase 1 — Core Infrastructure**
1. SAM template (Cognito, API Gateway, DynamoDB tables, Lambda stubs, S3/CloudFront)
2. Auth flow (login page, Cognito integration, JWT handling)
3. Seed data script

**Phase 2 — Operational Features (no external API needed)**
4. Shifts page (task list, completion, handoff notes)
5. Inventory page (stock tracking, par levels, alerts)
6. Checklists page (breakfast, groundsman)
7. Rooms page (equipment audit table)
8. Park & Fly page (vehicle log, billing)

**Phase 3 — Cloudbeds Integration**
9. OAuth token management + Secrets Manager setup
10. Sync Lambda (EventBridge scheduled)
11. Reports/Dashboard page with live Cloudbeds data

**Phase 4 — Polish**
12. Role-based tab filtering
13. Mobile responsive refinement
14. Admin user management page
15. Error handling, loading states, offline indicators

---

## 12. Testing Checklist

Before considering the app complete:

- [ ] Login works with Cognito (email + password)
- [ ] Property switcher toggles between Casco Bay and Saco Bay
- [ ] All 3 shift task lists load with correct tasks
- [ ] Tapping a task marks it complete with timestamp + user name
- [ ] Handoff notes save and persist across page reloads
- [ ] Inventory items display with correct stock bars
- [ ] Stock can be updated inline
- [ ] Low stock alerts appear on dashboard for items below threshold
- [ ] Breakfast checklist can be completed with staff initials
- [ ] Groundsman checklist can be completed with staff initials
- [ ] Room equipment table shows all rooms with correct status
- [ ] Room issues (Melting, Not Attached) display in red
- [ ] Park & Fly: can add new vehicle with auto-calculated fee
- [ ] Park & Fly: can mark vehicle as paid
- [ ] Reports page shows charts (mock data initially, Cloudbeds when connected)
- [ ] Role-based access works (frontdesk can't see Reports, grounds can only see Checklists)
- [ ] Mobile layout is usable on phone-sized screens
- [ ] SAM deploys cleanly with `sam build && sam deploy`
- [ ] CloudFront serves the frontend over HTTPS

---

## 13. Notes for Claude Code

- Use Python 3.12 for all Lambda functions. Keep dependencies minimal (boto3 is included in Lambda runtime).
- Use `powertools-lambda-python` for logging and tracing if you want, but it's not required.
- Every Lambda handler should return proper CORS headers since the frontend is on a different origin (CloudFront → API Gateway).
- DynamoDB operations should use `boto3.resource('dynamodb')` for cleaner code. Use `batch_write_item` in the seed script.
- The frontend should handle offline/stale gracefully — if an API call fails, show the last known data with a "connection issue" banner.
- Keep the SAM template as a single `template.yaml` — don't split into nested stacks for this scale.
- For the Cloudbeds OAuth setup script, create an interactive CLI that opens the browser for the authorization code flow, then stores the tokens in Secrets Manager.
- All DynamoDB table names should use a stack-name prefix to avoid collisions. Reference them via Lambda environment variables, not hardcoded strings.
