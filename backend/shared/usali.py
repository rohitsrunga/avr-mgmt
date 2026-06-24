"""USALI P&L mapping + helpers — single source of truth for line items,
departments, forecast drivers, the QuickBooks-report parser, and the
departmental GOP waterfall.

Ported from scripts/qb_budget_templates.py (the canonical account mapping) so
the ingestion script, the finance Lambda, and the SPA all agree on the same
line items and roll-ups. Keep the ACCOUNTS table here authoritative; the
budget-template generator can import from this module.

Granularity mirrors data/budget_templates/02_expense_usali_pnl.csv:

    REVENUE
      Rooms / Other Operated
    EXPENSE: <departmental>            -> Departmental Profit
    EXPENSE: <undistributed>          -> Gross Operating Profit (GOP)
    EXPENSE: Fixed Charges            -> EBITDA
    MEMO: Pass-through, Capital/One-off (excluded from run-rate)
"""

# Account mapping. Each tuple:
#   (qb_account, usali_dept, cost_behavior, controllable, forecast_driver)
# forecast_driver: %rev | per_room | fixed | seasonal | project
#
# NOTE on QB-report depth: most keys below are leaf "Data" accounts, but a few
# are *Section parents* whose subtotal we want (Auto Expenses, Payroll
# Expenses, Insurance, Repairs & Maintenance, Travel). The walker matches a
# name at whatever depth it appears and does NOT descend past a matched node,
# so "Shift4 Fees" (a leaf under the unmapped "Bank Charges & Fees" parent) and
# "Auto Expenses" (a parent with Fuel/Repair children) both resolve correctly.
ACCOUNTS = [
    ("Hotel Supplies",             "Rooms",                "Variable",      True,  "per_room"),
    ("Guest Services",             "Rooms",                "Variable",      True,  "per_room"),
    ("Uniforms",                   "Rooms",                "Variable",      True,  "per_room"),
    ("Commission Expense",         "Rooms (OTA)",          "Variable",      False, "%rev"),
    ("Payroll Expenses",           "Labor (multi)",        "Semi-Variable", True,  "seasonal"),
    ("Advertising",                "Sales & Marketing",    "Semi-Variable", True,  "seasonal"),
    ("Advertising & Marketing",    "Sales & Marketing",    "Semi-Variable", True,  "seasonal"),
    ("Franchise & Royalty Fees",   "Sales & Marketing",    "Variable",      False, "%rev"),
    ("Shift4 Fees",                "A&G",                  "Variable",      False, "%rev"),
    ("Credit Card Fees",           "A&G",                  "Variable",      False, "%rev"),
    ("Professional Services",      "A&G",                  "Fixed",         True,  "fixed"),
    ("Dues & Subscriptions",       "A&G",                  "Fixed",         True,  "fixed"),
    ("Office Supplies & Software", "A&G",                  "Fixed",         True,  "fixed"),
    ("Meals & Entertainment",      "A&G",                  "Variable",      True,  "fixed"),
    ("Postage & Delivery",         "A&G",                  "Fixed",         True,  "fixed"),
    ("Travel",                     "A&G",                  "Variable",      True,  "fixed"),
    ("Miscellaneous",              "A&G",                  "Variable",      True,  "fixed"),
    ("Repairs & Maintenance",      "Property Ops & Maint", "Semi-Variable", True,  "seasonal"),
    ("Auto Expenses",              "Property Ops & Maint", "Semi-Variable", True,  "seasonal"),
    ("Trash Removal",              "Property Ops & Maint", "Fixed",         False, "fixed"),
    ("Electricity",                "Utilities",            "Semi-Variable", True,  "seasonal"),
    ("Heat",                       "Utilities",            "Semi-Variable", True,  "seasonal"),
    ("Water",                      "Utilities",            "Semi-Variable", True,  "seasonal"),
    ("Internet",                   "Utilities",            "Fixed",         True,  "fixed"),
    ("Telephone",                  "Utilities",            "Fixed",         True,  "fixed"),
    ("Direct TV",                  "Utilities",            "Fixed",         True,  "fixed"),
    ("Rent & Lease",               "Fixed Charges",        "Fixed",         False, "fixed"),
    ("Insurance",                  "Fixed Charges",        "Fixed",         False, "fixed"),
    ("Property Taxes",             "Fixed Charges",        "Fixed",         False, "fixed"),
    ("Interest Paid - Credit Cards", "Fixed Charges",      "Fixed",         False, "fixed"),
    ("Sales Tax Paid",             "Pass-through",         "Variable",      False, "%rev"),
    ("Architect",                  "Capital / One-off",    "One-off",       False, "project"),
    ("Legal",                      "Capital / One-off",    "One-off",       False, "project"),
    # A synthetic "— other" line absorbs direct postings made to a QB *section
    # parent* (e.g. "Utilities") that aren't itemized under a named child, so
    # mapped totals reconcile exactly to QB. Kept in the parent's department
    # (never the Capital/memo block) so EBITDA isn't overstated. See
    # PARENT_RESIDUAL and walk_qb_report.
    ("Utilities — other",          "Utilities",            "Semi-Variable", True,  "seasonal"),
]

