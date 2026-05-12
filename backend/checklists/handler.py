"""Checklists: breakfast, groundsman, custom.

Templates:
  PK = PROPERTY#<property_id>
  SK = TEMPLATE#<list_type>#ITEM#<index>

Daily instances:
  PK = PROPERTY#<property_id>#DATE#<YYYY-MM-DD>
  SK = LIST#<list_type>#ITEM#<index>
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
from shared.router import Router, parse_body, query_params

router = Router()
TBL = lambda: table("TABLE_CHECKLISTS")


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("/api/checklists/{property_id}")
def list_checklist(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    list_type = qs.get("type")
    date = qs.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not list_type:
        return bad_request("type query param required")

    templates = query_pk(TBL(), f"PROPERTY#{pid}", f"TEMPLATE#{list_type}#ITEM#")
    completions = {
        item["SK"]: item
        for item in query_pk(TBL(), f"PROPERTY#{pid}#DATE#{date}", f"LIST#{list_type}#ITEM#")
    }

    items = []
    for t in templates:
        idx = t["SK"].split("#")[-1]
        completion_key = f"LIST#{list_type}#ITEM#{idx}"
        completion = completions.get(completion_key, {})
        items.append({
            "item_index": int(idx),
            "task_text": t.get("task_text", ""),
            "completed": bool(completion.get("completed", False)),
            "staff_initials": completion.get("staff_initials", ""),
            "completed_at": completion.get("completed_at", ""),
            "notes": completion.get("notes", ""),
        })
    items.sort(key=lambda i: i["item_index"])
    return ok({"items": items, "type": list_type, "date": date})


@router.post("/api/checklists/{property_id}/items/{item_index}/complete")
def complete_item(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    list_type = body.get("type")
    date = body.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    completed = bool(body.get("completed", True))
    if not list_type:
        return bad_request("type required in body")

    identity = get_identity(event)
    initials = body.get("staff_initials") or _initials(identity["name"] or identity["email"])
    item = {
        "PK": f"PROPERTY#{pid}#DATE#{date}",
        "SK": f"LIST#{list_type}#ITEM#{params['item_index']}",
        "completed": completed,
        "staff_initials": initials,
        "completed_at": _now() if completed else "",
        "notes": body.get("notes", ""),
        "type": list_type,
        "item_index": int(params["item_index"]),
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"completed": completed})


def _initials(name):
    parts = [p for p in name.split() if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


# --- Template management ---

@router.post("/api/checklists/{property_id}/templates")
def add_template_item(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    body = parse_body(event)
    list_type = body.get("type")
    item_index = body.get("item_index")
    task_text = body.get("task_text")
    if not list_type or item_index is None or not task_text:
        return bad_request("type, item_index, task_text required")
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{pid}",
        "SK": f"TEMPLATE#{list_type}#ITEM#{int(item_index)}",
        "task_text": task_text,
        "type": list_type,
        "item_index": int(item_index),
    }))
    return ok({"saved": True})


@router.delete("/api/checklists/{property_id}/templates/{item_index}")
def delete_template_item(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    qs = query_params(event)
    list_type = qs.get("type")
    if not list_type:
        return bad_request("type query param required")
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"TEMPLATE#{list_type}#ITEM#{params['item_index']}",
    })
    return ok({"deleted": True})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
