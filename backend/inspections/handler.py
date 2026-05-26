"""Inspections — room inspections, issues, photos (Casco Bay).

PK = PROPERTY#<property_id>
SK patterns:
  INSPECTOR#<inspector_id>                          inspector roster entry
  INSPECTION#<YYYY-MM-DD>#<inspection_id>           inspection record
  ISSUE#<issue_id>                                  issue raised during an inspection

Inspection-photos live in a private S3 bucket. The Lambda issues presigned
PUT URLs to the public inspection form so phones can upload directly, and
presigned GET URLs to the dashboard so managers can view them.

Public routes are exposed for the unauthenticated phone form. They are
strictly validated server-side since there is no JWT in front of them.
"""
import os
import re
import time
import uuid
from collections import defaultdict
from datetime import date as date_cls, datetime, timedelta, timezone

import boto3
from botocore.config import Config as BotoConfig

from shared.auth import ALL_ROLES, MANAGEMENT_ROLES, authorize_property, get_identity
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, forbidden, not_found, ok, server_error
from shared.router import Router, parse_body, query_params
from shared.settings import VALID_PROPERTIES, is_feature_enabled

router = Router()
TBL = lambda: table("TABLE_INSPECTIONS")

FEATURE_ID = "inspections"
DASHBOARD_ROLES = ["owner", "manager", "frontdesk"]

VALID_INSPECTION_TYPES = ["routine", "post_checkout", "post_maintenance", "deep_clean", "pre_vip"]
VALID_CONDITIONS = ["excellent", "good", "fair", "poor"]
VALID_CATEGORIES = ["cleanliness", "maintenance", "furniture", "plumbing", "electrical", "hvac", "safety", "cosmetic"]
VALID_SEVERITIES = ["urgent", "standard", "minor", "note"]
VALID_ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"]
VALID_INSPECTION_STATUSES = ["in_progress", "submitted"]

INSPECTION_TYPE_LABELS = {
    "routine": "Routine Check",
    "post_checkout": "Post-Checkout",
    "post_maintenance": "Post-Maintenance",
    "deep_clean": "Deep Clean",
    "pre_vip": "Pre-VIP",
}
CATEGORY_LABELS = {
    "cleanliness": "Cleanliness", "maintenance": "Maintenance", "furniture": "Furniture",
    "plumbing": "Plumbing", "electrical": "Electrical", "hvac": "HVAC",
    "safety": "Safety", "cosmetic": "Cosmetic",
}
CATEGORY_EMOJIS = {
    "cleanliness": "🧹", "maintenance": "🔧", "furniture": "🪑",
    "plumbing": "🚿", "electrical": "⚡", "hvac": "❄️",
    "safety": "🔒", "cosmetic": "🎨",
}
SEVERITY_LABELS = {"urgent": "Urgent", "standard": "Standard", "minor": "Minor", "note": "Note"}
SLA_HOURS = {"urgent": 4.0, "standard": 24.0, "minor": 72.0, "note": None}

QUICK_CHECK_ITEMS = [
    {"id": "bed_made", "label": "Bed made properly"},
    {"id": "bathroom_clean", "label": "Bathroom clean"},
    {"id": "floor_vacuumed", "label": "Floor vacuumed/mopped"},
    {"id": "windows_clean", "label": "Windows clean"},
    {"id": "ac_working", "label": "AC/Heat working"},
    {"id": "tv_working", "label": "TV working"},
    {"id": "safe_working", "label": "Safe working"},
    {"id": "fridge_working", "label": "Mini fridge working"},
    {"id": "towels_stocked", "label": "Towels stocked"},
    {"id": "toiletries_stocked", "label": "Toiletries stocked"},
    {"id": "door_lock_working", "label": "Door lock working"},
    {"id": "lights_working", "label": "All lights working"},
]

_s3_client = boto3.client("s3", config=BotoConfig(signature_version="s3v4"))
PRESIGN_TTL = 900  # 15 min


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _check_property(pid):
    if pid not in VALID_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    if not is_feature_enabled(pid, FEATURE_ID):
        return forbidden("Inspections are disabled for this property")
    return None


def _bucket():
    return os.environ["INSPECTION_PHOTOS_BUCKET"]


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or uuid.uuid4().hex[:8]


def _parse_dt(s):
    if not s:
        return None
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def _photo_view_url(key):
    if not key:
        return None
    return _s3_client.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": _bucket(), "Key": key},
        ExpiresIn=PRESIGN_TTL,
    )