# Unmapped QB section parent name -> the ACCOUNTS key its direct-posting
# residual (section total minus the sum of its mapped children) is routed to.
# Anything not listed falls through to the `unmapped` catch-all.
PARENT_RESIDUAL = {
    "Utilities": "Utilities — other",
    "Bank Charges & Fees": "Credit Card Fees",
    "Legal & Professional Services": "Professional Services",
}

# Alternate QB account names → a canonical ACCOUNTS key. The two entities keep
# different charts of accounts (Casco/NGH vs Saco/NHM), so this folds both into
# the same USALI lines. A matched name (or section parent) is consumed whole and
# not descended into, exactly like a direct ACCOUNTS match.
ALIASES = {
    # Rent
    "Rent": "Rent & Lease",
    "Blueberry Realty LLC Rent": "Rent & Lease",
    # Insurance / benefits
    "Insurance Expense": "Insurance",
    "Health Insurance": "Payroll Expenses",
    # Property / real-estate taxes
    "Real Estate Taxes": "Property Taxes",
    "Personal Property Taxes": "Property Taxes",
    # Franchise
    "Royalty Fee": "Franchise & Royalty Fees",
    "Franchise Fee": "Franchise & Royalty Fees",
    # Card processing / bank / finance charges
    "Credit Card Processing": "Credit Card Fees",
    "Visa Fees": "Credit Card Fees",
    "Bank Service Charges": "Credit Card Fees",
    "Finance Charges": "Interest Paid - Credit Cards",
    # Professional services
    "Professional Fees": "Professional Services",
    "Legal Fees": "Professional Services",
    "Consulting": "Professional Services",
    "Accounting": "Professional Services",
    "Accountant": "Professional Services",
    # Repairs / grounds / pool
    "Repairs and Maintenance": "Repairs & Maintenance",
    "Repairs": "Repairs & Maintenance",
    "Pool": "Repairs & Maintenance",
    "Grounds Maintenance": "Repairs & Maintenance",
    "Landscaping and Groundskeeping": "Repairs & Maintenance",
    "Cleaning": "Hotel Supplies",
    # Telephone / TV
    "Telephone Expense": "Telephone",
    "Cell Phone": "Telephone",
    "Cable": "Direct TV",
    # Trash
    "Waste Removal": "Trash Removal",
    # Office / dues / advertising / meals / travel / auto
    "Office Supplies": "Office Supplies & Software",
    "Software": "Office Supplies & Software",
    "Computer Repairs": "Office Supplies & Software",
    "Dues and Subscriptions": "Dues & Subscriptions",
    "Business Licenses and Permits": "Dues & Subscriptions",
    "Fees & Licenses": "Dues & Subscriptions",
    "Taxes & Licenses": "Dues & Subscriptions",
    "Permits": "Dues & Subscriptions",
    "Advertising and Promotion": "Advertising",
    "Meals": "Meals & Entertainment",
    "Gifts": "Meals & Entertainment",
    "Travel Expenses": "Travel",
    "Tolls": "Travel",
    "Fuel": "Auto Expenses",
    "Registration": "Auto Expenses",
    "Company Vehicle": "Auto Expenses",
    # Labor
    "Casual Labor": "Payroll Expenses",
    "Staff Expense": "Payroll Expenses",
    # Guest amenities
    "Continental Breakfast": "Hotel Supplies",
    # A&G miscellany
    "Recruitment": "Miscellaneous",
    "Personal": "Miscellaneous",
    "Contributions": "Miscellaneous",
    "Security": "Miscellaneous",
    "Charging": "Miscellaneous",
}

# Treat sub-cent gaps as fully reconciled.
EPS = 0.005

