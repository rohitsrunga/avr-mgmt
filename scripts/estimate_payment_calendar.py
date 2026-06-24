"""Estimate the weekly payment / obligations calendar and publish it to the
avr-finance DynamoDB table.

Runs LOCALLY (no QuickBooks tokens, no live pull). It reads two repo files:

  * config/payment_calendar_config.json — the hand-maintained obligations: per
    USALI line ▸ vendor ▸ hotel, a funding account + a payment schedule. Lives
    in config/ (committed); data/ is never committed.
  * data/vendor_histories.json          — ~2yr of actual per-vendor payment
    dates + amounts (the one-time QuickBooks extract).

For every scheduled payment it projects over the forward window, it estimates
the amount from the **prior-year actual in the closest week** (the same week one
year earlier, within a tolerance), and writes one row per obligation per hotel:

    PK = PROPERTY#<property_id>
    SK = PAYOBLIG#<usali_line>#<vendor>
    {usali_line, usali_dept, vendor, label, pay_account,
     dates: ["YYYY-MM-DD", ...], amounts: [Decimal, ...], pulled_at}

The finance Lambda's GET /api/finance/{property_id}/payment-calendar buckets
these events into the requested week grid and renders them in the Finance tab.
Re-running clears and rewrites each property's PAYOBLIG# rows (idempotent). Edit
the config and re-run to publish changes.

Usage
-----
  python3 scripts/estimate_payment_calendar.py
  python3 scripts/estimate_payment_calendar.py --dry-run
  python3 scripts/estimate_payment_calendar.py --hotel "Saco Bay" --dry-run
"""
import argparse
import collections
import json
import os
import statistics
import sys
from datetime import date, datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
DATA = os.path.join(REPO_ROOT, "data")        # uncommitted: vendor_histories.json
CONFIG = os.path.join(REPO_ROOT, "config")    # committed: payment_calendar_config.json
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

from shared import usali             # noqa: E402  dept_of, ACCOUNT_KEYS
from shared.dynamo import to_dynamo  # noqa: E402

HOTEL_PROPERTY = {"Casco Bay": "casco_bay", "Saco Bay": "saco_bay"}
WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
PRIOR_YEAR_DAYS = 364  # same week one year earlier (keeps day-of-week alignment)


# ----------------------------------------------------------- schedule
def _last_dom(y, m):
    import calendar
    return calendar.monthrange(y, m)[1]


def expand_schedule(schedule, start, end):
    """Concrete payment dates a schedule produces in [start, end].

    schedule (one of):
      {"monthly": {"day": N}}          — the Nth of each month (clamped to EOM)
      {"weekly":  {"weekday": "Fri"}}  — every given weekday
      {"dates":   ["MM-DD", ...]}      — those month-days each year
    Optional "months": [1,4,7,10] restricts monthly/dates to those months."""
    months = set(schedule.get("months") or [])

    def keep(d):
        return (not months or d.month in months) and start <= d <= end

    out = []
    if "monthly" in schedule:
        day = int(schedule["monthly"]["day"])
        y, m = start.year, start.month
        while date(y, m, 1) <= end:
            d = date(y, m, min(day, _last_dom(y, m)))
            if keep(d):
                out.append(d)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    elif "weekly" in schedule:
        wd = WEEKDAYS[str(schedule["weekly"]["weekday"]).strip().lower()[:3]]
        d = start
        while d <= end:
            if d.weekday() == wd and keep(d):
                out.append(d)
            d += timedelta(days=1)
    elif "dates" in schedule:
        for y in range(start.year, end.year + 1):
            for md in schedule["dates"]:
                mm, dd = (int(x) for x in str(md).split("-"))
                try:
                    d = date(y, mm, dd)
                except ValueError:
                    continue
                if keep(d):
                    out.append(d)
    return sorted(out)


# ----------------------------------------------------------- estimate
def estimate(series, target, tol):
    """Estimate an amount for `target` from prior-year history `series`
    (sorted [(date, amount)]): the payment in the same month, else within ±tol
    days, whichever is closest in time; else the median of the trailing year;
    else the overall median. Returns (amount, basis)."""
    if not series:
        return 0.0, "none"
    same_month = [(d, a) for d, a in series if d.year == target.year and d.month == target.month]
    pool = same_month or [(d, a) for d, a in series if abs((d - target).days) <= tol]
    if pool:
        d, a = min(pool, key=lambda x: abs((x[0] - target).days))
        return a, "closest"
    window = [a for d, a in series if target - timedelta(days=200) <= d <= target + timedelta(days=60)]
    if window:
        return statistics.median(window), "median"
    return statistics.median([a for _, a in series]), "median_all"