def _serialize_inspector(it):
    return {
        "inspector_id": it.get("inspector_id", ""),
        "name": it.get("name", ""),
        "active": bool(it.get("active", True)),
        "created_at": it.get("created_at", ""),
    }


def _serialize_inspection(it, *, with_photo_urls=True):
    quick = it.get("quick_checks") or {}
    out = {
        "inspection_id": it.get("inspection_id", ""),
        "room_number": it.get("room_number", ""),
        "floor": int(it.get("floor", 0) or 0),
        "inspector_id": it.get("inspector_id", ""),
        "inspector_name": it.get("inspector_name", ""),
        "inspection_type": it.get("inspection_type", "routine"),
        "status": it.get("status", "in_progress"),
        "overall_cleanliness": int(it["overall_cleanliness"]) if it.get("overall_cleanliness") not in (None, "") else None,
        "overall_condition": it.get("overall_condition") or None,
        "quick_checks": dict(quick),
        "general_notes": it.get("general_notes", ""),
        "started_at": it.get("started_at", ""),
        "submitted_at": it.get("submitted_at", "") or None,
        "duration_minutes": float(it["duration_minutes"]) if it.get("duration_minutes") not in (None, "") else None,
        "date": it.get("date", ""),
    }
    return out


def _serialize_issue(it, *, with_photo_urls=True):
    sev = it.get("severity", "standard")
    created_at = it.get("created_at")
    resolved_at = it.get("resolved_at")
    time_open = _compute_time_open_hours(created_at, resolved_at)
    sla_status = _compute_sla_status(sev, created_at, resolved_at)
    before_key = it.get("before_photo_key") or ""
    after_key = it.get("after_photo_key") or ""
    out = {
        "issue_id": it.get("issue_id", ""),
        "inspection_id": it.get("inspection_id", ""),
        "room_number": it.get("room_number", ""),
        "category": it.get("category", "maintenance"),
        "severity": sev,
        "location_in_room": it.get("location_in_room", ""),
        "description": it.get("description", ""),
        "status": it.get("status", "open"),
        "created_at": created_at or "",
        "work_started_at": it.get("work_started_at", "") or None,
        "resolved_at": resolved_at or None,
        "resolved_by": it.get("resolved_by", ""),
        "resolution_notes": it.get("resolution_notes", ""),
        "closed_at": it.get("closed_at", "") or None,
        "before_photo_key": before_key,
        "after_photo_key": after_key,
        "before_photo_url": _photo_view_url(before_key) if with_photo_urls and before_key else None,
        "after_photo_url": _photo_view_url(after_key) if with_photo_urls and after_key else None,
        "time_open_hours": time_open,
        "sla_status": sla_status,
    }
    return out


def _compute_time_open_hours(created_at, resolved_at=None):
    c = _parse_dt(created_at)
    if not c:
        return None
    r = _parse_dt(resolved_at) if resolved_at else datetime.now(tz=timezone.utc)
    return round((r - c).total_seconds() / 3600, 2)


def _compute_sla_status(severity, created_at, resolved_at=None):
    if severity == "note" or SLA_HOURS.get(severity) is None:
        return "no_sla"
    c = _parse_dt(created_at)
    if not c:
        return "no_sla"
    r = _parse_dt(resolved_at) if resolved_at else datetime.now(tz=timezone.utc)
    hours = (r - c).total_seconds() / 3600
    sla = SLA_HOURS[severity]
    if resolved_at:
        return "within_sla" if hours <= sla else "breached"
    if hours >= sla:
        return "breached"
    if hours >= sla * 0.75:
        return "at_risk"
    return "within_sla"


def _validate_room_number(rn):
    rn = (rn or "").strip()
    if not rn:
        return None, "room_number required"
    if not rn.isdigit() or len(rn) != 3:
        return None, "room_number must be 3 digits"
    floor = int(rn[0])
    room_num = int(rn[1:])
    if floor < 1 or floor > 4 or room_num < 1 or room_num > 34:
        return None, "room_number must be 101–134, 201–234, 301–334, or 401–434"
    return rn, None


def _all_rooms():
    rooms = []
    for floor in (1, 2, 3, 4):
        for n in range(1, 35):
            rooms.append({"room_number": f"{floor}{n:02d}", "floor": floor})
    return rooms


def _get_inspection(pid, day, inspection_id):
    return TBL().get_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"INSPECTION#{day}#{inspection_id}"}
    ).get("Item")


