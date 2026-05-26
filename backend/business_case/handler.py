"""Business Case — daily marketing/business tasks (Casco Bay).

Six fixed daily tasks (Madalia reviews, Cvent RFP, business cases, leisure,
transient, reply reviews). Staff submits which subset they completed for the
day; the dashboard shows today's status, a date range heat-map, and per-task
completion analysis for the month.

PK = PROPERTY#<property_id>
SK = DAILY#<YYYY-MM-DD>#TASK#<task_id>
"""
import calendar
from datetime import date as date_cls, datetime, timedelta, timezone

from shared.auth import ALL_ROLES, MANAGEMENT_ROLES, authorize_property
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, forbidden, ok, server_error
from shared.router import Router, parse_body, query_params
from shared.settings import VALID_PROPERTIES, is_feature_enabled

router = Router()
TBL = lambda: table("TABLE_BUSINESS_CASE")

FEATURE_ID = "business_case"

TASK_DEFINITIONS = [
    {"id": "madalia_reviews", "label": "Madalia Online Booking Reviews", "icon": "⭐"},
    {"id": "cvent_rfp",       "label": "Cvent RFP",                     "icon": "📨"},
    {"id": "business_cases",  "label": "Business Cases",                "icon": "💼"},
    {"id": "leisure",         "label": "Leisure",                       "icon": "🌴"},
    {"id": "transient",       "label": "Transient",                     "icon": "🚗"},
    {"id": "reply_reviews",   "label": "Reply All Reviews",             "icon": "💬"},
]
VALID_TASK_IDS = {t["id"] for t in TASK_DEFINITIONS}
TASK_LABELS = {t["id"]: t["label"] for t in TASK_DEFINITIONS}
TOTAL_TASKS = len(TASK_DEFINITIONS)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _check_property(pid):
    if pid not in VALID_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    if not is_feature_enabled(pid, FEATURE_ID):
        return forbidden("Business case is disabled for this property")
    return None


def _rows_for_date(pid, day):
    return query_pk(TBL(), f"PROPERTY#{pid}", f"DAILY#{day}#")


def _build_summary(rows, for_date):
    task_ids = [r.get("task_id") for r in rows if r.get("task_id") in VALID_TASK_IDS]
    completed_count = len(set(task_ids))
    submitted_at = rows[0].get("submitted_at") if rows else None
    return {
        "date": for_date,
        "completed_count": completed_count,
        "total_tasks": TOTAL_TASKS,
        "completion_rate": round(completed_count / TOTAL_TASKS * 100, 1),
        "task_ids": sorted(set(task_ids)),
        "submitted_at": submitted_at,
    }


# ----------------------------------------------------------------------
# Meta — constants used by the frontend
# ----------------------------------------------------------------------

@router.get("/api/business-case/meta/constants")
def meta_constants(event, params):
    return ok({
        "task_definitions": TASK_DEFINITIONS,
        "total_tasks": TOTAL_TASKS,
    })


# ----------------------------------------------------------------------
# Per-day reads
# ----------------------------------------------------------------------