# Revenue accounts (QB names) and which revenue bucket they roll into. The two
# entities name room revenue differently — Casco/NGH "Room Rental Income",
# Saco/NHM "Lodging Sales" — so both are listed. A matched revenue section is
# consumed whole (its Chargeback(s) child is netted in).
REVENUE_ACCOUNTS = {
    "Room Rental Income": "room",   # Casco / NGH
    "Lodging Sales": "room",        # Saco / NHM
    "Square Income": "other",
}

DRIVER_LABEL = {
    "%rev": "% of room revenue",
    "per_room": "per occupied room (POR)",
    "fixed": "fixed monthly",
    "seasonal": "seasonal index",
    "project": "project / one-off (excluded from run-rate)",
}

# Departmental waterfall ordering.
DEPARTMENTAL = ("Rooms", "Rooms (OTA)", "Labor (multi)")
UNDISTRIBUTED = ("Sales & Marketing", "A&G", "Property Ops & Maint", "Utilities")
FIXED = ("Fixed Charges",)
MEMO = ("Pass-through", "Capital / One-off")
DEPT_ORDER = list(DEPARTMENTAL) + list(UNDISTRIBUTED) + list(FIXED) + list(MEMO)

# Stable per-account key used in DynamoDB items and the API (the QB name).
ACCOUNT_KEYS = [a[0] for a in ACCOUNTS]
_BY_KEY = {a[0]: a for a in ACCOUNTS}


def account_meta(key):
    """(qb_account, dept, behavior, controllable, driver) for a known key."""
    return _BY_KEY.get(key)


def _canon_line(name):
    """Canonical expense ACCOUNTS key for a QB account name (direct match or
    ALIASES); None if it isn't an expense line."""
    if name in _BY_KEY:
        return name
    alias = ALIASES.get(name)
    return alias if alias in _BY_KEY else None


# One canonical key per revenue bucket, so both charts' room-revenue accounts
# ("Room Rental Income" and Saco's "Lodging Sales") and the frontend's Rooms
# line all key name detail under the same string.
_REVENUE_CANONICAL = {"room": "Room Rental Income", "other": "Square Income"}


def _canon_rev(name):
    """Canonical per-bucket revenue key for a QB revenue account name; None if
    not revenue. 'Lodging Sales' and 'Room Rental Income' both → 'Room Rental
    Income' so name detail lands under the single key the Rooms line reads."""
    bucket = REVENUE_ACCOUNTS.get(name)
    return _REVENUE_CANONICAL.get(bucket) if bucket else None


def resolve_account_key(account_name, fqn_map=None):
    """Map a QuickBooks General-Ledger account section to the P&L line key it
    rolls into — the same level walk_qb_report consumes at.

    GL sections are flat leaf names (e.g. "Fuel", "Workers Comp"), so an
    optional `fqn_map` ({account_name: "Parent:Child"} from the Account entity)
    restores the hierarchy. The first ancestor (top→leaf) that is a mapping key
    wins ("Auto Expenses:Fuel" → "Auto Expenses"; "Utilities:Electricity" →
    "Electricity"). A posting made directly to an unmapped parent that carries
    a residual line (Utilities / Bank Charges & Fees / Legal & Professional
    Services) routes to that parent's synthetic "— other" key. Anything else
    (balance-sheet accounts, unmapped expenses) returns None.
    """
    if not account_name:
        return None
    fqn = (fqn_map or {}).get(account_name, account_name)
    parts = [p.strip() for p in fqn.split(":")]
    for part in parts:
        key = _canon_line(part) or _canon_rev(part)
        if key:
            return key
    for part in parts:
        if part in PARENT_RESIDUAL:
            return PARENT_RESIDUAL[part]
    return None


def dept_of(key):
    meta = _BY_KEY.get(key)
    return meta[1] if meta else None


def driver_of(key):
    meta = _BY_KEY.get(key)
    return meta[4] if meta else None


def accounts_in_dept(dept):
    """Account keys in a department, preserving ACCOUNTS order."""
    return [a[0] for a in ACCOUNTS if a[1] == dept]


# Maine coastal seasonality: share of annual room-revenue by month (sums to
# ~1.00). Default used until a property has >=12 months of actuals to derive
# its own index. Keyed by 1-based month number.
DEFAULT_SEASON = {
    1: 0.03, 2: 0.03, 3: 0.04, 4: 0.06, 5: 0.09, 6: 0.12,
    7: 0.17, 8: 0.17, 9: 0.12, 10: 0.08, 11: 0.05, 12: 0.04,
}


