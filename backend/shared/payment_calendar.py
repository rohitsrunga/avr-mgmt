"""Payment / obligations calendar — the weekly payables matrix, shared by the
finance Lambda (read side) and mirrored by scripts/estimate_payment_calendar.py
(write side).

Model: a hand-maintained config (config/payment_calendar_config.json) declares each
obligation (USALI line ▸ vendor ▸ hotel, with a funding account + a schedule);
the local estimate script projects each scheduled payment forward and fills in
its amount from the prior-year actual in the closest week, then writes one row
per obligation to the avr-finance table:

    PK = PROPERTY#<property_id>
    SK = PAYOBLIG#<usali_line>#<vendor>
    {usali_line, usali_dept, vendor, label, pay_account,
     dates: ["YYYY-MM-DD", ...], amounts: [Decimal, ...]}

`dates`/`amounts` are the (future) expected payment events with their estimated
amounts. This module just buckets those events into the requested week grid,
nests them (USALI line ▸ vendor ▸ hotel with funding account), sums a TOTAL
EXPENSES row, and flags the current week + month boundaries. No estimation here
— amounts are baked by the script (it owns the prior-year history, which stays
off the cloud).
"""
import calendar
from datetime import date, timedelta

# Display order of hotels nested under a vendor.
HOTEL_ORDER = ["Casco Bay", "Saco Bay"]

# USALI department display order (mirrors usali.DEPT_ORDER, plus the synthetic
# buckets a payment calendar can carry).
DEPT_ORDER = ["Rooms", "Rooms (OTA)", "Labor (multi)", "Sales & Marketing",
              "A&G", "Property Ops & Maint", "Utilities", "Fixed Charges",
              "Pass-through", "Below EBITDA", "Non-operating", ""]


# ------------------------------------------------------------- week grid
def _add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _ordinal(n):
    suf = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def week_grid(start, n_months):
    """Weekly columns across the horizon. Returns (starts, cols, labels):
      starts — week-start dates (every 7 days from the 1st of `start`)
      cols   — ISO-string column keys
      labels — display labels like 'July 1st'."""
    first = date(start.year, start.month, 1)
    em = _add_months(first, n_months - 1)
    end = date(em.year, em.month, calendar.monthrange(em.year, em.month)[1])
    starts, d = [], first
    while d <= end:
        starts.append(d)
        d += timedelta(days=7)
    cols = [s.isoformat() for s in starts]
    labels = [f"{s.strftime('%B')} {_ordinal(s.day)}" for s in starts]
    return starts, cols, labels


# ------------------------------------------------------------- helpers
def _deptkey(d):
    return DEPT_ORDER.index(d) if d in DEPT_ORDER else 99


def _events(record):
    return [(date.fromisoformat(d), float(a))
            for d, a in zip(record.get("dates") or [], record.get("amounts") or [])]


def _zero(cols):
    return {c: 0.0 for c in cols}


def _add_into(dst, src):
    for c, v in src.items():
        dst[c] += v


def _bucket(events, starts, cols):
    """Sum each payment event into the week whose [start, start+7) contains it."""
    out = _zero(cols)
    for i, s in enumerate(starts):
        hi = s + timedelta(days=7)
        tot = sum(a for d, a in events if s <= d < hi)
        if tot:
            out[cols[i]] = tot
    return out


# ------------------------------------------------------------- builder
def build_calendar(records, start, n_months, today=None):
    """Build the nested weekly obligations matrix from stored obligation records.

    `records` — obligation records (one per vendor per hotel; see module docstring).
    `start`   — first month (a date; day ignored, snapped to the 1st).
    `n_months`— horizon length in whole months.

    Returns:
      {
        "weeks": [{start, label, is_current, month_start}, ...],
        "depts": [{dept, lines: [{line, total, cells, vendors: [
                     {vendor, label, total, cells,
                      hotels: [{hotel, pay_account, cells}]}]}]}],
        "total": [...],          # TOTAL EXPENSES per week
        "grand_total": float,
      }
    Cell arrays are aligned to `weeks` order.
    """
    today = today or date.today()
    starts, cols, labels = week_grid(start, n_months)
    month_start = {cols[i] for i in range(len(cols))
                   if i == 0 or starts[i].month != starts[i - 1].month}
    cur = next((cols[i] for i in range(len(cols))
                if starts[i] <= today < starts[i] + timedelta(days=7)), None)

    # dept -> line -> vendor -> {label, hotels: {hotel: {pay_account, cells}}}
    tree = {}
    for r in records:
        cells = _bucket(_events(r), starts, cols)
        if not any(cells.values()):
            continue
        line = r.get("usali_line") or "Unmapped"
        dept = r.get("usali_dept") or ""
        node = tree.setdefault(dept, {}).setdefault(line, {}).setdefault(
            r.get("vendor", ""), {"label": r.get("label", ""), "hotels": {}})
        node["hotels"][r.get("hotel", "")] = {
            "pay_account": r.get("pay_account", ""), "cells": cells}

    def cell_list(cells):
        return [round(cells[c], 2) for c in cols]

    grand = _zero(cols)
    depts_out = []
    for dept in sorted(tree, key=_deptkey):
        lines_out = []
        for line in sorted(tree[dept]):
            ltot = _zero(cols)
            vendors = []
            for vendor, vnode in tree[dept][line].items():
                vtot = _zero(cols)
                for hd in vnode["hotels"].values():
                    _add_into(vtot, hd["cells"])
                ordered = [h for h in HOTEL_ORDER if h in vnode["hotels"]] + \
                          [h for h in vnode["hotels"] if h not in HOTEL_ORDER]
                hotels = [{"hotel": h, "pay_account": vnode["hotels"][h]["pay_account"],
                           "cells": cell_list(vnode["hotels"][h]["cells"])} for h in ordered]
                vendors.append({
                    "vendor": vendor, "label": vnode["label"],
                    "total": round(sum(vtot.values()), 2),
                    "cells": cell_list(vtot), "hotels": hotels,
                })
                _add_into(ltot, vtot)
            vendors.sort(key=lambda v: -v["total"])
            _add_into(grand, ltot)
            lines_out.append({
                "line": line, "total": round(sum(ltot.values()), 2),
                "cells": cell_list(ltot), "vendors": vendors,
            })
        depts_out.append({"dept": dept, "lines": lines_out})

    weeks = [{"start": cols[i], "label": labels[i],
              "is_current": cols[i] == cur, "month_start": cols[i] in month_start}
             for i in range(len(cols))]
    return {
        "weeks": weeks,
        "depts": depts_out,
        "total": cell_list(grand),
        "grand_total": round(sum(grand.values()), 2),
    }
