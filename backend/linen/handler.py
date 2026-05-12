"""Linen counts: weekly counts of towels and bedding.

PK = PROPERTY#<property_id>#MONTH#<YYYY-MM>
SK = ITEM#<linen_type>#WEEK#<week_number>
"""
from datetime import datetime, timezone

from shared.auth import ALL_ROLES, authorize_property, get_identity
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, ok, server_error
from shared.router import Router, parse_body, query_params

router = Router()
TBL = lambda: table("TABLE_LINEN")

LINEN_ITEMS = [
    "Bath", "Hand", "Wash", "Mats",
    "Pillowcase", "Pillow covers",
    "King fitted", "King flat", "Queen fitted", "Queen flat",
    "Blankets", "Mattress protectors",
]


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("/api/linen/{property_id}")
def get_linen(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    month = qs.get("month") or datetime.now(timezone.utc).strftime("%Y-%m")
    items = query_pk(TBL(), f"PROPERTY#{pid}#MONTH#{month}", "ITEM#")

    grid = {item: {1: None, 2: None, 3: None, 4: None, "_meta": {}} for item in LINEN_ITEMS}
    for it in items:
        sk = it["SK"]  # ITEM#<linen_type>#WEEK#<n>
        try:
            _, linen_type, _, week = sk.split("#", 3)
            week_n = int(week)
        except (ValueError, IndexError):
            continue
        if linen_type not in grid:
            grid[linen_type] = {1: None, 2: None, 3: None, 4: None, "_meta": {}}
        grid[linen_type][week_n] = int(it.get("count", 0))
        grid[linen_type]["_meta"][week_n] = {
            "counted_by": it.get("counted_by", ""),
            "counted_at": it.get("counted_at", ""),
        }

    rows = []
    for linen_type, weeks in grid.items():
        rows.append({
            "linen_type": linen_type,
            "week_1": weeks[1],
            "week_2": weeks[2],
            "week_3": weeks[3],
            "week_4": weeks[4],
            "meta": weeks["_meta"],
        })
    return ok({"month": month, "rows": rows})


@router.put("/api/linen/{property_id}")
def update_count(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    month = body.get("month") or datetime.now(timezone.utc).strftime("%Y-%m")
    linen_type = body.get("linen_type")
    week = body.get("week")
    count = body.get("count")
    if not linen_type or week is None or count is None:
        return bad_request("linen_type, week, count required")
    identity = get_identity(event)
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{pid}#MONTH#{month}",
        "SK": f"ITEM#{linen_type}#WEEK#{int(week)}",
        "count": int(count),
        "linen_type": linen_type,
        "week": int(week),
        "counted_by": identity["name"] or identity["email"],
        "counted_at": _now(),
    }))
    return ok({"saved": True})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
