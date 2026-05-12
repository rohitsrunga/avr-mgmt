"""Park & Fly vehicle log.

PK = PROPERTY#<property_id>
SK = VEHICLE#<vehicle_id>

GSI ActiveVehiclesIndex:
  GSI1PK = PROPERTY#<property_id>#STATUS#<active|archived>
  GSI1SK = check_out date
"""
import uuid
from datetime import date as date_cls, datetime, timezone
from decimal import Decimal

from shared.auth import ALL_ROLES, authorize_property, get_identity
from shared.dynamo import query_gsi, query_pk, table, to_dynamo
from shared.response import bad_request, not_found, ok, server_error
from shared.router import Router, parse_body, query_params

router = Router()
TBL = lambda: table("TABLE_PARKFLY")

PROPERTY_PRICING = {
    "casco_bay": Decimal("10"),
    "saco_bay": Decimal("10"),
}
PROPERTY_PREFIX = {
    "casco_bay": "CB",
    "saco_bay": "SB",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def _next_tag(pid):
    """Find the next sequential tag number per property."""
    prefix = PROPERTY_PREFIX.get(pid, pid[:2].upper())
    items = query_pk(TBL(), f"PROPERTY#{pid}", "VEHICLE#")
    max_n = 0
    for it in items:
        tag = it.get("tag_number", "")
        if tag.startswith(f"{prefix}-"):
            try:
                n = int(tag.split("-", 1)[1])
                max_n = max(max_n, n)
            except ValueError:
                continue
    return f"{prefix}-{max_n + 1:03d}"


def _serialize(item):
    return {
        "vehicle_id": item.get("vehicle_id", ""),
        "guest_name": item.get("guest_name", ""),
        "phone": item.get("phone", ""),
        "check_in": item.get("check_in", ""),
        "check_out": item.get("check_out", ""),
        "vehicle_make_model": item.get("vehicle_make_model", ""),
        "license_plate": item.get("license_plate", ""),
        "parking_days": int(item.get("parking_days", 0)),
        "total_fee": float(item.get("total_fee", 0)),
        "tag_number": item.get("tag_number", ""),
        "staff_name": item.get("staff_name", ""),
        "issued_at": item.get("issued_at", ""),
        "paid": bool(item.get("paid", False)),
        "status": item.get("status", "active"),
        "notes": item.get("notes", ""),
    }


@router.get("/api/parkfly/{property_id}")
def list_active(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    status = qs.get("status", "active")
    items = query_gsi(
        TBL(), "ActiveVehiclesIndex",
        "GSI1PK", f"PROPERTY#{pid}#STATUS#{status}",
    )
    return ok({"vehicles": [_serialize(i) for i in items]})


@router.get("/api/parkfly/{property_id}/archive")
def list_archive(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    items = query_gsi(
        TBL(), "ActiveVehiclesIndex",
        "GSI1PK", f"PROPERTY#{pid}#STATUS#archived",
    )
    return ok({"vehicles": [_serialize(i) for i in items]})


@router.post("/api/parkfly/{property_id}")
def create_vehicle(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    required = ["guest_name", "check_in", "check_out", "vehicle_make_model", "license_plate"]
    for field in required:
        if not body.get(field):
            return bad_request(f"{field} required")
    try:
        d_in = _parse_date(body["check_in"])
        d_out = _parse_date(body["check_out"])
    except ValueError:
        return bad_request("dates must be YYYY-MM-DD")
    if d_out <= d_in:
        return bad_request("check_out must be after check_in")

    days = (d_out - d_in).days
    rate = PROPERTY_PRICING.get(pid, Decimal("10"))
    total = rate * Decimal(days)

    vehicle_id = str(uuid.uuid4())[:8]
    tag = _next_tag(pid)
    identity = get_identity(event)

    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"VEHICLE#{vehicle_id}",
        "vehicle_id": vehicle_id,
        "guest_name": body["guest_name"],
        "phone": body.get("phone", ""),
        "check_in": body["check_in"],
        "check_out": body["check_out"],
        "vehicle_make_model": body["vehicle_make_model"],
        "license_plate": body["license_plate"],
        "parking_days": days,
        "total_fee": total,
        "tag_number": tag,
        "staff_name": identity["name"] or identity["email"],
        "issued_at": _now(),
        "paid": bool(body.get("paid", False)),
        "status": "active",
        "notes": body.get("notes", ""),
        "GSI1PK": f"PROPERTY#{pid}#STATUS#active",
        "GSI1SK": body["check_out"],
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"vehicle_id": vehicle_id, "tag_number": tag, "total_fee": float(total), "parking_days": days})


@router.put("/api/parkfly/{property_id}/{vehicle_id}")
def update_vehicle(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    key = {"PK": f"PROPERTY#{pid}", "SK": f"VEHICLE#{params['vehicle_id']}"}
    existing = TBL().get_item(Key=key).get("Item")
    if not existing:
        return not_found("vehicle not found")

    update_fields = {}
    for field in ["paid", "notes", "status", "phone"]:
        if field in body:
            update_fields[field] = body[field]
    if "status" in update_fields:
        update_fields["GSI1PK"] = f"PROPERTY#{pid}#STATUS#{update_fields['status']}"
        update_fields["GSI1SK"] = existing.get("check_out", "")

    if not update_fields:
        return bad_request("no fields to update")

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


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
