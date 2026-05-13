"""Dinner orders for the Casco Bay evening dinner program.

PK = PROPERTY#<property_id>
SK = ORDER#<YYYY-MM-DD>#<order_id>

Public routes (no auth) live under /api/public/dinner-orders/* and are the entry
point used by the static S3 form. Authenticated routes under /api/dinner-orders/*
power the staff dashboard.
"""
import uuid
from datetime import datetime, timezone

from shared.auth import ALL_ROLES, authorize_property, get_identity
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, not_found, ok, server_error
from shared.router import Router, parse_body, query_params

router = Router()
TBL = lambda: table("TABLE_DINNER_ORDERS")

VALID_SIDES = {"salad", "cookie", "chips", "mac_cheese"}
VALID_SANDWICH = {"none", "chicken", "veggie"}
VALID_DRINK = {"none", "water", "soda", "juice"}
ENABLED_PROPERTIES = {"casco_bay"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _serialize(item):
    return {
        "order_id": item.get("order_id", ""),
        "date": item.get("date", ""),
        "guest_name": item.get("guest_name", ""),
        "room_number": item.get("room_number", ""),
        "items": item.get("items", {}),
        "sandwich": item.get("sandwich", "none"),
        "drink": item.get("drink", "none"),
        "notes": item.get("notes", ""),
        "status": item.get("status", "open"),
        "submitted_at": item.get("submitted_at", ""),
        "completed_at": item.get("completed_at", ""),
        "completed_by": item.get("completed_by", ""),
    }


def _validate_order(body):
    guest_name = (body.get("guest_name") or "").strip()
    if not guest_name:
        return None, "guest_name required"
    if len(guest_name) > 80:
        return None, "guest_name too long"
    room_number = (body.get("room_number") or "").strip()[:20]
    raw_items = body.get("items") or {}
    items = {k: bool(raw_items.get(k)) for k in VALID_SIDES}
    sandwich = body.get("sandwich") or "none"
    if sandwich not in VALID_SANDWICH:
        return None, f"sandwich must be one of {sorted(VALID_SANDWICH)}"
    drink = body.get("drink") or "none"
    if drink not in VALID_DRINK:
        return None, f"drink must be one of {sorted(VALID_DRINK)}"
    notes = (body.get("notes") or "").strip()[:300]
    if not any(items.values()) and sandwich == "none" and drink == "none":
        return None, "select at least one item"
    return {
        "guest_name": guest_name,
        "room_number": room_number,
        "items": items,
        "sandwich": sandwich,
        "drink": drink,
        "notes": notes,
    }, None


# ----------------------------------------------------------------------
# Public routes (no auth) — used by the static S3 form
# ----------------------------------------------------------------------

@router.post("/api/public/dinner-orders/{property_id}")
def public_submit(event, params):
    pid = params["property_id"]
    if pid not in ENABLED_PROPERTIES:
        return bad_request("dinner orders not available for this property")
    body = parse_body(event)
    cleaned, err = _validate_order(body)
    if err:
        return bad_request(err)
    order_id = uuid.uuid4().hex[:10]
    date = _today()
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"ORDER#{date}#{order_id}",
        "order_id": order_id,
        "date": date,
        "status": "open",
        "submitted_at": _now(),
        **cleaned,
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"order_id": order_id, "submitted_at": item["submitted_at"]})


# ----------------------------------------------------------------------
# Authenticated routes — staff dashboard
# ----------------------------------------------------------------------

@router.get("/api/dinner-orders/{property_id}")
def list_orders(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    date = qs.get("date") or _today()
    status_filter = qs.get("status")  # "open" | "completed" | None (all)
    raw = query_pk(TBL(), f"PROPERTY#{pid}", f"ORDER#{date}#")
    orders = [_serialize(it) for it in raw]
    if status_filter:
        orders = [o for o in orders if o["status"] == status_filter]
    orders.sort(key=lambda o: o["submitted_at"])
    return ok({"date": date, "orders": orders})


@router.put("/api/dinner-orders/{property_id}/{order_id}")
def update_order(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    date = body.get("date") or _today()
    order_id = params["order_id"]
    key = {"PK": f"PROPERTY#{pid}", "SK": f"ORDER#{date}#{order_id}"}
    identity = get_identity(event)
    existing = TBL().get_item(Key=key).get("Item")
    if not existing:
        return not_found("order not found")
    update_fields = {}
    if "status" in body:
        new_status = body["status"]
        if new_status not in ("open", "completed"):
            return bad_request("status must be 'open' or 'completed'")
        update_fields["status"] = new_status
        if new_status == "completed":
            update_fields["completed_at"] = _now()
            update_fields["completed_by"] = identity["name"] or identity["email"]
        else:
            update_fields["completed_at"] = ""
            update_fields["completed_by"] = ""
    if not update_fields:
        return bad_request("nothing to update")
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key=key,
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return ok({"updated": True})


@router.delete("/api/dinner-orders/{property_id}/{order_id}")
def delete_order(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    date = qs.get("date") or _today()
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"ORDER#{date}#{params['order_id']}",
    })
    return ok({"deleted": True})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
