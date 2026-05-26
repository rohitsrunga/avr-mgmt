"""Group contracts — group bookings management (Casco Bay).

PK = PROPERTY#<property_id>
SK = CONTRACT#<contract_id>             (contract record)
SK = CONTRACT#<contract_id>#LOG#<ts>    (activity-log note)

Public route (no auth) lets prospective groups submit an inquiry which lands as
a draft contract in the dashboard. Authenticated routes drive the full CRUD +
status flow for managers.
"""
import uuid
from datetime import date as date_cls, datetime, timedelta, timezone

from shared.auth import (
    ALL_ROLES,
    MANAGEMENT_ROLES,
    authorize_property,
    get_identity,
)
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, forbidden, not_found, ok, server_error
from shared.router import Router, parse_body, query_params
from shared.settings import VALID_PROPERTIES, is_feature_enabled

router = Router()
TBL = lambda: table("TABLE_GROUP_CONTRACTS")

FEATURE_ID = "groups"
ACTIVE_STATUSES = {"inquiry", "confirmed", "checked_in"}
VALID_STATUSES = {"inquiry", "confirmed", "checked_in", "completed", "cancelled"}
VALID_ROOM_TYPES = {"standard", "triple", "quad", "mixed"}
DASHBOARD_ROLES = ["owner", "manager", "frontdesk"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _check_property(pid):
    if pid not in VALID_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    if not is_feature_enabled(pid, FEATURE_ID):
        return forbidden("Group contracts are disabled for this property")
    return None


def _serialize_contract(it):
    return {
        "contract_id": it.get("contract_id", ""),
        "group_name": it.get("group_name", ""),
        "contact_name": it.get("contact_name", ""),
        "contact_phone": it.get("contact_phone", ""),
        "contact_email": it.get("contact_email", ""),
        "company_address": it.get("company_address", ""),
        "check_in_date": it.get("check_in_date", ""),
        "check_out_date": it.get("check_out_date", ""),
        "room_count": int(it.get("room_count", 0) or 0),
        "room_type": it.get("room_type", "standard"),
        "room_rate": float(it["room_rate"]) if it.get("room_rate") not in (None, "") else None,
        "triple_rate": float(it["triple_rate"]) if it.get("triple_rate") not in (None, "") else None,
        "quad_rate": float(it["quad_rate"]) if it.get("quad_rate") not in (None, "") else None,
        "deposit_by_date": it.get("deposit_by_date", "") or None,
        "cutoff_date": it.get("cutoff_date", "") or None,
        "signed_by_date": it.get("signed_by_date", "") or None,
        "status": it.get("status", "inquiry"),
        "deposit_paid": bool(it.get("deposit_paid", False)),
        "special_notes": it.get("special_notes", ""),
        "internal_notes": it.get("internal_notes", ""),
        "source": it.get("source", "manual"),
        "created_at": it.get("created_at", ""),
        "updated_at": it.get("updated_at", ""),
    }


def _serialize_log(it):
    return {
        "log_id": it.get("log_id", ""),
        "contract_id": it.get("contract_id", ""),
        "note": it.get("note", ""),
        "author": it.get("author", ""),
        "created_at": it.get("created_at", ""),
    }


def _enrich(row):
    today = date_cls.fromisoformat(_today_str())
    try:
        check_in = date_cls.fromisoformat(row["check_in_date"])
        row["days_until_checkin"] = (check_in - today).days
    except Exception:
        row["days_until_checkin"] = None

    cutoff = row.get("cutoff_date")
    if cutoff and row.get("status") in ("inquiry", "confirmed"):
        try:
            days_until = (date_cls.fromisoformat(cutoff) - today).days
            row["cutoff_alert"] = 0 <= days_until <= 3
        except ValueError:
            row["cutoff_alert"] = False
    else:
        row["cutoff_alert"] = False
    return row


def _validate_create(body, source):
    required = ["group_name", "contact_name", "contact_phone", "check_in_date", "check_out_date", "room_count"]
    for field in required:
        if not body.get(field):
            return None, f"{field} required"
    try:
        check_in = date_cls.fromisoformat(body["check_in_date"])
        check_out = date_cls.fromisoformat(body["check_out_date"])
    except ValueError:
        return None, "check_in_date / check_out_date must be YYYY-MM-DD"
    if check_out < check_in:
        return None, "check_out_date must be on or after check_in_date"
    try:
        room_count = int(body["room_count"])
    except (TypeError, ValueError):
        return None, "room_count must be a number"
    if room_count < 1:
        return None, "room_count must be >= 1"
    room_type = body.get("room_type") or "standard"
    if room_type not in VALID_ROOM_TYPES:
        return None, f"room_type must be one of {sorted(VALID_ROOM_TYPES)}"

    def _num(field):
        v = body.get(field)
        if v in (None, "", "null"):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    cleaned = {
        "group_name": str(body["group_name"]).strip()[:200],
        "contact_name": str(body["contact_name"]).strip()[:120],
        "contact_phone": str(body["contact_phone"]).strip()[:40],
        "contact_email": str(body.get("contact_email") or "").strip()[:120],
        "company_address": str(body.get("company_address") or "").strip()[:300],
        "check_in_date": check_in.isoformat(),
        "check_out_date": check_out.isoformat(),
        "room_count": room_count,
        "room_type": room_type,
        "room_rate": _num("room_rate"),
        "triple_rate": _num("triple_rate"),
        "quad_rate": _num("quad_rate"),
        "deposit_by_date": body.get("deposit_by_date") or "",
        "cutoff_date": body.get("cutoff_date") or "",
        "special_notes": str(body.get("special_notes") or "").strip()[:1000],
        "source": source,
    }
    return cleaned, None


def _get_contract(pid, contract_id):
    return TBL().get_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"CONTRACT#{contract_id}"}
    ).get("Item")