# ------------------------------------------------------------------ QB parser
def _num(value):
    """Parse a QB ColData cell value to float; '' / None -> 0.0."""
    if value in (None, ""):
        return 0.0
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return 0.0


def _row_name(row):
    """A QB Row's display name lives either in Header.ColData[0] (Section) or
    ColData[0] (Data)."""
    hdr = (row.get("Header") or {}).get("ColData")
    if hdr:
        return (hdr[0] or {}).get("value", "")
    cd = row.get("ColData")
    if cd:
        return (cd[0] or {}).get("value", "")
    return ""


def _row_amounts(row, n_periods):
    """Return the period amounts for a row as a list of length n_periods.

    For a Data row, ColData[1:] are the period values (last is the row total
    when multi-period; when n_periods==1 the single value is ColData[-1]).
    For a Section, the period values live in Summary.ColData[1:]."""
    cd = row.get("ColData")
    if not cd:
        summ = row.get("Summary") or {}
        cd = summ.get("ColData")
    if not cd:
        return [0.0] * n_periods
    vals = [_num(c.get("value")) for c in cd[1:]]
    if n_periods == 1:
        # Single-period reports carry one value (plus possibly a Total dup).
        return [vals[0] if vals else 0.0]
    # Multi-period: the trailing column is the row Total — drop it.
    if len(vals) == n_periods + 1:
        vals = vals[:n_periods]
    if len(vals) < n_periods:
        vals = vals + [0.0] * (n_periods - len(vals))
    return vals[:n_periods]


def _period_months(report):
    """Derive the YYYY-MM label for each data column from the report header.

    A ProfitAndLoss summarized by Month has one column per month; each column's
    metadata carries a StartDate we can slice to YYYY-MM. Falls back to a
    single period keyed by the report's StartPeriod."""
    cols = ((report.get("Columns") or {}).get("Column")) or []
    months = []
    for c in cols:
        meta = {m.get("Name"): m.get("Value") for m in (c.get("MetaData") or [])}
        start = meta.get("StartDate") or meta.get("EndDate")
        if start and len(start) >= 7:
            months.append(start[:7])
    if not months:
        sp = (report.get("Header") or {}).get("StartPeriod", "")
        months = [sp[:7]] if sp else ["unknown"]
    return months


def walk_qb_report(report):
    """Map a QuickBooks ProfitAndLoss report (summarized by Month or Total)
    into per-month USALI buckets.

    Returns {month: {"lines": {account_key: amt, ...},
                     "room_revenue": x, "other_revenue": y,
                     "unmapped": {qb_name: amt, ...}}}
    where month is 'YYYY-MM'. Direct postings to an unmapped QB *section parent*
    (its total minus the sum of its children) are routed to a synthetic
    "— other" line via PARENT_RESIDUAL so departmental totals stay accurate;
    anything still unrecognised lands in `unmapped` so the grand total
    reconciles to QB and nothing drops silently.

    Each visit() returns the per-period amount list it accounted for, so a
    section can reconcile its authoritative summary against its children.
    """
    months = _period_months(report)
    n = len(months)
    out = {
        m: {"lines": {}, "room_revenue": 0.0, "other_revenue": 0.0, "unmapped": {}}
        for m in months
    }
    zero = [0.0] * n

    def add_line(key, amounts):
        for i, m in enumerate(months):
            out[m]["lines"][key] = out[m]["lines"].get(key, 0.0) + amounts[i]

    def add_revenue(bucket, amounts):
        field = "room_revenue" if bucket == "room" else "other_revenue"
        for i, m in enumerate(months):
            out[m][field] += amounts[i]

    def add_unmapped(name, amounts):
        for i, m in enumerate(months):
            if abs(amounts[i]) > EPS:
                out[m]["unmapped"][name] = out[m]["unmapped"].get(name, 0.0) + amounts[i]

    def visit(row, in_revenue):
        """Return the per-period amounts this row accounted for."""
        name = _row_name(row)
        # A matched mapping/revenue node (direct or aliased) is consumed whole —
        # do not descend.
        key = _canon_line(name)
        if key:
            amts = _row_amounts(row, n)
            add_line(key, amts)
            return amts
        rk = _canon_rev(name)
        if rk:
            amts = _row_amounts(row, n)
            add_revenue(REVENUE_ACCOUNTS[rk], amts)
            return amts

        children = (row.get("Rows") or {}).get("Row")
        if children:
            section = (row.get("group") or "").lower()
            rev_ctx = in_revenue or section == "income"
            sec_amts = _row_amounts(row, n)  # authoritative section total
            child_sum = list(zero)
            for child in children:
                ca = visit(child, rev_ctx)
                child_sum = [child_sum[i] + ca[i] for i in range(n)]
            residual = [sec_amts[i] - child_sum[i] for i in range(n)]
            if any(abs(r) > EPS for r in residual):
                if name in PARENT_RESIDUAL:
                    add_line(PARENT_RESIDUAL[name], residual)
                elif rev_ctx:
                    add_revenue("other", residual)
                else:
                    add_unmapped(f"{name} (other)" if name else "(unnamed)", residual)
            return sec_amts

        if row.get("ColData"):
            # Leaf with no mapping match.
            amts = _row_amounts(row, n)
            if in_revenue:
                add_revenue("other", amts)
            else:
                add_unmapped(name or "(unnamed)", amts)
            return amts

        # Summary-only rows (GrossProfit / NetIncome / …) — ignore.
        return list(zero)

    for row in ((report.get("Rows") or {}).get("Row")) or []:
        visit(row, False)
    return out


