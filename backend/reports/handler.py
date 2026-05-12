"""Reports: read-only views over CachedReports table.

PK = PROPERTY#<property_id>
SK = REPORT#<type>#DATE#<YYYY-MM-DD>
"""
from datetime import datetime, timedelta, timezone

from shared.auth import (
    ALL_ROLES,
    MANAGEMENT_ROLES,
    authorize,
    authorize_property,
)
from shared.dynamo import query_pk, table
from shared.response import ok, server_error
from shared.router import Router, query_params

router = Router()
TBL = lambda: table("TABLE_REPORTS")


@router.get("/api/reports/{property_id}/dashboard")
def dashboard(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    items = query_pk(TBL(), f"PROPERTY#{pid}", f"REPORT#daily_stats#DATE#{today}")
    if not items:
        items = query_pk(TBL(), f"PROPERTY#{pid}", "REPORT#daily_stats#DATE#")
        items.sort(key=lambda i: i.get("SK", ""), reverse=True)
        items = items[:1]
    data = {}
    if items:
        data = items[0].get("data") or {}
        synced_at = items[0].get("synced_at", "")
    else:
        synced_at = ""
    return ok({"data": data, "synced_at": synced_at, "property_id": pid})


@router.get("/api/reports/{property_id}/occupancy")
def occupancy(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    qs = query_params(event)
    months = int(qs.get("period", "12").replace("m", ""))
    cutoff = datetime.now(timezone.utc) - timedelta(days=months * 31)
    items = query_pk(TBL(), f"PROPERTY#{pid}", "REPORT#daily_stats#DATE#")
    series = []
    for it in items:
        date_str = it["SK"].split("#")[-1]
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if d < cutoff:
            continue
        data = it.get("data") or {}
        series.append({
            "date": date_str,
            "occupancy_pct": float(data.get("occupancy_pct", 0)),
        })
    series.sort(key=lambda s: s["date"])
    return ok({"series": series})


@router.get("/api/reports/{property_id}/revenue")
def revenue(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    qs = query_params(event)
    months = int(qs.get("period", "12").replace("m", ""))
    cutoff = datetime.now(timezone.utc) - timedelta(days=months * 31)
    items = query_pk(TBL(), f"PROPERTY#{pid}", "REPORT#daily_stats#DATE#")
    monthly = {}
    for it in items:
        date_str = it["SK"].split("#")[-1]
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if d < cutoff:
            continue
        month_key = d.strftime("%Y-%m")
        data = it.get("data") or {}
        monthly[month_key] = monthly.get(month_key, 0) + float(data.get("total_revenue", 0))
    series = [{"month": m, "revenue": v} for m, v in sorted(monthly.items())]
    return ok({"series": series})


@router.get("/api/reports/sync-status")
def sync_status(event, params):
    err = authorize(event, ALL_ROLES)
    if err:
        return err
    statuses = {}
    for pid in ["casco_bay", "saco_bay"]:
        items = query_pk(TBL(), f"PROPERTY#{pid}", "REPORT#")
        if items:
            items.sort(key=lambda i: i.get("synced_at", ""), reverse=True)
            statuses[pid] = items[0].get("synced_at", "")
        else:
            statuses[pid] = ""
    return ok({"sync_status": statuses})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
