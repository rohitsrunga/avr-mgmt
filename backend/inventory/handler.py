"""Inventory: stock counts, par levels, low-stock alerts.

PK = PROPERTY#<property_id>
SK = CATEGORY#<category>#ITEM#<item_id>
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from shared.auth import (
    ALL_ROLES,
    MANAGEMENT_ROLES,
    authorize_property,
    get_identity,
)
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, ok, server_error
from shared.router import Router, parse_body, query_params

router = Router()
TBL = lambda: table("TABLE_INVENTORY")
DEFAULT_THRESHOLD_PCT = Decimal("30")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _serialize(item):
    return {
        "item_id": item.get("item_id", ""),
        "item_name": item.get("item_name", ""),
        "category": item.get("category", ""),
        "current_stock": int(item.get("current_stock", 0)),
        "par_level": int(item.get("par_level", 0)),
        "unit": item.get("unit", "each"),
        "reorder_threshold_pct": int(item.get("reorder_threshold_pct", 30)),
        "last_updated": item.get("last_updated", ""),
        "updated_by": item.get("updated_by", ""),
    }


@router.get("/api/inventory/{property_id}")
def list_items(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    category = qs.get("category")
    prefix = f"CATEGORY#{category}#" if category else "CATEGORY#"
    items = query_pk(TBL(), f"PROPERTY#{pid}", prefix)
    return ok({"items": [_serialize(i) for i in items]})


@router.put("/api/inventory/{property_id}/items/{item_id}")
def update_item(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    category = body.get("category")
    if not category:
        return bad_request("category required")
    item_id = params["item_id"]
    identity = get_identity(event)

    # Build a SET update for whichever fields were sent.
    update_fields = {}
    for field in ["current_stock", "par_level", "reorder_threshold_pct"]:
        if field in body:
            update_fields[field] = int(body[field])
    for field in ["item_name", "unit"]:
        if field in body:
            update_fields[field] = body[field]
    update_fields["last_updated"] = _now()
    update_fields["updated_by"] = identity["name"] or identity["email"]

    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"CATEGORY#{category}#ITEM#{item_id}"},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return ok({"updated": True})


@router.post("/api/inventory/{property_id}/items")
def create_item(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    body = parse_body(event)
    category = body.get("category")
    item_name = body.get("item_name")
    if not category or not item_name:
        return bad_request("category and item_name required")
    item_id = body.get("item_id") or str(uuid.uuid4())[:8]
    identity = get_identity(event)
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"CATEGORY#{category}#ITEM#{item_id}",
        "item_id": item_id,
        "item_name": item_name,
        "category": category,
        "current_stock": int(body.get("current_stock", 0)),
        "par_level": int(body.get("par_level", 0)),
        "unit": body.get("unit", "each"),
        "reorder_threshold_pct": int(body.get("reorder_threshold_pct", 30)),
        "last_updated": _now(),
        "updated_by": identity["name"] or identity["email"],
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"item_id": item_id})


@router.delete("/api/inventory/{property_id}/items/{item_id}")
def delete_item(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    qs = query_params(event)
    category = qs.get("category")
    if not category:
        return bad_request("category query param required")
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"CATEGORY#{category}#ITEM#{params['item_id']}",
    })
    return ok({"deleted": True})


@router.get("/api/inventory/{property_id}/alerts")
def low_stock_alerts(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    items = query_pk(TBL(), f"PROPERTY#{pid}", "CATEGORY#")
    alerts = []
    for it in items:
        par = int(it.get("par_level", 0))
        if par <= 0:
            continue
        stock = int(it.get("current_stock", 0))
        threshold_pct = Decimal(it.get("reorder_threshold_pct", DEFAULT_THRESHOLD_PCT))
        threshold_units = (Decimal(par) * threshold_pct) / Decimal(100)
        if Decimal(stock) <= threshold_units:
            ratio = (Decimal(stock) / Decimal(par)) if par else Decimal(0)
            alerts.append({
                **_serialize(it),
                "fill_pct": int(ratio * 100),
            })
    alerts.sort(key=lambda a: a["fill_pct"])
    return ok({"alerts": alerts})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