# ------------------------------------------------------------------ waterfall
def build_waterfall(lines, revenue):
    """Assemble the ordered departmental GOP waterfall for one period.

    `lines`   : {account_key: amount}
    `revenue` : {"room": x, "other": y}
    Returns a list of row dicts in display order, each:
        {kind, label, dept, level, driver, amount}
    kind ∈ {revenue, revenue_line, expense_header, expense_line,
            subtotal, memo_header, memo_line}
    plus the computed subtotals (Departmental Profit, GOP, EBITDA).
    """
    def line_amt(key):
        return float(lines.get(key, 0.0) or 0.0)

    def dept_total(dept):
        return sum(line_amt(k) for k in accounts_in_dept(dept))

    room_rev = float(revenue.get("room", 0.0) or 0.0)
    other_rev = float(revenue.get("other", 0.0) or 0.0)
    total_rev = room_rev + other_rev

    departmental = sum(dept_total(d) for d in DEPARTMENTAL)
    undistributed = sum(dept_total(d) for d in UNDISTRIBUTED)
    fixed = sum(dept_total(d) for d in FIXED)
    dept_profit = total_rev - departmental
    gop = dept_profit - undistributed
    ebitda = gop - fixed

    rows = []
    rows.append({"kind": "revenue", "label": "Total Revenue", "level": 0, "amount": total_rev})
    rows.append({"kind": "revenue_line", "label": "Rooms", "dept": "Rooms", "level": 1, "amount": room_rev})
    rows.append({"kind": "revenue_line", "label": "Other Operated", "dept": "Other Operated", "level": 1, "amount": other_rev})

    def emit_dept(dept):
        rows.append({"kind": "expense_header", "label": dept, "dept": dept, "level": 0, "amount": dept_total(dept)})
        for key in accounts_in_dept(dept):
            rows.append({"kind": "expense_line", "label": key, "dept": dept, "level": 1,
                         "driver": driver_of(key), "amount": line_amt(key)})

    for d in DEPARTMENTAL:
        emit_dept(d)
    rows.append({"kind": "subtotal", "label": "Departmental Profit", "level": 0, "amount": dept_profit})
    for d in UNDISTRIBUTED:
        emit_dept(d)
    rows.append({"kind": "subtotal", "label": "Gross Operating Profit (GOP)", "level": 0, "amount": gop})
    for d in FIXED:
        emit_dept(d)
    rows.append({"kind": "subtotal", "label": "EBITDA", "level": 0, "amount": ebitda})

    rows.append({"kind": "memo_header", "label": "Memo — excluded from run-rate", "level": 0, "amount": None})
    for d in MEMO:
        rows.append({"kind": "memo_line", "label": d, "dept": d, "level": 1, "amount": dept_total(d)})
        for key in accounts_in_dept(d):
            rows.append({"kind": "memo_line", "label": key, "dept": d, "level": 2,
                         "driver": driver_of(key), "amount": line_amt(key)})
    return rows


SUBTOTAL_LABELS = ("Departmental Profit", "Gross Operating Profit (GOP)", "EBITDA")