@router.get("/api/business-case/{property_id}/today")
def get_today(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    today = _today()
    rows = _rows_for_date(pid, today)
    return ok(_build_summary(rows, today))


@router.get("/api/business-case/{property_id}/date/{date_str}")
def get_for_date(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    rows = _rows_for_date(pid, params["date_str"])
    return ok(_build_summary(rows, params["date_str"]))


# ----------------------------------------------------------------------
# Date range — used for the heat-map grid
# ----------------------------------------------------------------------

@router.get("/api/business-case/{property_id}/range")
def get_range(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    try:
        start = date_cls.fromisoformat(qs.get("start_date") or "")
        end = date_cls.fromisoformat(qs.get("end_date") or "")
    except ValueError:
        return bad_request("start_date and end_date required (YYYY-MM-DD)")
    if (end - start).days > 90:
        return bad_request("Date range cannot exceed 90 days")
    if end < start:
        return bad_request("end_date must be >= start_date")

    days = []
    by_date = {}
    current = start
    while current <= end:
        ds = current.isoformat()
        rows = _rows_for_date(pid, ds)
        by_date[ds] = rows
        count = len(set(r.get("task_id") for r in rows))
        days.append({
            "date": ds,
            "completed_count": count,
            "completion_rate": round(count / TOTAL_TASKS * 100, 1),
            "task_ids": sorted(set(r.get("task_id") for r in rows)),
        })
        current += timedelta(days=1)

    nonempty = [d for d in days if d["completed_count"] > 0]
    fully = sum(1 for d in days if d["completed_count"] == TOTAL_TASKS)
    partial = sum(1 for d in days if 0 < d["completed_count"] < TOTAL_TASKS)
    empty = sum(1 for d in days if d["completed_count"] == 0)
    if nonempty:
        overall = round(sum(d["completed_count"] for d in nonempty) / (len(nonempty) * TOTAL_TASKS) * 100, 1)
    else:
        overall = 0.0

    return ok({
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "days": days,
        "summary": {
            "total_days_with_data": len(nonempty),
            "fully_completed_days": fully,
            "partial_days": partial,
            "empty_days": empty,
            "overall_completion_rate": overall,
        },
    })


# ----------------------------------------------------------------------
# Per-task analysis for a given YYYY-MM month
# ----------------------------------------------------------------------

@router.get("/api/business-case/{property_id}/analysis")
def get_analysis(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    month = qs.get("month") or _today()[:7]
    try:
        year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    except (ValueError, IndexError):
        return bad_request("month must be YYYY-MM")
    _, days_in_month = calendar.monthrange(year, mon)

    by_task = {tid: set() for tid in VALID_TASK_IDS}
    days_with_data = set()
    for day in range(1, days_in_month + 1):
        ds = f"{month}-{day:02d}"
        rows = _rows_for_date(pid, ds)
        if rows:
            days_with_data.add(ds)
        for r in rows:
            if r.get("task_id") in by_task:
                by_task[r["task_id"]].add(ds)

    working_days = len(days_with_data)
    tasks = []
    for tdef in TASK_DEFINITIONS:
        tid = tdef["id"]
        completed_days = len(by_task[tid])
        missed_days = max(0, working_days - completed_days)
        rate = round(completed_days / working_days * 100, 1) if working_days else 0.0
        status = "good" if rate >= 80 else "fair" if rate >= 50 else "low"
        tasks.append({
            "task_id": tid,
            "label": tdef["label"],
            "icon": tdef["icon"],
            "completed_days": completed_days,
            "missed_days": missed_days,
            "completion_rate": rate,
            "status": status,
        })

    return ok({"month": month, "working_days": working_days, "tasks": tasks})


# ----------------------------------------------------------------------
# History — last N days roll-up for sidebar/badges
# ----------------------------------------------------------------------

@router.get("/api/business-case/{property_id}/history")
def get_history(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    try:
        days = max(1, min(30, int(qs.get("days") or 7)))
    except ValueError:
        days = 7
    today = date_cls.fromisoformat(_today())
    out = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        rows = _rows_for_date(pid, ds)
        count = len(set(r.get("task_id") for r in rows))
        if d == today:
            label = "Today"
        elif d == today - timedelta(days=1):
            label = "Yesterday"
        else:
            label = d.strftime("%a, %b %d")
        out.append({
            "date": ds,
            "completed_count": count,
            "completion_rate": round(count / TOTAL_TASKS * 100, 1),
            "label": label,
        })
    return ok({"history": out})


# ----------------------------------------------------------------------
# Submit — replaces the full daily checklist for the given date
# ----------------------------------------------------------------------

@router.post("/api/business-case/{property_id}/submit")
def submit(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    day = body.get("date") or _today()
    try:
        date_cls.fromisoformat(day)
    except ValueError:
        return bad_request("date must be YYYY-MM-DD")
    task_ids = body.get("task_ids") or []
    if not isinstance(task_ids, list):
        return bad_request("task_ids must be a list")
    cleaned = []
    for tid in task_ids:
        if tid not in VALID_TASK_IDS:
            return bad_request(f"Invalid task_id: {tid}")
        if tid not in cleaned:
            cleaned.append(tid)

    tbl = TBL()
    existing = query_pk(tbl, f"PROPERTY#{pid}", f"DAILY#{day}#")
    with tbl.batch_writer() as batch:
        for it in existing:
            batch.delete_item(Key={"PK": it["PK"], "SK": it["SK"]})
        for tid in cleaned:
            item = {
                "PK": f"PROPERTY#{pid}",
                "SK": f"DAILY#{day}#TASK#{tid}",
                "date": day,
                "task_id": tid,
                "completed": True,
                "submitted_at": _now(),
            }
            batch.put_item(Item=to_dynamo(item))

    return ok({
        "message": "Checklist submitted",
        "date": day,
        "completed_count": len(cleaned),
        "total_tasks": TOTAL_TASKS,
        "completion_rate": round(len(cleaned) / TOTAL_TASKS * 100, 1),
        "task_ids": cleaned,
    })


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
