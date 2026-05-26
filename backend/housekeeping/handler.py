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
from collections import defaultdict
from datetime import datetime, timedelta, timezone

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
        "floor": int(it["floor"]) if it.get("floor") not in (None, "") else None,
        "date": it.get("date", ""),
        "status": it.get("status", "open"),
        "notes": it.get("notes", ""),
        "assigned_at": it.get("assigned_at", ""),
        "assigned_by": it.get("assigned_by", ""),
        "started_at": it.get("started_at", "") or None,
        "completed_at": it.get("completed_at", "") or None,
    }


def _calculate_pace(assigned, done, current_hour):
    if assigned == 0:
        return "not_started"
    rate = done / assigned
    if current_hour < 10:
        return "not_started" if done == 0 else "on_track"
    if current_hour < 14:
        if rate >= 0.7:
            return "fast"
        if rate >= 0.4:
            return "on_track"
        return "slow"
    if rate >= 1.0:
        return "fast"
    if rate >= 0.7:
        return "on_track"
    return "slow"


def _estimate_finish(done, assigned, completions):
    if done == 0 or assigned == 0 or done >= assigned:
        return "Completed" if done >= assigned and assigned > 0 else None
    times = [r.get("completed_at") for r in completions if r.get("completed_at")]
    if not times:
        return None
    parsed = []
    for t in times:
        try:
            parsed.append(datetime.fromisoformat(str(t).replace("Z", "+00:00")))
        except ValueError:
            pass
    if not parsed:
        return None
    first = min(parsed)
    if first.tzinfo is None:
        first = first.replace(tzinfo=timezone.utc)
    now = datetime.now(tz=first.tzinfo)
    elapsed_hours = (now - first).total_seconds() / 3600
    if elapsed_hours <= 0:
        return None
    rate_per_hour = done / elapsed_hours
    if rate_per_hour == 0:
        return None
    hours_left = (assigned - done) / rate_per_hour
    finish = now + timedelta(hours=hours_left)
    return finish.strftime("%I:%M %p").lstrip("0")


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
    floor = int(room_number[0]) if room_number and room_number[0].isdigit() else None
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"ASSIGN#{date}#{assignment_id}",
        "assignment_id": assignment_id,
        "housekeeper_id": housekeeper_id,
        "housekeeper_name": roster_item.get("name", ""),
        "room_number": room_number,
        "floor": floor,
        "date": date,
        "status": "open",
        "notes": notes,
        "assigned_at": _now(),
        "assigned_by": identity["name"] or identity["email"],
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"assignment_id": assignment_id})


@router.put("/api/housekeeping/{property_id}/assignments/{assignment_id}/status")
def set_assignment_status(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    qs = query_params(event)
    date = body.get("date") or qs.get("date") or _today()
    new_status = body.get("status")
    if new_status not in ("open", "in_progress", "done"):
        return bad_request("status must be 'open', 'in_progress', or 'done'")
    key = {"PK": f"PROPERTY#{pid}", "SK": f"ASSIGN#{date}#{params['assignment_id']}"}
    existing = TBL().get_item(Key=key).get("Item")
    if not existing:
        return not_found("assignment not found")
    update_fields = {"status": new_status}
    now = _now()
    if new_status == "done":
        update_fields["completed_at"] = now
    elif new_status == "in_progress" and not existing.get("started_at"):
        update_fields["started_at"] = now
    elif new_status == "open":
        update_fields["completed_at"] = ""
        update_fields["started_at"] = ""
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key=key, UpdateExpression=expr,
        ExpressionAttributeNames=names, ExpressionAttributeValues=values,
    )
    return ok({"updated": True, "status": new_status})


@router.post("/api/housekeeping/{property_id}/assignments/transfer")
def transfer_assignments(event, params):
    """Reassign one or more non-done rooms from one housekeeper to another."""
    pid = params["property_id"]
    err = authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    date = body.get("date") or _today()
    from_id = (body.get("from_housekeeper_id") or "").strip()
    to_id = (body.get("to_housekeeper_id") or "").strip()
    if not from_id or not to_id:
        return bad_request("from_housekeeper_id and to_housekeeper_id required")
    if from_id == to_id:
        return bad_request("from and to housekeepers must be different")
    to_roster = TBL().get_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"ROSTER#{to_id}"}
    ).get("Item")
    if not to_roster:
        return bad_request("destination housekeeper not found")
    to_name = to_roster.get("name", "")
    room_numbers = body.get("room_numbers") or []  # [] means all non-done
    if room_numbers and not isinstance(room_numbers, list):
        return bad_request("room_numbers must be a list")
    raw = query_pk(TBL(), f"PROPERTY#{pid}", f"ASSIGN#{date}#")
    candidates = [
        r for r in raw
        if r.get("housekeeper_id") == from_id
        and r.get("status") != "done"
        and (not room_numbers or r.get("room_number") in set(room_numbers))
    ]
    if not candidates:
        return ok({"transferred_count": 0, "message": "No eligible rooms to transfer"})
    for r in candidates:
        TBL().update_item(
            Key={"PK": r["PK"], "SK": r["SK"]},
            UpdateExpression="SET #h = :h, #n = :n",
            ExpressionAttributeNames={"#h": "housekeeper_id", "#n": "housekeeper_name"},
            ExpressionAttributeValues={":h": to_id, ":n": to_name},
        )
    return ok({"transferred_count": len(candidates), "message": f"{len(candidates)} room(s) transferred to {to_name}"})