# ======================================================================
# Public routes — group inquiry form (no auth)
# ======================================================================

@router.post("/api/public/groups/{property_id}/inquiry")
def public_inquiry(event, params):
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    cleaned, err = _validate_create(body, source="public_form")
    if err:
        return bad_request(err)
    contract_id = uuid.uuid4().hex[:12]
    now = _now()
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"CONTRACT#{contract_id}",
        "contract_id": contract_id,
        "status": "inquiry",
        "deposit_paid": False,
        "created_at": now,
        "updated_at": now,
        **{k: v for k, v in cleaned.items() if v is not None},
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"contract_id": contract_id, "submitted_at": now})


# ======================================================================
# Authenticated routes — manager dashboard
# ======================================================================

@router.get("/api/groups/{property_id}/stats")
def get_stats(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    raw = [it for it in query_pk(TBL(), f"PROPERTY#{pid}", "CONTRACT#") if "#LOG#" not in it.get("SK", "")]
    today = date_cls.fromisoformat(_today_str())
    next_week = today + timedelta(days=7)
    total_active = 0
    total_completed = 0
    total_cancelled = 0
    upcoming_this_week = 0
    cutoff_alerts = 0
    by_status = {}
    month_counts = {}
    for r in raw:
        status = r.get("status", "")
        by_status[status] = by_status.get(status, 0) + 1
        if status in ACTIVE_STATUSES:
            total_active += 1
        elif status == "completed":
            total_completed += 1
        elif status == "cancelled":
            total_cancelled += 1
        try:
            check_in = date_cls.fromisoformat(r.get("check_in_date", ""))
            if status in ACTIVE_STATUSES and today <= check_in <= next_week:
                upcoming_this_week += 1
        except Exception:
            pass
        cutoff = r.get("cutoff_date")
        if cutoff and status in ("inquiry", "confirmed"):
            try:
                days_until = (date_cls.fromisoformat(cutoff) - today).days
                if 0 <= days_until <= 3:
                    cutoff_alerts += 1
            except ValueError:
                pass
        created_at = r.get("created_at", "")
        if len(created_at) >= 7:
            m = created_at[:7]
            month_counts[m] = month_counts.get(m, 0) + 1

    six_months_ago = (today.replace(day=1) - timedelta(days=180)).strftime("%Y-%m")
    by_month = [
        {"month": m, "count": c}
        for m, c in sorted(month_counts.items())
        if m >= six_months_ago
    ]
    return ok({
        "total_active": total_active,
        "total_completed": total_completed,
        "total_cancelled": total_cancelled,
        "upcoming_this_week": upcoming_this_week,
        "cutoff_alerts": cutoff_alerts,
        "by_status": by_status,
        "by_month": by_month,
    })


@router.get("/api/groups/{property_id}")
def list_contracts(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    status_filter = qs.get("status")
    upcoming_only = (qs.get("upcoming_only") or "").lower() in ("1", "true", "yes")
    raw = [it for it in query_pk(TBL(), f"PROPERTY#{pid}", "CONTRACT#") if "#LOG#" not in it.get("SK", "")]
    out = [_enrich(_serialize_contract(it)) for it in raw]
    if status_filter:
        out = [c for c in out if c["status"] == status_filter]
    if upcoming_only:
        today = _today_str()
        out = [c for c in out if c["check_in_date"] >= today]
    out.sort(key=lambda c: c["check_in_date"])
    return ok({"contracts": out})


@router.get("/api/groups/{property_id}/{contract_id}")
def get_contract(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    item = _get_contract(pid, params["contract_id"])
    if not item:
        return not_found("contract not found")
    contract = _enrich(_serialize_contract(item))
    logs_raw = query_pk(TBL(), f"PROPERTY#{pid}", f"CONTRACT#{params['contract_id']}#LOG#")
    contract["activity_log"] = sorted(
        [_serialize_log(l) for l in logs_raw], key=lambda l: l["created_at"]
    )
    return ok({"contract": contract})


@router.post("/api/groups/{property_id}")
def create_contract(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    body = parse_body(event)
    cleaned, err = _validate_create(body, source=body.get("source") or "manual")
    if err:
        return bad_request(err)
    contract_id = uuid.uuid4().hex[:12]
    now = _now()
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"CONTRACT#{contract_id}",
        "contract_id": contract_id,
        "status": "inquiry",
        "deposit_paid": False,
        "created_at": now,
        "updated_at": now,
        **{k: v for k, v in cleaned.items() if v is not None},
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"contract": _enrich(_serialize_contract(item))})


@router.put("/api/groups/{property_id}/{contract_id}")
def update_contract(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    existing = _get_contract(pid, params["contract_id"])
    if not existing:
        return not_found("contract not found")
    body = parse_body(event)
    update_fields = {}
    if "status" in body:
        if body["status"] not in VALID_STATUSES:
            return bad_request(f"status must be one of {sorted(VALID_STATUSES)}")
        update_fields["status"] = body["status"]
    if "deposit_paid" in body:
        update_fields["deposit_paid"] = bool(body["deposit_paid"])
    if "room_type" in body and body["room_type"]:
        if body["room_type"] not in VALID_ROOM_TYPES:
            return bad_request(f"room_type must be one of {sorted(VALID_ROOM_TYPES)}")
        update_fields["room_type"] = body["room_type"]
    if "room_count" in body and body["room_count"] is not None:
        try:
            update_fields["room_count"] = int(body["room_count"])
        except (TypeError, ValueError):
            return bad_request("room_count must be a number")
    for k in ("room_rate", "triple_rate", "quad_rate"):
        if k in body:
            v = body[k]
            if v in (None, "", "null"):
                update_fields[k] = ""
            else:
                try:
                    update_fields[k] = float(v)
                except (TypeError, ValueError):
                    return bad_request(f"{k} must be a number")
    for k in ("deposit_by_date", "cutoff_date", "signed_by_date", "internal_notes", "special_notes", "contact_email", "contact_phone", "contact_name", "group_name", "company_address"):
        if k in body:
            update_fields[k] = body[k] or ""
    if not update_fields:
        return bad_request("nothing to update")
    update_fields["updated_at"] = _now()
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_fields)
    names = {f"#{k}": k for k in update_fields}
    values = to_dynamo({f":{k}": v for k, v in update_fields.items()})
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"CONTRACT#{params['contract_id']}"},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    updated = _get_contract(pid, params["contract_id"]) or {}
    return ok({"contract": _enrich(_serialize_contract(updated))})


@router.delete("/api/groups/{property_id}/{contract_id}")
def delete_contract(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    contract_id = params["contract_id"]
    tbl = TBL()
    related = query_pk(tbl, f"PROPERTY#{pid}", f"CONTRACT#{contract_id}")
    with tbl.batch_writer() as batch:
        for r in related:
            batch.delete_item(Key={"PK": r["PK"], "SK": r["SK"]})
    return ok({"deleted": True})


@router.post("/api/groups/{property_id}/{contract_id}/notes")
def add_note(event, params):
    pid = params["property_id"]
    err = _check_property(pid) or authorize_property(event, pid, DASHBOARD_ROLES)
    if err:
        return err
    if not _get_contract(pid, params["contract_id"]):
        return not_found("contract not found")
    body = parse_body(event)
    note = (body.get("note") or "").strip()
    if len(note) < 5:
        return bad_request("note must be at least 5 characters")
    identity = get_identity(event)
    now = _now()
    log_id = uuid.uuid4().hex[:10]
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"CONTRACT#{params['contract_id']}#LOG#{now}#{log_id}",
        "log_id": log_id,
        "contract_id": params["contract_id"],
        "note": note,
        "author": identity["name"] or identity["email"],
        "created_at": now,
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"log": _serialize_log(item)})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
