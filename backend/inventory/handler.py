"""Inventory: stock counts, par levels, low-stock alerts.

PK = PROPERTY#<property_id>
SK = CATEGORY#<category>#ITEM#<item_id>          (item record)
SK = LOG#<YYYY-MM-DDTHH:MM:SSZ>#<log_id>          (change log entry)

Public routes (no auth) expose a phone-friendly stock-check form: staff walks
the property, enters current quantities, and submits a bulk update.
"""
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote_plus


def _samsclub_search_url(name):
    """Receipt SKUs aren't the website's product IDs, so link by product name."""
    return f"https://www.samsclub.com/search?q={quote_plus(name)}" if name else ""

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
TBL = lambda: table("TABLE_INVENTORY")
DEFAULT_THRESHOLD_PCT = Decimal("30")

ALLOWED_PROPERTIES = {"casco_bay", "saco_bay"}
DEFAULT_VENDORS = ["sysco", "costco", "webstaurantstore", "members_mark", "other"]
LOG_LIMIT = 100


def _now():
    return datetime.now(timezone.utc).isoformat()


def _check_property(pid):
    if pid not in ALLOWED_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    return None


def _compute_status(current, par_level):
    """Three-bucket status used by the alerts UI."""
    try:
        c = float(current)
        p = float(par_level)
    except (TypeError, ValueError):
        return "ok"
    if p <= 0:
        return "ok"
    if c <= p:
        return "critical"
    if c <= p * 1.2:
        return "low"
    return "ok"


def _suggested_order(par_level, current_stock):
    p = float(par_level or 0)
    c = float(current_stock or 0)
    return max(0, round(p - c))


def _serialize(item):
    par = int(item.get("par_level", 0) or 0)
    stock = int(item.get("current_stock", 0) or 0)
    return {
        "item_id": item.get("item_id", ""),
        "item_name": item.get("item_name", ""),
        "category": item.get("category", ""),
        "sku": item.get("sku", ""),
        "url": item.get("url", ""),
        "vendor": item.get("vendor", ""),
        "current_stock": stock,
        "par_level": par,
        "min_quantity": par,  # alias used by stock-check / alerts UI
        "current_quantity": stock,  # alias
        "unit": item.get("unit", "each"),
        "reorder_threshold_pct": int(item.get("reorder_threshold_pct", 30)),
        "notes": item.get("notes", ""),
        "is_active": bool(item.get("is_active", True)),
        "last_updated": item.get("last_updated", ""),
        "last_checked_at": item.get("last_updated", ""),  # alias
        "updated_by": item.get("updated_by", ""),
        "last_checked_by": item.get("updated_by", ""),  # alias
        "status": _compute_status(stock, par),
        "suggested_order": _suggested_order(par, stock),
    }


def _serialize_log(it):
    return {
        "log_id": it.get("log_id", ""),
        "item_id": it.get("item_id", ""),
        "item_name": it.get("item_name", ""),
        "category": it.get("category", ""),
        "previous_qty": int(it.get("previous_qty", 0) or 0),
        "new_qty": int(it.get("new_qty", 0) or 0),
        "change_type": it.get("change_type", "stock_check"),
        "updated_by": it.get("updated_by", ""),
        "notes": it.get("notes", ""),
        "created_at": it.get("created_at", ""),
    }


