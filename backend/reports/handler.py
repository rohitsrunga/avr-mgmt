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