def load_history():
    raw = json.load(open(os.path.join(DATA, "vendor_histories.json")))
    hist = {}
    for hotel, vendors in raw.items():
        for v in vendors:
            hist[(hotel, v["vendor"])] = [
                (date.fromisoformat(d), float(a)) for d, a in zip(v["dates"], v["amounts"])
            ]
    return hist


def merged_series(hist, hotel, names):
    by_day = collections.defaultdict(float)
    for nm in names:
        for d, a in hist.get((hotel, nm), []):
            by_day[d] += a
    return sorted(by_day.items())


def build_rows(config, hist, today, only_hotel=None):
    settings = config.get("settings") or {}
    fwd = int(settings.get("forward_months", 18))
    tol = int(settings.get("tolerance_days", 21))
    horizon_end = _add_months(today, fwd)

    rows = []  # (property_id, item, debug)
    for ob in config.get("obligations") or []:
        line = ob["line"]
        dept = usali.dept_of(line) or ob.get("dept") or ""
        vendor = ob["vendor"]
        label = ob.get("label", "")
        for hotel, h in (ob.get("hotels") or {}).items():
            if only_hotel and hotel != only_hotel:
                continue
            pid = HOTEL_PROPERTY.get(hotel)
            if not pid:
                print(f"  ⚠ unknown hotel '{hotel}' for {vendor}; skipping")
                continue
            names = h.get("source") or [vendor]
            series = merged_series(hist, hotel, names)
            override = h.get("amount")
            dates, amounts, bases = [], [], collections.Counter()
            for d in expand_schedule(h["schedule"], today, horizon_end):
                if override not in (None, ""):
                    amt, basis = float(override), "override"
                else:
                    amt, basis = estimate(series, d - timedelta(days=PRIOR_YEAR_DAYS), tol)
                if amt:
                    dates.append(d.isoformat())
                    amounts.append(round(amt, 2))
                    bases[basis] += 1
            item = {
                "PK": f"PROPERTY#{pid}", "SK": f"PAYOBLIG#{line}#{vendor}",
                "usali_line": line, "usali_dept": dept, "vendor": vendor,
                "label": label, "pay_account": h.get("fund", ""),
                "dates": dates, "amounts": amounts, "source": "config-estimate",
            }
            rows.append((pid, item, {"hotel": hotel, "n": len(dates),
                                     "total": sum(amounts), "bases": dict(bases)}))
    return rows


def _add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    import calendar
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def clear_payoblig(table, pid):
    pk = f"PROPERTY#{pid}"
    cond = Key("PK").eq(pk) & Key("SK").begins_with("PAYOBLIG#")
    resp = table.query(KeyConditionExpression=cond)
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = table.query(KeyConditionExpression=cond, ExclusiveStartKey=resp["LastEvaluatedKey"])
        items += resp.get("Items", [])
    with table.batch_writer() as bw:
        for it in items:
            bw.delete_item(Key={"PK": it["PK"], "SK": it["SK"]})
    return len(items)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--config", default=os.path.join(CONFIG, "payment_calendar_config.json"))
    p.add_argument("--prefix", default="avr", help="Resource-name prefix (template.yaml StackPrefix).")
    p.add_argument("--region", default="us-east-1")
    p.add_argument("--hotel", choices=list(HOTEL_PROPERTY), help="Limit to one hotel.")
    p.add_argument("--dry-run", action="store_true", help="Print without writing to DynamoDB.")
    args = p.parse_args()

    config = json.load(open(args.config))
    hist = load_history()
    today = date.today()
    rows = build_rows(config, hist, today, only_hotel=args.hotel)

    by_pid = collections.defaultdict(list)
    for pid, item, dbg in rows:
        by_pid[pid].append((item, dbg))

    table = None
    if not args.dry_run:
        table = boto3.resource("dynamodb", region_name=args.region).Table(f"{args.prefix}-finance")

    for pid, entries in sorted(by_pid.items()):
        print(f"\n== {pid}: {len(entries)} obligations ==")
        for item, dbg in sorted(entries, key=lambda e: (e[0]["usali_dept"], e[0]["usali_line"], e[0]["vendor"])):
            print(f"  {item['usali_line']:<26} {item['vendor']:<30} "
                  f"{dbg['n']:>3} pmts  ${dbg['total']:>11,.0f}  {dbg['bases']}  {item['pay_account']}")
        if args.dry_run:
            print("  (dry-run, nothing written)")
            continue
        removed = clear_payoblig(table, pid)
        now = datetime.now(timezone.utc).isoformat()
        for item, _ in entries:
            item["pulled_at"] = now
            table.put_item(Item=to_dynamo(item))
        print(f"  cleared {removed}, wrote {len(entries)} obligation rows")


if __name__ == "__main__":
    main()