def _write_log(pid, item_record, *, previous_qty, new_qty, change_type, updated_by, notes=None):
    now = _now()
    log_id = uuid.uuid4().hex[:10]
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"LOG#{now}#{log_id}",
        "log_id": log_id,
        "item_id": item_record.get("item_id", ""),
        "item_name": item_record.get("item_name", ""),
        "category": item_record.get("category", ""),
        "previous_qty": int(previous_qty or 0),
        "new_qty": int(new_qty or 0),
        "change_type": change_type,
        "updated_by": updated_by or "",
        "notes": notes or "",
        "created_at": now,
    }
    TBL().put_item(Item=to_dynamo(item))


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
    key = {"PK": f"PROPERTY#{pid}", "SK": f"CATEGORY#{category}#ITEM#{item_id}"}
    existing = TBL().get_item(Key=key).get("Item")
    if not existing:
        return not_found("item not found")

    # Build a SET update for whichever fields were sent.
    update_fields = {}
    for field in ["current_stock", "par_level", "reorder_threshold_pct"]:
        if field in body:
            try:
                update_fields[field] = int(body[field])
            except (TypeError, ValueError):
                return bad_request(f"{field} must be an integer")
    for field in ["item_name", "unit", "vendor", "notes", "sku", "url"]:
        if field in body:
            update_fields[field] = body[field] or ""
    # If the name changed without an explicit url, refresh the search link from it.
    if "item_name" in update_fields and "url" not in body:
        update_fields["url"] = _samsclub_search_url(update_fields["item_name"])
    if "is_active" in body:
        update_fields["is_active"] = bool(body["is_active"])
    update_fields["last_updated"] = _now()
    update_fields["updated_by"] = identity["name"] or identity["email"]

    # Log stock-quantity changes so the History panel works.
    if "current_stock" in update_fields:
        prev_qty = int(existing.get("current_stock", 0) or 0)
        new_qty = update_fields["current_stock"]
        if prev_qty != new_qty:
            _write_log(
                pid, existing,
                previous_qty=prev_qty, new_qty=new_qty,
                change_type=body.get("change_type") or "edit",
                updated_by=update_fields["updated_by"],
                notes=body.get("change_notes"),
            )

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
    sku = (body.get("sku") or "").strip()
    url = body.get("url") or _samsclub_search_url(item_name)
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"CATEGORY#{category}#ITEM#{item_id}",
        "item_id": item_id,
        "item_name": item_name,
        "category": category,
        "sku": sku,
        "url": url,
        "vendor": body.get("vendor", ""),
        "current_stock": int(body.get("current_stock", 0)),
        "par_level": int(body.get("par_level", 0)),
        "unit": body.get("unit", "each"),
        "reorder_threshold_pct": int(body.get("reorder_threshold_pct", 30)),
        "notes": body.get("notes", ""),
        "is_active": True,
        "last_updated": _now(),
        "updated_by": identity["name"] or identity["email"],
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"item_id": item_id, "item": _serialize(item)})


@router.post("/api/inventory/{property_id}/items/bulk-update")
def bulk_update_items(event, params):
    """Apply a list of {item_id, category, current_stock} updates atomically-ish.
    Skips items that no longer exist; logs each change."""
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    updates = body.get("updates") or []
    if not isinstance(updates, list) or not updates:
        return bad_request("updates must be a non-empty list")
    identity = get_identity(event)
    updated_by = body.get("updated_by") or identity["name"] or identity["email"] or "stock-check"
    change_type = body.get("change_type") or "stock_check"
    updated = 0
    for entry in updates:
        item_id = (entry.get("item_id") or "").strip()
        category = (entry.get("category") or "").strip()
        if not item_id or not category:
            continue
        try:
            new_qty = max(0, int(entry.get("current_quantity") if entry.get("current_quantity") is not None else entry.get("current_stock", 0)))
        except (TypeError, ValueError):
            continue
        key = {"PK": f"PROPERTY#{pid}", "SK": f"CATEGORY#{category}#ITEM#{item_id}"}
        existing = TBL().get_item(Key=key).get("Item")
        if not existing:
            continue
        prev_qty = int(existing.get("current_stock", 0) or 0)
        _write_log(
            pid, existing,
            previous_qty=prev_qty, new_qty=new_qty,
            change_type=change_type, updated_by=updated_by, notes=entry.get("notes"),
        )
        TBL().update_item(
            Key=key,
            UpdateExpression="SET #s = :s, #lu = :lu, #ub = :ub",
            ExpressionAttributeNames={"#s": "current_stock", "#lu": "last_updated", "#ub": "updated_by"},
            ExpressionAttributeValues=to_dynamo({":s": new_qty, ":lu": _now(), ":ub": updated_by}),
        )
        updated += 1
    return ok({"updated_count": updated, "message": f"{updated} items updated"})