@router.get("/api/housekeeping/{property_id}/progress")
def progress(event, params):
    """Per-housekeeper pace + ETA for the dashboard heatmap."""
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    date = qs.get("date") or _today()
    raw = query_pk(TBL(), f"PROPERTY#{pid}", f"ASSIGN#{date}#")
    assignments = [_serialize_assignment(it) for it in raw]
    roster = [_serialize_roster(r) for r in query_pk(TBL(), f"PROPERTY#{pid}", "ROSTER#") if r.get("active", True)]
    current_hour = datetime.now(tz=timezone.utc).hour
    by_hk = defaultdict(list)
    for a in assignments:
        by_hk[a["housekeeper_id"]].append(a)
    hk_progress = []
    for hk in roster:
        rows = by_hk.get(hk["housekeeper_id"], [])
        assigned = len(rows)
        done = sum(1 for r in rows if r["status"] == "done")
        pending = sum(1 for r in rows if r["status"] == "open")
        in_progress = sum(1 for r in rows if r["status"] == "in_progress")
        rate = round(done / assigned * 100, 1) if assigned else 0.0
        hk_progress.append({
            "housekeeper_id": hk["housekeeper_id"],
            "housekeeper_name": hk["name"],
            "assigned": assigned,
            "done": done,
            "pending": pending,
            "in_progress": in_progress,
            "completion_rate": rate,
            "pace": _calculate_pace(assigned, done, current_hour),
            "estimated_finish": _estimate_finish(done, assigned, rows),
        })
    # also include any orphaned housekeeper_ids found in assignments
    seen_ids = {h["housekeeper_id"] for h in hk_progress}
    for a in assignments:
        if a["housekeeper_id"] and a["housekeeper_id"] not in seen_ids:
            seen_ids.add(a["housekeeper_id"])
            rows = by_hk.get(a["housekeeper_id"], [])
            assigned = len(rows)
            done = sum(1 for r in rows if r["status"] == "done")
            hk_progress.append({
                "housekeeper_id": a["housekeeper_id"],
                "housekeeper_name": a.get("housekeeper_name", ""),
                "assigned": assigned,
                "done": done,
                "pending": sum(1 for r in rows if r["status"] == "open"),
                "in_progress": sum(1 for r in rows if r["status"] == "in_progress"),
                "completion_rate": round(done / assigned * 100, 1) if assigned else 0.0,
                "pace": _calculate_pace(assigned, done, current_hour),
                "estimated_finish": _estimate_finish(done, assigned, rows),
            })

    total_assigned = len(assignments)
    total_done = sum(1 for a in assignments if a["status"] == "done")
    total_pending = sum(1 for a in assignments if a["status"] == "open")
    overall_rate = round(total_done / total_assigned * 100, 1) if total_assigned else 0.0
    return ok({
        "date": date,
        "total_assigned": total_assigned,
        "total_done": total_done,
        "total_pending": total_pending,
        "overall_completion_rate": overall_rate,
        "housekeepers": hk_progress,
    })


@router.get("/api/housekeeping/{property_id}/timeline")
def timeline(event, params):
    """Reverse-chronological list of completed rooms for the day."""
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    date = qs.get("date") or _today()
    raw = query_pk(TBL(), f"PROPERTY#{pid}", f"ASSIGN#{date}#")
    done = [it for it in raw if it.get("status") == "done" and it.get("completed_at")]
    done.sort(key=lambda r: r.get("completed_at") or "", reverse=True)
    out = []
    for r in done:
        ts = r.get("completed_at") or ""
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            time_display = dt.strftime("%I:%M %p").lstrip("0")
        except ValueError:
            time_display = ts
        out.append({
            "assignment_id": r.get("assignment_id", ""),
            "room_number": r.get("room_number", ""),
            "floor": int(r["floor"]) if r.get("floor") not in (None, "") else None,
            "housekeeper_name": r.get("housekeeper_name", ""),
            "completed_at": ts,
            "time_display": time_display,
        })
    return ok({"timeline": out})


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