def _find_inspection(pid, inspection_id):
    """Walk INSPECTION# keys to find by id (used when date isn't known)."""
    items = query_pk(TBL(), f"PROPERTY#{pid}", "INSPECTION#")
    for it in items:
        if it.get("inspection_id") == inspection_id:
            return it
    return None


def _get_issue(pid, issue_id):
    return TBL().get_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"ISSUE#{issue_id}"}
    ).get("Item")


# ======================================================================
# Meta — constants used by the form & dashboard
# ======================================================================

@router.get("/api/inspections/meta/constants")
def meta_authed(event, params):
    return ok(_meta_payload())


@router.get("/api/public/inspections/meta/constants")
def meta_public(event, params):
    return ok(_meta_payload())


def _meta_payload():
    return {
        "inspection_types": VALID_INSPECTION_TYPES,
        "inspection_type_labels": INSPECTION_TYPE_LABELS,
        "conditions": VALID_CONDITIONS,
        "categories": VALID_CATEGORIES,
        "category_labels": CATEGORY_LABELS,
        "category_emojis": CATEGORY_EMOJIS,
        "severities": VALID_SEVERITIES,
        "severity_labels": SEVERITY_LABELS,
        "issue_statuses": VALID_ISSUE_STATUSES,
        "sla_hours": SLA_HOURS,
        "quick_check_items": QUICK_CHECK_ITEMS,
        "rooms": _all_rooms(),
    }


# ======================================================================
# Inspectors — shared roster
# ======================================================================

def _list_inspectors_raw(pid, include_inactive=False):
    raw = query_pk(TBL(), f"PROPERTY#{pid}", "INSPECTOR#")
    out = [_serialize_inspector(r) for r in raw]
    if not include_inactive:
        out = [r for r in out if r["active"]]
    out.sort(key=lambda r: r["name"].lower())
    return out


@router.get("/api/public/inspections/{property_id}/inspectors")
def public_list_inspectors(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    return ok({"inspectors": _list_inspectors_raw(pid)})


@router.get("/api/inspections/{property_id}/inspectors")
def list_inspectors(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    include_inactive = (qs.get("include_inactive") or "").lower() in ("1", "true", "yes")
    return ok({"inspectors": _list_inspectors_raw(pid, include_inactive)})


@router.post("/api/inspections/{property_id}/inspectors")
def add_inspector(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    name = (body.get("name") or "").strip()
    if len(name) < 2 or len(name) > 50:
        return bad_request("Name must be 2-50 characters")
    inspector_id = _slug(name)
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"INSPECTOR#{inspector_id}",
        "inspector_id": inspector_id,
        "name": name,
        "active": True,
        "created_at": _now(),
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"inspector": _serialize_inspector(item)})


@router.put("/api/inspections/{property_id}/inspectors/{inspector_id}")
def update_inspector(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    update_fields = {}
    if "name" in body:
        n = (body.get("name") or "").strip()
        if len(n) < 2 or len(n) > 50:
            return bad_request("Name must be 2-50 characters")
        update_fields["name"] = n
    if "active" in body:
        update_fields["active"] = bool(body["active"])
    if not update_fields:
        return bad_request("nothing to update")
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"INSPECTOR#{params['inspector_id']}"},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return ok({"updated": True})


@router.delete("/api/inspections/{property_id}/inspectors/{inspector_id}")
def remove_inspector(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    # Soft-delete (deactivate) to keep historical inspections joinable.
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"INSPECTOR#{params['inspector_id']}"},
        UpdateExpression="SET #a = :a",
        ExpressionAttributeNames={"#a": "active"},
        ExpressionAttributeValues={":a": False},
    )
    return ok({"deactivated": True})


# ======================================================================
# Inspections — start / update / submit
# ======================================================================

def _start_inspection_record(pid, body, *, authed_identity=None):
    rn, err = _validate_room_number(body.get("room_number"))
    if err:
        return None, bad_request(err)
    inspector_id = (body.get("inspector_id") or "").strip()
    if not inspector_id:
        return None, bad_request("inspector_id required")
    inspector = TBL().get_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"INSPECTOR#{inspector_id}"}
    ).get("Item")
    if not inspector or not inspector.get("active", True):
        return None, bad_request("inspector not found")
    insp_type = body.get("inspection_type") or "routine"
    if insp_type not in VALID_INSPECTION_TYPES:
        return None, bad_request(f"inspection_type must be one of {VALID_INSPECTION_TYPES}")
    inspection_id = uuid.uuid4().hex[:12]
    now = _now()
    day = _today()
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"INSPECTION#{day}#{inspection_id}",
        "inspection_id": inspection_id,
        "date": day,
        "room_number": rn,
        "floor": int(rn[0]),
        "inspector_id": inspector_id,
        "inspector_name": inspector.get("name", ""),
        "inspection_type": insp_type,
        "status": "in_progress",
        "started_at": now,
        "quick_checks": {},
    }
    TBL().put_item(Item=to_dynamo(item))
    return item, None


