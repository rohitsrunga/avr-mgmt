"""Shift task management.

PK = PROPERTY#<property_id>
SK for templates: SHIFT#<1st|2nd|3rd>#TASK#<task_id>
SK for daily completions: DAILY#<YYYY-MM-DD>#SHIFT#<shift>#TASK#<task_id>
SK for handoff: HANDOFF#<YYYY-MM-DD>#SHIFT#<shift>
"""
import uuid
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
TBL = lambda: table("TABLE_SHIFT_TASKS")


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("/api/shifts/{property_id}/tasks")
def list_tasks(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    shift = qs.get("shift")
    date = qs.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not shift:
        return bad_request("shift query param required (1st|2nd|3rd)")

    template_prefix = f"SHIFT#{shift}#TASK#"
    templates = query_pk(TBL(), f"PROPERTY#{pid}", template_prefix)

    daily_prefix = f"DAILY#{date}#SHIFT#{shift}#TASK#"
    completions = {
        item["SK"].split("#")[-1]: item
        for item in query_pk(TBL(), f"PROPERTY#{pid}", daily_prefix)
    }

    tasks = []
    for t in templates:
        task_id = t["SK"].split("#")[-1]
        completion = completions.get(task_id, {})
        tasks.append({
            "task_id": task_id,
            "task_text": t.get("task_text", ""),
            "category": t.get("category", ""),
            "sort_order": int(t.get("sort_order", 0)),
            "shift": shift,
            "completed": bool(completion.get("completed", False)),
            "completed_by": completion.get("completed_by", ""),
            "completed_at": completion.get("completed_at", ""),
        })
    tasks.sort(key=lambda t: (t["category"], t["sort_order"]))
    return ok({"tasks": tasks, "date": date, "shift": shift})


@router.post("/api/shifts/{property_id}/tasks/{task_id}/complete")
def complete_task(event, params):
    pid = params["property_id"]
    task_id = params["task_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    shift = body.get("shift")
    date = body.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    completed = bool(body.get("completed", True))
    if not shift:
        return bad_request("shift required in body (1st|2nd|3rd)")

    identity = get_identity(event)
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"DAILY#{date}#SHIFT#{shift}#TASK#{task_id}",
        "completed": completed,
        "completed_by": identity["name"] or identity["email"],
        "completed_at": _now() if completed else "",
        "task_id": task_id,
        "shift": shift,
        "date": date,
        "GSI1PK": f"PROPERTY#{pid}#DATE#{date}",
        "GSI1SK": f"SHIFT#{shift}#TASK#{task_id}",
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"task_id": task_id, "completed": completed})


@router.get("/api/shifts/{property_id}/handoff")
def get_handoff(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    qs = query_params(event)
    shift = qs.get("shift")
    date = qs.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not shift:
        return bad_request("shift required")
    resp = TBL().get_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"HANDOFF#{date}#SHIFT#{shift}",
    })
    item = resp.get("Item") or {}
    return ok({
        "shift": shift,
        "date": date,
        "notes": item.get("notes", ""),
        "updated_by": item.get("updated_by", ""),
        "updated_at": item.get("updated_at", ""),
    })


@router.post("/api/shifts/{property_id}/handoff")
def save_handoff(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, ALL_ROLES)
    if err:
        return err
    body = parse_body(event)
    shift = body.get("shift")
    date = body.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    notes = body.get("notes", "")
    if not shift:
        return bad_request("shift required")
    identity = get_identity(event)
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{pid}",
        "SK": f"HANDOFF#{date}#SHIFT#{shift}",
        "notes": notes,
        "updated_by": identity["name"] or identity["email"],
        "updated_at": _now(),
    }))
    return ok({"saved": True})


# --- Template management (owner/manager) ---

@router.post("/api/shifts/{property_id}/templates")
def create_template_task(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    body = parse_body(event)
    shift = body.get("shift")
    if not shift:
        return bad_request("shift required")
    task_id = body.get("task_id") or str(uuid.uuid4())[:8]
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"SHIFT#{shift}#TASK#{task_id}",
        "task_id": task_id,
        "task_text": body.get("task_text", ""),
        "category": body.get("category", ""),
        "sort_order": int(body.get("sort_order", 0)),
        "is_template": True,
        "shift": shift,
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({"task_id": task_id})


@router.put("/api/shifts/{property_id}/templates/{task_id}")
def update_template_task(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    body = parse_body(event)
    shift = body.get("shift")
    if not shift:
        return bad_request("shift required")
    task_id = params["task_id"]
    update_attrs = {}
    for k in ["task_text", "category", "sort_order"]:
        if k in body:
            update_attrs[k] = body[k]
    if not update_attrs:
        return bad_request("no fields to update")
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in update_attrs)
    names = {f"#{k}": k for k in update_attrs}
    values = to_dynamo({f":{k}": v for k, v in update_attrs.items()})
    TBL().update_item(
        Key={"PK": f"PROPERTY#{pid}", "SK": f"SHIFT#{shift}#TASK#{task_id}"},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return ok({"updated": True})


@router.delete("/api/shifts/{property_id}/templates/{task_id}")
def delete_template_task(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    qs = query_params(event)
    shift = qs.get("shift")
    if not shift:
        return bad_request("shift required as query param")
    task_id = params["task_id"]
    TBL().delete_item(Key={
        "PK": f"PROPERTY#{pid}",
        "SK": f"SHIFT#{shift}#TASK#{task_id}",
    })
    return ok({"deleted": True})


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
