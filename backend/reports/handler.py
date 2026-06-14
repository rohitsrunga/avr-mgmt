"""Read-only PMS data for the Overview tab.

Backed by CachedReportsTable, populated every 6 hours by the Sync Lambda
(see backend/sync/handler.py). There is no standalone Reports tab — these
endpoints exist purely to feed the Overview dashboard's PMS metric tiles.

PK = PROPERTY#<property_id>
SK = REPORT#<type>#DATE#<YYYY-MM-DD>
"""
from datetime import datetime, timezone

from shared.auth import ALL_ROLES, authorize, authorize_property
from shared.dynamo import query_pk, table
from shared.response import ok, server_error
from shared.router import Router

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
    synced_at = ""
    if items:
        data = items[0].get("data") or {}
        synced_at = items[0].get("synced_at", "")
    return ok({"data": data, "synced_at": synced_at, "property_id": pid})


@router.get("/api/reports/{property_id}/today")
def today(event, params):
    """Counts surfaced as BANs on the Checklists tab.
    Reads the cached Cloudbeds /getReservations snapshot for `property_id`.
    Falls back to the most recent cached row if today's hasn't been
    refreshed yet. Returns zeros + empty synced_at when no row exists
    (typical for properties without Cloudbeds wired up, e.g. Casco Bay)."""
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    items = query_pk(TBL(), f"PROPERTY#{pid}", f"REPORT#reservations#DATE#{today_str}")
    if not items:
        items = query_pk(TBL(), f"PROPERTY#{pid}", "REPORT#reservations#DATE#")
        items.sort(key=lambda i: i.get("SK", ""), reverse=True)
        items = items[:1]
    data = (items[0].get("data") if items else {}) or {}
    return ok({
        "property_id": pid,
        "arrivals":   int(data.get("arriving_today", 0) or 0),
        "in_house":   int(data.get("in_house", 0) or 0),
        "departures": int(data.get("departing_today", 0) or 0),
        "synced_at":  items[0].get("synced_at", "") if items else "",
    })


@router.get("/api/reports/{property_id}/rooms-to-clean")
def rooms_to_clean(event, params):
    """Rooms Cloudbeds says need cleaning today (union of today's departures
    + Cloudbeds-flagged dirty/pickup). Consumed by the Property tab's
    Cleaning lens to populate the Unassigned pool. Returns empty list +
    empty synced_at when Cloudbeds isn't wired up for this property."""
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    items = query_pk(TBL(), f"PROPERTY#{pid}", f"REPORT#rooms_to_clean#DATE#{today_str}")
    if not items:
        items = query_pk(TBL(), f"PROPERTY#{pid}", "REPORT#rooms_to_clean#DATE#")
        items.sort(key=lambda i: i.get("SK", ""), reverse=True)
        items = items[:1]
    data = (items[0].get("data") if items else {}) or {}
    return ok({
        "property_id": pid,
        "rooms":      list(data.get("rooms") or []),
        "dirty":      list(data.get("dirty") or []),
        "departures": list(data.get("departures") or []),
        "inhouse":    list(data.get("inhouse") or []),
        "clean":      list(data.get("clean") or []),
        "synced_at":  items[0].get("synced_at", "") if items else "",
    })


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