@router.post("/api/inspections/{property_id}/start")
def start_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    item, err_resp = _start_inspection_record(pid, body, authed_identity=get_identity(event))
    if err_resp:
        return err_resp
    return ok({"inspection": _serialize_inspection(item)})


@router.post("/api/public/inspections/{property_id}/start")
def public_start_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    item, err_resp = _start_inspection_record(pid, body)
    if err_resp:
        return err_resp
    return ok({"inspection": _serialize_inspection(item)})


def _apply_inspection_update(pid, inspection_id, body, *, mark_submitted=False):
    existing = _find_inspection(pid, inspection_id)
    if not existing:
        return None, not_found("inspection not found")
    update_fields = {}
    if "overall_cleanliness" in body and body["overall_cleanliness"] is not None:
        try:
            v = int(body["overall_cleanliness"])
        except (TypeError, ValueError):
            return None, bad_request("overall_cleanliness must be 1-5")
        if v < 1 or v > 5:
            return None, bad_request("overall_cleanliness must be 1-5")
        update_fields["overall_cleanliness"] = v
    if "overall_condition" in body and body["overall_condition"]:
        if body["overall_condition"] not in VALID_CONDITIONS:
            return None, bad_request(f"overall_condition must be one of {VALID_CONDITIONS}")
        update_fields["overall_condition"] = body["overall_condition"]
    if "quick_checks" in body and isinstance(body["quick_checks"], dict):
        update_fields["quick_checks"] = body["quick_checks"]
    if "general_notes" in body:
        update_fields["general_notes"] = str(body.get("general_notes") or "")[:2000]
    if mark_submitted:
        if "overall_cleanliness" not in update_fields:
            return None, bad_request("overall_cleanliness required to submit")
        if "overall_condition" not in update_fields:
            return None, bad_request("overall_condition required to submit")
        update_fields["status"] = "submitted"
        update_fields["submitted_at"] = _now()
        started = _parse_dt(existing.get("started_at"))
        sub = _parse_dt(update_fields["submitted_at"])
        if started and sub:
            update_fields["duration_minutes"] = round((sub - started).total_seconds() / 60, 2)
    if not update_fields:
        return existing, None
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": existing["PK"], "SK": existing["SK"]},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    updated = TBL().get_item(Key={"PK": existing["PK"], "SK": existing["SK"]}).get("Item") or existing
    return updated, None


@router.put("/api/inspections/{property_id}/{inspection_id}")
def update_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    updated, err_resp = _apply_inspection_update(pid, params["inspection_id"], body)
    if err_resp:
        return err_resp
    return ok({"inspection": _serialize_inspection(updated)})


@router.put("/api/public/inspections/{property_id}/{inspection_id}")
def public_update_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    updated, err_resp = _apply_inspection_update(pid, params["inspection_id"], body)
    if err_resp:
        return err_resp
    return ok({"inspection": _serialize_inspection(updated)})


@router.post("/api/inspections/{property_id}/{inspection_id}/submit")
def submit_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    updated, err_resp = _apply_inspection_update(pid, params["inspection_id"], body, mark_submitted=True)
    if err_resp:
        return err_resp
    issues_raw = [it for it in query_pk(TBL(), f"PROPERTY#{pid}", "ISSUE#") if it.get("inspection_id") == params["inspection_id"]]
    return ok({
        "inspection": _serialize_inspection(updated),
        "duration_minutes": float(updated.get("duration_minutes", 0) or 0),
        "issues_count": len(issues_raw),
    })


@router.post("/api/public/inspections/{property_id}/{inspection_id}/submit")
def public_submit_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    updated, err_resp = _apply_inspection_update(pid, params["inspection_id"], body, mark_submitted=True)
    if err_resp:
        return err_resp
    return ok({"inspection": _serialize_inspection(updated)})


# ======================================================================
# Issues
# ======================================================================

