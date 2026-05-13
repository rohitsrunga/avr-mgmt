"""Housekeeping: lightweight roster (names, no logins) + per-day room assignments.

PK = PROPERTY#<property_id>
SK options:
  ROSTER#<housekeeper_id>            roster entry
  ASSIGN#<YYYY-MM-DD>#<assign_id>    daily room assignment

Public routes (no auth) live under /api/public/housekeeping/* and are consumed
by the static S3 form that housekeepers use on their phones. Authenticated
routes under /api/housekeeping/* power the manager dashboard.
"""
import re
import uuid
from datetime import datetime, timezone

from shared.auth import (
    ALL_ROLES,
    MANAGEMENT_ROLES,
    authorize_property,
    get_identity,
)
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, not_found, ok, server_error
from shared.router import Router, parse_body, query_params

router = Router()
TBL = lambda: table("TABLE_HOUSEKEEPING")

ALLOWED_PROPERTIES = {"casco_bay", "saco_bay"}
DASHBOARD_ROLES = ["owner", "manager", "frontdesk"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or uuid.uuid4().hex[:8]


def _serialize_roster(it):
    return {
        "housekeeper_id": it.get("housekeeper_id", ""),
        "name": it.get("name", ""),
        "active": bool(it.get("active", True)),
    }


def _serialize_assignment(it):
    return {
        "assignment_id": it.get("assignment_id", ""),
        "housekeeper_id": it.get("housekeeper_id", ""),
        "housekeeper_name": it.get("housekeeper_name", ""),
        "room_number": it.get("room_number", ""),
        "date": it.get("date", ""),
        "status": it.get("status", "open"),
        "notes": it.get("notes", ""),
        "assigned_at": it.get("assigned_at", ""),
        "assigned_by": it.get("assigned_by", ""),
        "completed_at": it.get("completed_at", ""),
    }


def _check_property(pid):
    if pid not in ALLOWED_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    return None


# ======================================================================
# Public routes (no auth) — consumed by the static S3 housekeeping form
# ======================================================================

@router.get("/api/public/housekeeping/{property_id}/roster")
def public_roster(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    raw = query_pk(TBL(), f"PROPERTY#{pid}", "ROSTER#")
    roster = [_serialize_roster(it) for it in raw if it.get("active", True)]
    roster.sort(key=lambda r: r["name"].lower())
    return ok({"roster": roster})


@router.get("/api/public/housekeeping/{property_id}/assignments")
def public_assignments(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    qs = query_params(event)
    housekeeper_id = qs.get("housekeeper_id")
    date = qs.get("date") or _today()
    if not housekeeper_id:
        return bad_request("housekeeper_id required")
    raw = query_pk(TBL(), f"PROPERTY#{pid}", f"ASSIGN#{date}#")
    mine = [_serialize_assignment(it) for it in raw if it.get("housekeeper_id") == housekeeper_id]
    mine.sort(key=lambda a: a["room_number"])
    return ok({"date": date, "housekeeper_id": housekeeper_id, "assignments": mine})


@router.post("/api/public/housekeeping/{property_id}/assignments/{assignment_id}/complete")
def public_complete(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    date = body.get("date") or _today()
    completed = bool(body.get("completed", True))
    notes = (body.get("notes") or "").strip()[:300]
    key = {"PK": f"PROPERTY#{pid}", "SK": f"ASSIGN#{date}#{params['assignment_id']}"}
    existing = TBL().get_item(Key=key).get("Item")
    if not existing:
        return not_found("assignment not found")
    update_fields = {
        "status": "done" if completed else "open",
        "completed_at": _now() if completed else "",
    }
    if notes:
        update_fields["notes"] = notes
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


# ======================================================================
# Authenticated routes — manager dashboard
# ======================================================================

@router.get("/api/housekeeping/{property_id}/roster")
def list_roster(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    raw = query_pk(TBL(), f"PROPERTY#{pid}", "ROSTER#")
    roster = [_serialize_roster(it) for it in raw]
    roster.sort(key=lambda r: r["name"].lower())
    return ok({"roster": roster})


@router.post("/api/housekeeping/{property_id}/roster")
def add_roster(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    name = (body.get("name") or "").strip()
    if not name or len(name) > 80:
        return bad_request("name required (1-80 chars)")
    housekeeper_id = _slug(name)
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"ROSTER#{housekeeper_id}",
        "housekeeper_id": housekeeper_id,
        "name": name,
        "active": True,
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"housekeeper_id": housekeeper_id, "name": name})


@router.put("/api/housekeeping/{property_id}/roster/{housekeeper_id}")
def update_roster(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    update_fields = {}
    if "active" in body:
        update_fields["active"] = bool(body["active"])
    if "name" in body:
        new_name = (body.get("name") or "").strip()
        if not new_name or len(new_name) > 80:
            return bad_request("name must be 1-80 chars")
        update_fields["name"] = new_name
    if not update_fields:
        return bad_request("nothing to update")
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"ROSTER#{params['housekeeper_id']}"},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return ok({"updated": True})


@router.delete("/api/housekeeping/{property_id}/roster/{housekeeper_id}")
def delete_roster(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"ROSTER#{params['housekeeper_id']}",
    })
    return ok({"deleted": True})


@router.get("/api/housekeeping/{property_id}/assignments")
def list_assignments(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    date = qs.get("date") or _today()
    raw = query_pk(TBL(), f"PROPERTY#{pid}", f"ASSIGN#{date}#")
    out = [_serialize_assignment(it) for it in raw]
    out.sort(key=lambda a: (a["housekeeper_name"], a["room_number"]))
    return ok({"date": date, "assignments": out})


@router.post("/api/housekeeping/{property_id}/assignments")
def create_assignment(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    housekeeper_id = (body.get("housekeeper_id") or "").strip()
    room_number = (body.get("room_number") or "").strip()
    date = body.get("date") or _today()
    notes = (body.get("notes") or "").strip()[:300]
    if not housekeeper_id or not room_number:
        return bad_request("housekeeper_id and room_number required")
    roster_item = TBL().get_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"ROSTER#{housekeeper_id}"}
    ).get("Item")
    if not roster_item:
        return bad_request("housekeeper not found")
    assignment_id = uuid.uuid4().hex[:10]
    identity = get_identity(event)
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"ASSIGN#{date}#{assignment_id}",
        "assignment_id": assignment_id,
        "housekeeper_id": housekeeper_id,
        "housekeeper_name": roster_item.get("name", ""),
        "room_number": room_number,
        "date": date,
        "status": "open",
        "notes": notes,
        "assigned_at": _now(),
        "assigned_by": identity["name"] or identity["email"],
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"assignment_id": assignment_id})


@router.delete("/api/housekeeping/{property_id}/assignments/{assignment_id}")
def delete_assignment(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    qs = query_params(event)
    date = qs.get("date") or _today()
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"ASSIGN#{date}#{params['assignment_id']}",
    })
    return ok({"deleted": True})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