@router.post("/api/inventory/{property_id}/items/mark-ordered")
def mark_ordered(event, params):
    """Reset listed items to par_level and log the order."""
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    ids = body.get("items") or body.get("item_ids") or []
    if not isinstance(ids, list) or not ids:
        return bad_request("items must be a non-empty list of {item_id, category}")
    identity = get_identity(event)
    updated_by = body.get("updated_by") or identity["name"] or identity["email"] or "—"
    marked = 0
    for ref in ids:
        item_id = ref.get("item_id") if isinstance(ref, dict) else None
        category = ref.get("category") if isinstance(ref, dict) else None
        if not item_id or not category:
            continue
        key = {"PK": f"PROPERTY#{pid}", "SK": f"CATEGORY#{category}#ITEM#{item_id}"}
        existing = TBL().get_item(Key=key).get("Item")
        if not existing:
            continue
        prev_qty = int(existing.get("current_stock", 0) or 0)
        par = int(existing.get("par_level", 0) or 0)
        _write_log(pid, existing, previous_qty=prev_qty, new_qty=par,
                   change_type="order_placed", updated_by=updated_by)
        TBL().update_item(
            Key=key,
            UpdateExpression="SET #s = :s, #lu = :lu, #ub = :ub",
            ExpressionAttributeNames={"#s": "current_stock", "#lu": "last_updated", "#ub": "updated_by"},
            ExpressionAttributeValues=to_dynamo({":s": par, ":lu": _now(), ":ub": updated_by}),
        )
        marked += 1
    return ok({"marked_count": marked, "message": f"{marked} items marked as ordered"})


@router.get("/api/inventory/{property_id}/history")
def history(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    raw = query_pk(TBL(), f"PROPERTY#{pid}", "LOG#")
    raw.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return ok({"logs": [_serialize_log(r) for r in raw[:LOG_LIMIT]]})


@router.get("/api/inventory/{property_id}/vendors")
def list_vendors(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    items = query_pk(TBL(), f"PROPERTY#{pid}", "CATEGORY#")
    vendors = sorted({i.get("vendor") for i in items if i.get("vendor")})
    return ok({"vendors": vendors or DEFAULT_VENDORS, "defaults": DEFAULT_VENDORS})


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


# ======================================================================
# Public routes — consumed by the static S3 stock-check form
# ======================================================================

@router.get("/api/public/inventory/{property_id}/items")
def public_list_items(event, params):
    """Active items for the phone stock-check form. No PII."""
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    items = query_pk(TBL(), f"PROPERTY#{pid}", "CATEGORY#")
    out = [_serialize(it) for it in items if it.get("is_active", True)]
    # strip noisy fields not needed by the form
    public_fields = (
        "item_id", "item_name", "category", "vendor", "unit", "sku", "url",
        "current_stock", "par_level", "status", "suggested_order",
    )
    out = [{k: v for k, v in i.items() if k in public_fields} for i in out]
    out.sort(key=lambda i: (i["category"], i["item_name"].lower()))
    return ok({"items": out})


@router.post("/api/public/inventory/{property_id}/bulk-update")
def public_bulk_update(event, params):
    """Mirror of the authed bulk_update, but requires updated_by name in the body."""
    pid = params["property_id"]
    err = _check_property(pid)
    if err:
        return err
    body = parse_body(event)
    updated_by = (body.get("updated_by") or "").strip()
    if not updated_by:
        return bad_request("Please enter your name (updated_by required)")
    if len(updated_by) > 80:
        return bad_request("updated_by too long")
    updates = body.get("updates") or []
    if not isinstance(updates, list) or not updates:
        return bad_request("updates must be a non-empty list")
    if len(updates) > 500:
        return bad_request("too many updates in one batch")
    change_type = body.get("change_type") or "stock_check"
    updated = 0
    for entry in updates:
        item_id = (entry.get("item_id") or "").strip()
        category = (entry.get("category") or "").strip()
        if not item_id or not category:
            continue
        try:
            new_qty = max(0, int(entry.get("current_quantity") if entry.get("current_quantity") is not None else entry.get("current_stock", 0)))
        except (TypeError, ValueError):
            continue
        key = {"PK": f"PROPERTY#{pid}", "SK": f"CATEGORY#{category}#ITEM#{item_id}"}
        existing = TBL().get_item(Key=key).get("Item")
        if not existing:
            continue
        prev_qty = int(existing.get("current_stock", 0) or 0)
        _write_log(
            pid, existing,
            previous_qty=prev_qty, new_qty=new_qty,
            change_type=change_type, updated_by=updated_by,
            notes=str(entry.get("notes") or "")[:200],
        )
        TBL().update_item(
            Key=key,
            UpdateExpression="SET #s = :s, #lu = :lu, #ub = :ub",
            ExpressionAttributeNames={"#s": "current_stock", "#lu": "last_updated", "#ub": "updated_by"},
            ExpressionAttributeValues=to_dynamo({":s": new_qty, ":lu": _now(), ":ub": updated_by}),
        )
        updated += 1
    return ok({"updated_count": updated})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