def _create_issue_record(pid, body):
    inspection_id = (body.get("inspection_id") or "").strip()
    if not inspection_id:
        return None, bad_request("inspection_id required")
    if not _find_inspection(pid, inspection_id):
        return None, not_found("inspection not found")
    rn, err = _validate_room_number(body.get("room_number"))
    if err:
        return None, bad_request(err)
    category = body.get("category")
    if category not in VALID_CATEGORIES:
        return None, bad_request(f"category must be one of {VALID_CATEGORIES}")
    severity = body.get("severity") or "standard"
    if severity not in VALID_SEVERITIES:
        return None, bad_request(f"severity must be one of {VALID_SEVERITIES}")
    description = (body.get("description") or "").strip()
    if len(description) < 5:
        return None, bad_request("description must be at least 5 characters")
    issue_id = uuid.uuid4().hex[:12]
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"ISSUE#{issue_id}",
        "issue_id": issue_id,
        "inspection_id": inspection_id,
        "room_number": rn,
        "category": category,
        "severity": severity,
        "location_in_room": (body.get("location_in_room") or "").strip()[:200],
        "description": description[:1000],
        "status": "open",
        "before_photo_key": (body.get("before_photo_key") or "").strip(),
        "created_at": _now(),
    }
    TBL().put_item(Item=to_dynamo(item))
    return item, None