# --------------------------------------------------------- balance-sheet cash
def walk_balance_sheet(report, keep_names):
    """Return {month: {account_name: month-end balance}} for Balance-Sheet rows
    whose account name is in `keep_names` (the Bank-type accounts). Uses the same
    monthly-column layout as the P&L; a matched account is taken whole (its
    section/Data total) and not descended into."""
    months = _period_months(report)
    n = len(months)
    keep = set(keep_names or [])
    out = {m: {} for m in months}

    def visit(row):
        name = _row_name(row)
        if name in keep:
            amts = _row_amounts(row, n)
            for i, m in enumerate(months):
                out[m][name] = out[m].get(name, 0.0) + amts[i]
            return
        for child in ((row.get("Rows") or {}).get("Row")) or []:
            visit(child)

    for row in ((report.get("Rows") or {}).get("Row")) or []:
        visit(row)
    return out


# ------------------------------------------------------- GL name detail (L3)
def aggregate_gl_names(report, fqn_map=None):
    """Aggregate a QuickBooks GeneralLedger report into per-month, per-line-key
    name detail for the third P&L drill-down:

        {"YYYY-MM": {account_key: {name: amount, ...}, ...}, ...}

    `name` is the transaction's Name, falling back to Memo/Description (bank
    deposits carry the payer/group there, not in Name), then "(Unnamed)".
    Only GL accounts that resolve to a P&L line key (via resolve_account_key +
    the optional FullyQualifiedName map) are kept; balance-sheet and unmapped
    accounts are skipped. No threshold is applied here — the caller filters.
    """
    cols = [(c.get("ColTitle") or "") for c in ((report.get("Columns") or {}).get("Column") or [])]

    def cidx(title):
        for i, c in enumerate(cols):
            if c.lower() == title.lower():
                return i
        return None

    di, ni, mi = cidx("Date"), cidx("Name"), cidx("Memo/Description")
    if di is None:
        return {}

    def label(cd):
        nm = (cd[ni].get("value") if ni is not None and ni < len(cd) else "") or ""
        nm = nm.strip()
        if not nm and mi is not None and mi < len(cd):
            nm = (cd[mi].get("value") or "").strip()
        return nm or "(Unnamed)"

    def amount(cd):
        try:
            return float((cd[-1].get("value") or "0").replace(",", ""))
        except (ValueError, AttributeError):
            return 0.0

    out = {}

    def walk(rows, acct=None):
        for r in rows.get("Row", []):
            hdr = (r.get("Header") or {}).get("ColData")
            cur = acct
            if hdr and hdr[0].get("value"):
                cur = hdr[0]["value"]
            cd = r.get("ColData")
            if cd and di < len(cd):
                dv = cd[di].get("value") or ""
                if len(dv) >= 7 and dv[:4].isdigit():  # a dated transaction row
                    key = resolve_account_key(cur, fqn_map)
                    if key:
                        month = dv[:7]
                        bucket = out.setdefault(month, {}).setdefault(key, {})
                        nm = label(cd)
                        bucket[nm] = bucket.get(nm, 0.0) + amount(cd)
            if r.get("Rows"):
                walk(r["Rows"], cur)

    walk(report.get("Rows") or {})
    return out


# ------------------------------------------------------------------ forecast
# Forecast method: PRIOR-YEAR SAME MONTH × CURRENT YTD Y/Y TREND.
#   base       = the same calendar month's actual from the prior year
#                (captures seasonality + cost levels directly from history)
#   adjustment = how this year is tracking vs last year over the YTD window
#                (the months of `year` that already have actuals), compared
#                apples-to-apples against the same months of the prior year.
# A line uses its OWN YTD Y/Y ratio when it had a material prior-year base,
# otherwise it inherits the overall (room-revenue) YTD trend. One-off /
# project lines are never trended. An optional owner override (`yoy_override`,
# a percent) replaces the computed trend for every line.

# Guard rails so a noisy small line can't blow up the forecast.
_YOY_CLAMP_LO = 0.25
_YOY_CLAMP_HI = 4.0
_MATERIAL_BASE = 1.0  # prior-YTD dollars needed to trust a line's own ratio


