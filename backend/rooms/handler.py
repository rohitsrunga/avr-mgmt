"""Room equipment audit.

PK = PROPERTY#<property_id>
SK = ROOM#<room_number>
"""
from datetime import datetime, timezone

from shared.auth import (
    ALL_ROLES,
    MANAGEMENT_ROLES,
    authorize_property,
    get_identity,
)
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, ok, server_error
from shared.router import Router, parse_body

router = Router()
TBL = lambda: table("TABLE_ROOMS")

EQUIPMENT_FIELDS = [
    "comforter_cover", "cabinet", "ironing_board", "iron_hanger", "iron",
    "luggage_rack", "hangers", "microwave", "fridge", "ice_bucket",
    "keurig", "desk_chair", "lounge_chair", "hairdryer", "soap_dish",
]

ISSUE_VALUES = {"no", "Not Attached", "Melting", "old"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _has_issue(item):
    if (item.get("notes") or "").strip():
        return True
    for field in EQUIPMENT_FIELDS:
        v = (item.get(field) or "").strip()
        if v in ISSUE_VALUES:
            return True
    return False


def _serialize(item):
    out = {
        "room_number": item.get("room_number", ""),
        "last_audited": item.get("last_audited", ""),
        "audited_by": item.get("audited_by", ""),
        "notes": item.get("notes", ""),
        "has_issue": _has_issue(item),
    }
    for field in EQUIPMENT_FIELDS:
        out[field] = item.get(field, "")
    return out


@router.get("/api/rooms/{property_id}")
def list_rooms(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    items = query_pk(TBL(), f"PROPERTY#{pid}", "ROOM#")
    rooms = [_serialize(it) for it in items]
    rooms.sort(key=lambda r: r["room_number"])
    return ok({"rooms": rooms})


@router.put("/api/rooms/{property_id}/{room_number}")
def update_room(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    room_number = params["room_number"]
    identity = get_identity(event)

    update_fields = {}
    for field in EQUIPMENT_FIELDS + ["notes"]:
        if field in body:
            update_fields[field] = body[field]
    update_fields["last_audited"] = _now()
    update_fields["audited_by"] = identity["name"] or identity["email"]
    update_fields["room_number"] = room_number

    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"ROOM#{room_number}"},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return ok({"updated": True})


@router.post("/api/rooms/{property_id}")
def create_room(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    body = parse_body(event)
    room_number = body.get("room_number")
    if not room_number:
        return bad_request("room_number required")
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"ROOM#{room_number}",
        "room_number": room_number,
        "notes": body.get("notes", ""),
    }
    for field in EQUIPMENT_FIELDS:
        item[field] = body.get(field, "")
    TBL().put_item(Item=to_dynamo(item))
    return ok({"created": True})


@router.delete("/api/rooms/{property_id}/{room_number}")
def delete_room(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"ROOM#{params['room_number']}",
    })
    return ok({"deleted": True})


@router.get("/api/rooms/{property_id}/issues")
def issues(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    items = query_pk(TBL(), f"PROPERTY#{pid}", "ROOM#")
    rooms = [_serialize(it) for it in items if _has_issue(it)]
    rooms.sort(key=lambda r: r["room_number"])
    return ok({"rooms": rooms})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