@router.post("/api/inspections/{property_id}/{inspection_id}/issues")
def add_issue(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    body["inspection_id"] = params["inspection_id"]
    item, err_resp = _create_issue_record(pid, body)
    if err_resp:
        return err_resp
    return ok({"issue": _serialize_issue(item)})


@router.post("/api/public/inspections/{property_id}/{inspection_id}/issues")
def public_add_issue(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    body["inspection_id"] = params["inspection_id"]
    item, err_resp = _create_issue_record(pid, body)
    if err_resp:
        return err_resp
    return ok({"issue": _serialize_issue(item, with_photo_urls=False)})


@router.put("/api/inspections/{property_id}/issues/{issue_id}/status")
def update_issue_status(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    existing = _get_issue(pid, params["issue_id"])
    if not existing:
        return not_found("issue not found")
    body = parse_body(event)
    new_status = body.get("status")
    if new_status not in VALID_ISSUE_STATUSES:
        return bad_request(f"status must be one of {VALID_ISSUE_STATUSES}")
    update_fields = {"status": new_status}
    now = _now()
    if new_status == "in_progress" and not existing.get("work_started_at"):
        update_fields["work_started_at"] = now
    elif new_status == "resolved":
        resolved_by = (body.get("resolved_by") or "").strip()
        if not resolved_by:
            identity = get_identity(event)
            resolved_by = identity["name"] or identity["email"] or "—"
        update_fields["resolved_at"] = now
        update_fields["resolved_by"] = resolved_by
        if body.get("resolution_notes") is not None:
            update_fields["resolution_notes"] = str(body["resolution_notes"])[:1000]
        if body.get("after_photo_key"):
            update_fields["after_photo_key"] = body["after_photo_key"]
    elif new_status == "closed":
        update_fields["closed_at"] = now
        if body.get("resolution_notes") is not None:
            update_fields["resolution_notes"] = str(body["resolution_notes"])[:1000]
    elif new_status == "open":
        update_fields["closed_at"] = ""
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": existing["PK"], "SK": existing["SK"]},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    updated = _get_issue(pid, params["issue_id"]) or existing
    return ok({"issue": _serialize_issue(updated)})


@router.get("/api/inspections/{property_id}/issues/open")
def list_open_issues(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    raw = query_pk(TBL(), f"PROPERTY#{pid}", "ISSUE#")
    issues = [_serialize_issue(it) for it in raw if it.get("status") in ("open", "in_progress")]
    if qs.get("severity"):
        issues = [i for i in issues if i["severity"] == qs["severity"]]
    if qs.get("room_number"):
        issues = [i for i in issues if i["room_number"] == qs["room_number"]]
    if qs.get("category"):
        issues = [i for i in issues if i["category"] == qs["category"]]
    severity_order = {"urgent": 0, "standard": 1, "minor": 2, "note": 3}
    issues.sort(key=lambda i: (severity_order.get(i["severity"], 9), i.get("created_at") or ""))
    counts = defaultdict(int)
    for i in issues:
        counts[i["severity"]] += 1
    return ok({
        "total": len(issues),
        "urgent": counts["urgent"],
        "standard": counts["standard"],
        "minor": counts["minor"],
        "note": counts["note"],
        "issues": issues,
    })


# ======================================================================
# Inspection log + room status + analytics
# ======================================================================

@router.get("/api/inspections/{property_id}/log")
def inspection_log(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    try:
        limit = max(1, min(50, int(qs.get("limit") or 20)))
    except ValueError:
        limit = 20
    try:
        offset = max(0, int(qs.get("offset") or 0))
    except ValueError:
        offset = 0
    raw = [it for it in query_pk(TBL(), f"PROPERTY#{pid}", "INSPECTION#") if it.get("status") == "submitted"]
    if qs.get("room_number"):
        raw = [r for r in raw if r.get("room_number") == qs["room_number"]]
    if qs.get("inspector_id"):
        raw = [r for r in raw if r.get("inspector_id") == qs["inspector_id"]]
    if qs.get("date_from"):
        raw = [r for r in raw if (r.get("submitted_at") or "") >= qs["date_from"]]
    if qs.get("date_to"):
        raw = [r for r in raw if (r.get("submitted_at") or "") <= qs["date_to"]]
    raw.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)
    total = len(raw)
    page = raw[offset:offset + limit]
    issues_raw = query_pk(TBL(), f"PROPERTY#{pid}", "ISSUE#")
    by_inspection = defaultdict(list)
    for i in issues_raw:
        by_inspection[i.get("inspection_id")].append(i)
    inspections = []
    for it in page:
        issues = by_inspection.get(it.get("inspection_id"), [])
        open_count = sum(1 for i in issues if i.get("status") in ("open", "in_progress"))
        inspections.append({
            **_serialize_inspection(it),
            "issues_count": len(issues),
            "open_issues_count": open_count,
        })
    return ok({"total": total, "inspections": inspections})


@router.get("/api/inspections/{property_id}/{inspection_id}")
def get_inspection(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    it = _find_inspection(pid, params["inspection_id"])
    if not it:
        return not_found("inspection not found")
    out = _serialize_inspection(it)
    issues_raw = [
        i for i in query_pk(TBL(), f"PROPERTY#{pid}", "ISSUE#")
        if i.get("inspection_id") == params["inspection_id"]
    ]
    out["issues"] = sorted(
        [_serialize_issue(i) for i in issues_raw], key=lambda i: i.get("created_at", "")
    )
    return ok({"inspection": out})


@router.get("/api/inspections/{property_id}/room-status")
def room_status(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    rooms = {r["room_number"]: {
        **r,
        "last_inspection_date": None,
        "last_inspection_type": None,
        "overall_condition": None,
        "open_issues": 0,
        "urgent_issues": 0,
        "status": "never_inspected",
    } for r in _all_rooms()}
    inspections = [it for it in query_pk(TBL(), f"PROPERTY#{pid}", "INSPECTION#") if it.get("status") == "submitted"]
    inspections.sort(key=lambda i: i.get("submitted_at") or "", reverse=True)
    seen = set()
    for it in inspections:
        rn = it.get("room_number")
        if rn in rooms and rn not in seen:
            seen.add(rn)
            sub = it.get("submitted_at") or ""
            rooms[rn]["last_inspection_date"] = sub.split("T")[0] if sub else None
            rooms[rn]["last_inspection_type"] = it.get("inspection_type")
            rooms[rn]["overall_condition"] = it.get("overall_condition")
    open_issues = [i for i in query_pk(TBL(), f"PROPERTY#{pid}", "ISSUE#") if i.get("status") in ("open", "in_progress")]
    sev_by_room = defaultdict(list)
    for i in open_issues:
        rn = i.get("room_number")
        if rn in rooms:
            rooms[rn]["open_issues"] += 1
            sev_by_room[rn].append(i.get("severity"))
            if i.get("severity") == "urgent":
                rooms[rn]["urgent_issues"] += 1
    for rn, room in rooms.items():
        if room["last_inspection_date"] is None:
            room["status"] = "never_inspected"
        elif room["urgent_issues"] > 0:
            room["status"] = "urgent"
        elif room["open_issues"] == 0:
            room["status"] = "clear"
        else:
            sevs = sev_by_room.get(rn, [])
            if any(s == "standard" for s in sevs):
                room["status"] = "standard_issues"
            elif any(s in ("minor", "note") for s in sevs):
                room["status"] = "minor_issues"
            else:
                room["status"] = "clear"
    return ok({"rooms": rooms})


@router.get("/api/inspections/{property_id}/analytics")
def analytics(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    try:
        days = max(1, min(90, int(qs.get("days") or 30)))
    except ValueError:
        days = 30
    cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
    all_inspections = query_pk(TBL(), f"PROPERTY#{pid}", "INSPECTION#")
    recent_inspections = [it for it in all_inspections if (it.get("started_at") or "") >= cutoff]
    submitted = [it for it in recent_inspections if it.get("status") == "submitted"]
    all_issues = query_pk(TBL(), f"PROPERTY#{pid}", "ISSUE#")
    recent_issues = [i for i in all_issues if (i.get("created_at") or "") >= cutoff]
    open_count = sum(1 for i in recent_issues if i.get("status") in ("open", "in_progress"))
    urgent_open = sum(1 for i in recent_issues if i.get("status") in ("open", "in_progress") and i.get("severity") == "urgent")
    durations = [float(it["duration_minutes"]) for it in submitted if it.get("duration_minutes") not in (None, "")]
    avg_duration = round(sum(durations) / len(durations), 2) if durations else None
    resolution_by_sev = defaultdict(list)
    for i in recent_issues:
        if not i.get("resolved_at"):
            continue
        c = _parse_dt(i.get("created_at"))
        r = _parse_dt(i.get("resolved_at"))
        if c and r:
            resolution_by_sev[i.get("severity", "standard")].append((r - c).total_seconds() / 3600)
    avg_resolution = {
        sev: round(sum(v) / len(v), 2) if v else None
        for sev, v in resolution_by_sev.items()
    }
    cat_counts = defaultdict(int)
    for i in recent_issues:
        cat_counts[i.get("category", "maintenance")] += 1
    total_issues = len(recent_issues)
    issues_by_category = sorted(
        [
            {
                "category": cat,
                "label": CATEGORY_LABELS.get(cat, cat.title()),
                "emoji": CATEGORY_EMOJIS.get(cat, "🔧"),
                "count": cnt,
                "percentage": round(cnt / total_issues * 100, 1) if total_issues else 0,
            }
            for cat, cnt in cat_counts.items()
        ],
        key=lambda x: x["count"], reverse=True,
    )
    sev_data = defaultdict(lambda: {"count": 0, "resolved": 0, "sla_met": 0})
    for i in recent_issues:
        sev = i.get("severity", "standard")
        sev_data[sev]["count"] += 1
        if i.get("resolved_at"):
            sev_data[sev]["resolved"] += 1
            if _compute_sla_status(sev, i.get("created_at"), i.get("resolved_at")) == "within_sla":
                sev_data[sev]["sla_met"] += 1
    issues_by_severity = [
        {"severity": sev, **data} for sev, data in sev_data.items()
    ]
    room_issues = defaultdict(lambda: {"total_issues": 0, "open_issues": 0, "inspection_count": 0})
    for i in recent_issues:
        rn = i.get("room_number")
        if rn:
            room_issues[rn]["total_issues"] += 1
            if i.get("status") in ("open", "in_progress"):
                room_issues[rn]["open_issues"] += 1
    for it in submitted:
        rn = it.get("room_number")
        if rn:
            room_issues[rn]["inspection_count"] += 1
    most_problematic = sorted(
        [
            {
                "room_number": rn,
                "floor": int(rn[0]) if rn else 0,
                "total_issues": d["total_issues"],
                "open_issues": d["open_issues"],
                "inspection_count": d["inspection_count"],
                "avg_issues_per_inspection": round(d["total_issues"] / d["inspection_count"], 2) if d["inspection_count"] else 0,
            }
            for rn, d in room_issues.items()
        ],
        key=lambda x: x["total_issues"], reverse=True,
    )[:10]
    insp_data = defaultdict(lambda: {"name": "", "total_inspections": 0, "durations": []})
    insp_by_inspector = defaultdict(list)
    for it in submitted:
        iid = it.get("inspector_id")
        if iid:
            insp_data[iid]["name"] = it.get("inspector_name") or ""
            insp_data[iid]["total_inspections"] += 1
            if it.get("duration_minutes") not in (None, ""):
                insp_data[iid]["durations"].append(float(it["duration_minutes"]))
            insp_by_inspector[iid].append(it.get("inspection_id"))
    issues_by_inspector = defaultdict(int)
    inspection_to_inspector = {it.get("inspection_id"): it.get("inspector_id") for it in submitted if it.get("inspector_id")}
    for i in recent_issues:
        iid = inspection_to_inspector.get(i.get("inspection_id"))
        if iid:
            issues_by_inspector[iid] += 1
    inspector_stats = sorted(
        [
            {
                "inspector_id": iid,
                "inspector_name": d["name"],
                "total_inspections": d["total_inspections"],
                "avg_duration_minutes": round(sum(d["durations"]) / len(d["durations"]), 2) if d["durations"] else None,
                "total_issues_found": issues_by_inspector.get(iid, 0),
                "avg_issues_per_inspection": round(issues_by_inspector.get(iid, 0) / d["total_inspections"], 2) if d["total_inspections"] else 0,
            }
            for iid, d in insp_data.items()
        ],
        key=lambda x: x["total_inspections"], reverse=True,
    )
    sla_compliance = {}
    for sev in ("urgent", "standard", "minor"):
        sev_issues = [i for i in recent_issues if i.get("severity") == sev]
        within = sum(
            1 for i in sev_issues
            if i.get("resolved_at") and _compute_sla_status(sev, i.get("created_at"), i.get("resolved_at")) == "within_sla"
        )
        total_sev = len(sev_issues)
        sla_compliance[sev] = {
            "total": total_sev,
            "within_sla": within,
            "compliance_rate": round(within / total_sev * 100, 1) if total_sev else 0,
        }
    # Monthly trend — last 6 months
    six_cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=180)).isoformat()
    insp_6m = [it for it in all_inspections if (it.get("started_at") or "") >= six_cutoff and it.get("status") == "submitted"]
    issues_6m = [i for i in all_issues if (i.get("created_at") or "") >= six_cutoff]
    months = defaultdict(lambda: {"inspections": 0, "issues": 0})
    for it in insp_6m:
        ts = it.get("started_at") or ""
        if len(ts) >= 7:
            months[ts[:7]]["inspections"] += 1
    for i in issues_6m:
        ts = i.get("created_at") or ""
        if len(ts) >= 7:
            months[ts[:7]]["issues"] += 1
    monthly_trend = sorted(
        [{"month": m, **d} for m, d in months.items()],
        key=lambda x: x["month"],
    )
    return ok({
        "period_days": days,
        "total_inspections": len(submitted),
        "total_issues": total_issues,
        "open_issues": open_count,
        "urgent_open": urgent_open,
        "avg_inspection_duration_minutes": avg_duration,
        "avg_resolution_hours_by_severity": avg_resolution,
        "issues_by_category": issues_by_category,
        "issues_by_severity": issues_by_severity,
        "most_problematic_rooms": most_problematic,
        "inspector_stats": inspector_stats,
        "sla_compliance": sla_compliance,
        "monthly_trend": monthly_trend,
    })


# ======================================================================
# Photo presign — separate authed / public endpoints
# ======================================================================

def _build_presigned_put(pid, body):
    inspection_id = (body.get("inspection_id") or "").strip()
    if not inspection_id:
        return None, bad_request("inspection_id required")
    if not _find_inspection(pid, inspection_id):
        return None, not_found("inspection not found")
    photo_type = body.get("photo_type") or "before"
    if photo_type not in ("before", "after"):
        return None, bad_request("photo_type must be 'before' or 'after'")
    ext = (body.get("file_extension") or "jpg").lstrip(".").lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        return None, bad_request("file_extension must be jpg/png/webp/heic")
    issue_id = body.get("issue_id") or "pending"
    timestamp = int(time.time())
    key = f"{pid}/{inspection_id}/{issue_id}/{photo_type}_{timestamp}.{ext}"
    content_type_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "webp": "image/webp", "heic": "image/heic",
    }
    upload_url = _s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": content_type_map[ext]},
        ExpiresIn=PRESIGN_TTL,
    )
    return {
        "upload_url": upload_url,
        "key": key,
        "view_url": _photo_view_url(key),
        "content_type": content_type_map[ext],
    }, None


@router.post("/api/inspections/{property_id}/photos/upload-url")
def photo_upload_url(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    result, err_resp = _build_presigned_put(pid, body)
    if err_resp:
        return err_resp
    return ok(result)


@router.post("/api/public/inspections/{property_id}/photos/upload-url")
def public_photo_upload_url(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    result, err_resp = _build_presigned_put(pid, body)
    if err_resp:
        return err_resp
    return ok(result)


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