def _f(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(x):
    return max(_YOY_CLAMP_LO, min(_YOY_CLAMP_HI, x))


def compute_forecast(assumptions, actuals_by_month, year):
    """Prior-year-same-month forecast scaled by the current YTD Y/Y trend.

    `assumptions` (optional):
        yoy_override : a percent (e.g. 8 for +8%, -3 for -3%). When set, every
            line is forecast as prior-year-same-month × (1 + pct/100), bypassing
            the computed YTD trend.

    `actuals_by_month`: {"YYYY-MM": {lines, room_revenue, other_revenue}} across
        ALL ingested years — the prior year supplies the per-month base and both
        years' YTD windows supply the trend.

    Returns {"YYYY-MM": {lines, room_revenue, other_revenue}} for the 12 months
    of `year`, plus "_forecast_basis" and "_yoy_factor" sidecar keys.
    """
    a = assumptions or {}
    prior = year - 1
    months = [f"{year}-{m:02d}" for m in range(1, 13)]

    def bucket(yr, mnum):
        return actuals_by_month.get(f"{yr}-{mnum:02d}") or {}

    def line_val(b, key):
        return _f((b.get("lines") or {}).get(key))

    # Trend window for the Y/Y multiplier: COMPLETE, booked months only.
    # Exclude the in-progress current month (its partial actuals would skew the
    # ratio) and any unbooked/missing months, and require the prior year to have
    # the same month so the comparison is apples-to-apples.
    from datetime import date
    today = date.today()
    cur_month = today.month if year == today.year else 13
    booked_year = sorted(int(ym[5:7]) for ym in actuals_by_month if ym.startswith(f"{year}-"))
    complete_nums = [n for n in booked_year if n < cur_month]
    trend_nums = [n for n in complete_nums if f"{prior}-{n:02d}" in actuals_by_month]
    avg_nums = complete_nums or booked_year  # current-year run-rate fallback window

    def sum_line(yr, nums, key):
        return sum(line_val(bucket(yr, n), key) for n in nums)

    def sum_rev(yr, nums, field):
        return sum(_f(bucket(yr, n).get(field)) for n in nums)

    # Manual override (percent) wins; otherwise overall trend from room revenue.
    override = a.get("yoy_override")
    has_override = override not in (None, "")
    if has_override:
        overall = 1.0 + _f(override) / 100.0
        basis = "override"
    else:
        prior_rev, cur_rev = sum_rev(prior, trend_nums, "room_revenue"), sum_rev(year, trend_nums, "room_revenue")
        if prior_rev > EPS and cur_rev > 0:
            overall = _clamp(cur_rev / prior_rev)
            basis = "pysm_ytd_trend"
        else:
            overall = 1.0
            basis = "pysm_flat" if any(bucket(prior, n) for n in range(1, 13)) else "ytd_runrate"

    def line_factor(key):
        if has_override:
            return overall
        base = sum_line(prior, trend_nums, key)
        cur = sum_line(year, trend_nums, key)
        if base > _MATERIAL_BASE and cur > 0:
            return _clamp(cur / base)
        return overall

    def rev_factor(field):
        if has_override:
            return overall
        base, cur = sum_rev(prior, trend_nums, field), sum_rev(year, trend_nums, field)
        if base > EPS and cur > 0:
            return _clamp(cur / base)
        return overall

    # Fallback when the prior year has no same-month actual: flat current-year
    # average over complete booked months.
    def cur_avg_line(key):
        return sum_line(year, avg_nums, key) / len(avg_nums) if avg_nums else 0.0

    def cur_avg_rev(field):
        return sum_rev(year, avg_nums, field) / len(avg_nums) if avg_nums else 0.0

    out = {}
    for i, ym in enumerate(months):
        pysm = bucket(prior, i + 1)
        has_pysm = bool(pysm)
        lines = {}
        for key, _dept, _beh, _ctrl, driver in ACCOUNTS:
            if driver == "project":  # one-offs are never trended
                lines[key] = 0.0
            elif has_pysm:
                lines[key] = line_val(pysm, key) * line_factor(key)
            else:
                lines[key] = cur_avg_line(key)
        if has_pysm:
            room = _f(pysm.get("room_revenue")) * rev_factor("room_revenue")
            other = _f(pysm.get("other_revenue")) * rev_factor("other_revenue")
        else:
            room, other = cur_avg_rev("room_revenue"), cur_avg_rev("other_revenue")
        out[ym] = {"lines": lines, "room_revenue": room, "other_revenue": other}

    out["_forecast_basis"] = basis
    out["_yoy_factor"] = round(overall, 4)
    return out
