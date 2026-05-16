"""Employee onboarding.

PK = PROPERTY#<property_id>
SK = EMPLOYEE#<employee_id>           (UUID)
GSI TokenIndex (GSI1PK = TOKEN#<sha256(token)>) — used to resolve an invite token
back to the employee row on form load/submit.

Two route prefixes:
- /api/admin/employees/*    — owner-only console
- /api/public/onboarding/*  — token-gated, no Cognito auth
"""
import hashlib
import html
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

from shared.auth import ROLE_OWNER, authorize, get_identity
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, forbidden, not_found, ok, server_error
from shared.router import Router, parse_body, query_params

router = Router()

TBL = lambda: table("TABLE_EMPLOYEES")
FILLED_BUCKET = os.environ.get("EMPLOYEES_FILLED_BUCKET", "")
_s3 = boto3.client("s3")

VALID_PROPERTIES = {"casco_bay", "saco_bay"}
HOTEL_NAMES = {"casco_bay": "Casco Bay Hotel", "saco_bay": "Saco Bay Hotel"}
COMPANY_NAMES = {
    "casco_bay": "Northeastern Group Management",
    "saco_bay": "Northeastern Hospitality Management",
}
TOKEN_TTL_DAYS = 7

ACTIVE_STATUSES = {"invited", "opened"}
TERMINAL_STATUSES = {"submitted", "reviewed", "archived"}
ALL_STATUSES = ACTIVE_STATUSES | TERMINAL_STATUSES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now():
    return datetime.now(timezone.utc).isoformat()


def _expires_at(days=TOKEN_TTL_DAYS):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_token():
    return secrets.token_urlsafe(32)


def _is_expired(item):
    expires = item.get("token_expires_at") or ""
    if not expires:
        return False
    try:
        return datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc)
    except ValueError:
        return False


def _derived_status(item):
    """Promote 'invited'/'opened' to 'expired' once the token TTL has passed."""
    s = item.get("status", "invited")
    if s in ACTIVE_STATUSES and _is_expired(item):
        return "expired"
    return s


def _mask_ssn(value):
    if not value:
        return ""
    digits = "".join(c for c in str(value) if c.isdigit())
    if len(digits) < 4:
        return "***"
    return f"***-**-{digits[-4:]}"


def _mask_account(value):
    if not value:
        return ""
    s = str(value)
    if len(s) <= 4:
        return "*" * len(s)
    return "*" * (len(s) - 4) + s[-4:]


def _summary(item):
    """Caller-safe summary used in list views. SSN/bank are NOT included."""
    return {
        "employee_id": item.get("employee_id", ""),
        "name": item.get("name", ""),
        "email": item.get("email", ""),
        "phone": item.get("phone", ""),
        "property": item.get("property", ""),
        "status": _derived_status(item),
        "invited_at": item.get("invited_at", ""),
        "opened_at": item.get("opened_at", ""),
        "submitted_at": item.get("submitted_at", ""),
        "reviewed_at": item.get("reviewed_at", ""),
        "archived_at": item.get("archived_at", ""),
        "token_expires_at": item.get("token_expires_at", ""),
        "has_filled_form": bool(item.get("filled_s3_key")),
        "created_by": item.get("created_by", ""),
    }


def _details(item, reveal=False):
    """Full detail view, with masking unless reveal=True."""
    data = dict(item.get("submitted_data") or {})
    if not reveal:
        if data.get("ssn"):
            data["ssn"] = _mask_ssn(data["ssn"])
        if data.get("account_number"):
            data["account_number"] = _mask_account(data["account_number"])
        if data.get("routing_number"):
            data["routing_number"] = _mask_account(data["routing_number"])
    out = _summary(item)
    out["submitted_data"] = data
    return out


# ---------------------------------------------------------------------------
# Filled HTML rendering — produced server-side at submit time and stored in S3.
# ---------------------------------------------------------------------------

_ACK_LABELS = {
    "at_will": "At-Will Employment",
    "handbook": "Employee Handbook Receipt",
    "mepl": "Maine Earned Paid Leave (MEPL)",
    "harassment": "Maine Sexual Harassment & Protected Leave",
    "safety": "Maine VDT & OSHA HazCom Safety",
}


def _esc(v):
    return html.escape(str(v)) if v is not None else ""


def _row(label, value):
    return f'<tr><th style="text-align:left;padding:6px 12px 6px 0;color:#6e6e73;font-weight:500;width:200px;">{_esc(label)}</th><td style="padding:6px 0;color:#1d1d1f;">{_esc(value) or "&mdash;"}</td></tr>'


def _render_filled_html(item, data):
    pid = item.get("property", "casco_bay")
    hotel = HOTEL_NAMES.get(pid, "")
    company = COMPANY_NAMES.get(pid, "")
    submitted_at = item.get("submitted_at", "")
    sig_png = data.get("signature_png", "")
    sig_img = (
        f'<img src="{_esc(sig_png)}" alt="signature" '
        f'style="max-width:360px;height:auto;border:1px solid #d2d2d7;border-radius:8px;padding:8px;background:#fff;" />'
        if sig_png else "<em>No signature captured.</em>"
    )
    acks_html = "".join(
        f"<li><strong>{_esc(label)}:</strong> {'Acknowledged' if data.get('ack', {}).get(key) else 'NOT acknowledged'}</li>"
        for key, label in _ACK_LABELS.items()
    )
    pay_status = data.get("status_type", "")
    elect_401k = "Participating" if data.get("elect_401k") else "Opted out"
    contrib = ""
    if data.get("elect_401k"):
        pct = data.get("contrib_percent", "")
        amt = data.get("contrib_amount", "")
        if pct:
            contrib = f"{pct}% per pay period"
        elif amt:
            contrib = f"${amt} per pay period"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Onboarding · {_esc(item.get('name', ''))} · {_esc(hotel)}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Helvetica, Arial, sans-serif; color:#1d1d1f; background:#f5f5f7; margin:0; padding:32px 16px; line-height:1.5; }}
  .doc {{ max-width:780px; margin:0 auto; background:#fff; border:1px solid #e5e5ea; border-radius:16px; padding:40px; box-shadow:0 1px 2px rgba(0,0,0,.04); }}
  header.brand {{ border-bottom:1px solid #e5e5ea; padding-bottom:20px; margin-bottom:28px; }}
  header.brand .hotel {{ font-size:22px; font-weight:600; letter-spacing:-0.012em; }}
  header.brand .company {{ font-size:14px; color:#6e6e73; margin-top:2px; }}
  h1 {{ font-size:28px; font-weight:600; letter-spacing:-0.022em; margin:0 0 4px; }}
  .meta {{ color:#6e6e73; font-size:13px; margin-bottom:32px; }}
  h2 {{ font-size:18px; font-weight:600; margin:32px 0 12px; letter-spacing:-0.012em; }}
  table.kv {{ width:100%; border-collapse:collapse; font-size:14px; }}
  ul {{ margin:0; padding-left:20px; font-size:14px; }}
  .sig {{ border-top:1px solid #e5e5ea; margin-top:32px; padding-top:24px; }}
  .footer {{ color:#86868b; font-size:12px; margin-top:40px; text-align:center; }}
  @media print {{ body {{ background:#fff; padding:0; }} .doc {{ border:none; box-shadow:none; padding:0; }} }}
</style>
</head>
<body>
<div class="doc">
  <header class="brand">
    <div class="hotel">{_esc(hotel)}</div>
    <div class="company">{_esc(company)}</div>
  </header>

  <h1>New Hire Onboarding Packet</h1>
  <div class="meta">Submitted {_esc(submitted_at)}</div>

  <h2>Part 1 — Employee Information</h2>
  <table class="kv">
    {_row("Name", data.get("name") or item.get("name"))}
    {_row("Email", data.get("email") or item.get("email"))}
    {_row("Phone", data.get("phone") or item.get("phone"))}
    {_row("Address", data.get("address"))}
    {_row("Date of birth", data.get("dob"))}
    {_row("SSN", data.get("ssn"))}
    {_row("Date hired", data.get("date_hired"))}
    {_row("Position", data.get("position"))}
    {_row("Pay rate", data.get("pay_rate"))}
    {_row("Status", pay_status)}
    {_row("Emergency contact name", data.get("emergency_name"))}
    {_row("Emergency contact relationship", data.get("emergency_relationship"))}
    {_row("Emergency contact phone", data.get("emergency_phone"))}
  </table>

  <h2>Part 2 — Direct Deposit &amp; 401(k)</h2>
  <table class="kv">
    {_row("Bank name", data.get("bank_name"))}
    {_row("Account type", data.get("account_type"))}
    {_row("Routing number", data.get("routing_number"))}
    {_row("Account number", data.get("account_number"))}
    {_row("Deposit status", data.get("deposit_status"))}
    {_row("401(k) election", elect_401k)}
    {_row("401(k) contribution", contrib)}
  </table>

  <h2>Part 3 — Policy Acknowledgments</h2>
  <ul>{acks_html}</ul>

  <div class="sig">
    <h2 style="margin-top:0;">Signature</h2>
    <table class="kv">
      {_row("Typed full name", data.get("typed_name"))}
      {_row("Date signed", data.get("typed_date"))}
    </table>
    <div style="margin-top:16px;">{sig_img}</div>
  </div>

  <div class="footer">{_esc(company)} &middot; This document is a record of an electronically signed onboarding submission.</div>
</div>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def _find_by_token(token):
    tbl = TBL()
    token_hash = _hash_token(token)
    resp = tbl.query(
        IndexName="TokenIndex",
        KeyConditionExpression=Key("GSI1PK").eq(f"TOKEN#{token_hash}"),
        Limit=1,
    )
    items = resp.get("Items") or []
    return items[0] if items else None


def _get(pid, eid):
    return TBL().get_item(Key={"PK": f"PROPERTY#{pid}", "SK": f"EMPLOYEE#{eid}"}).get("Item")


def _list_for_property(pid):
    return query_pk(TBL(), f"PROPERTY#{pid}", "EMPLOYEE#")


# ---------------------------------------------------------------------------
# Admin routes (owner-only)
# ---------------------------------------------------------------------------

@router.get("/api/admin/employees")
def list_employees(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    qs = query_params(event)
    pid_filter = qs.get("property")
    if pid_filter and pid_filter not in VALID_PROPERTIES:
        return bad_request(f"property must be one of {sorted(VALID_PROPERTIES)}")
    props = [pid_filter] if pid_filter else sorted(VALID_PROPERTIES)
    items = []
    for p in props:
        items.extend(_list_for_property(p))
    items = [_summary(it) for it in items]
    items.sort(key=lambda x: x.get("invited_at", ""), reverse=True)
    return ok({"employees": items})


@router.post("/api/admin/employees")
def create_employee(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    identity = get_identity(event)
    body = parse_body(event)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    phone = (body.get("phone") or "").strip()
    pid = body.get("property")
    if not name or len(name) > 120:
        return bad_request("name required (<=120 chars)")
    if not email or "@" not in email or len(email) > 200:
        return bad_request("valid email required")
    if pid not in VALID_PROPERTIES:
        return bad_request(f"property must be one of {sorted(VALID_PROPERTIES)}")
    if phone and len(phone) > 40:
        return bad_request("phone too long")

    employee_id = uuid.uuid4().hex
    token = _new_token()
    token_hash = _hash_token(token)
    now = _now()
    expires = _expires_at()
    item = {
        "PK": f"PROPERTY#{pid}",
        "SK": f"EMPLOYEE#{employee_id}",
        "GSI1PK": f"TOKEN#{token_hash}",
        "employee_id": employee_id,
        "name": name,
        "email": email,
        "phone": phone,
        "property": pid,
        "status": "invited",
        "invited_at": now,
        "token_hash": token_hash,
        "token_expires_at": expires,
        "created_by": identity.get("email", ""),
    }
    TBL().put_item(Item=to_dynamo(item))
    return ok({
        "employee": _summary(item),
        "invite_token": token,
        "token_expires_at": expires,
    })


@router.get("/api/admin/employees/{employee_id}")
def get_employee(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    qs = query_params(event)
    eid = params["employee_id"]
    item = _find_in_any_property(eid)
    if not item:
        return not_found("employee not found")
    reveal = qs.get("reveal") in ("1", "true", "yes")
    return ok({"employee": _details(item, reveal=reveal)})


@router.get("/api/admin/employees/{employee_id}/filled-url")
def get_filled_url(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    item = _find_in_any_property(params["employee_id"])
    if not item:
        return not_found("employee not found")
    key = item.get("filled_s3_key")
    if not key:
        return not_found("no filled form on file")
    url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": FILLED_BUCKET, "Key": key, "ResponseContentType": "text/html; charset=utf-8"},
        ExpiresIn=900,
    )
    return ok({"url": url, "expires_in_seconds": 900})


@router.post("/api/admin/employees/{employee_id}/resend")
def resend_invite(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    item = _find_in_any_property(params["employee_id"])
    if not item:
        return not_found("employee not found")
    if item.get("status") in ("submitted", "reviewed", "archived"):
        return bad_request("cannot resend after submission")
    token = _new_token()
    token_hash = _hash_token(token)
    expires = _expires_at()
    TBL().update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET token_hash = :h, GSI1PK = :g, token_expires_at = :e, #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":h": token_hash,
            ":g": f"TOKEN#{token_hash}",
            ":e": expires,
            ":s": "invited",
        },
    )
    item["token_hash"] = token_hash
    item["token_expires_at"] = expires
    item["status"] = "invited"
    return ok({
        "employee": _summary(item),
        "invite_token": token,
        "token_expires_at": expires,
    })


@router.post("/api/admin/employees/{employee_id}/status")
def set_status(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    body = parse_body(event)
    new_status = body.get("status")
    if new_status not in ("reviewed", "archived"):
        return bad_request("status must be 'reviewed' or 'archived'")
    item = _find_in_any_property(params["employee_id"])
    if not item:
        return not_found("employee not found")
    now = _now()
    ts_attr = f"{new_status}_at"
    TBL().update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET #s = :s, #t = :now",
        ExpressionAttributeNames={"#s": "status", "#t": ts_attr},
        ExpressionAttributeValues={":s": new_status, ":now": now},
    )
    item["status"] = new_status
    item[ts_attr] = now
    return ok({"employee": _summary(item)})


@router.delete("/api/admin/employees/{employee_id}")
def delete_employee(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    item = _find_in_any_property(params["employee_id"])
    if not item:
        return not_found("employee not found")
    if item.get("filled_s3_key"):
        try:
            _s3.delete_object(Bucket=FILLED_BUCKET, Key=item["filled_s3_key"])
        except Exception:
            pass
    TBL().delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return ok({"deleted": True})


def _find_in_any_property(eid):
    """Employees are partitioned by property; admin lookups only have the id.
    We scan the two property partitions (cheap; PAY_PER_REQUEST + small N)."""
    for p in VALID_PROPERTIES:
        it = _get(p, eid)
        if it:
            return it
    return None


# ---------------------------------------------------------------------------
# Public routes (no auth) — token-gated
# ---------------------------------------------------------------------------

@router.post("/api/public/onboarding/init")
def public_init(event, params):
    body = parse_body(event)
    token = (body.get("token") or "").strip()
    if not token or len(token) > 200:
        return bad_request("token required")
    item = _find_by_token(token)
    if not item:
        return forbidden("invalid or expired link")
    if _is_expired(item):
        return forbidden("invalid or expired link")
    status = item.get("status", "invited")
    if status in TERMINAL_STATUSES:
        return forbidden("this onboarding has already been submitted")
    pid = item.get("property", "")
    # Flip invited -> opened on first visit.
    if status == "invited":
        TBL().update_item(
            Key={"PK": item["PK"], "SK": item["SK"]},
            UpdateExpression="SET #s = :s, opened_at = :now",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "opened", ":now": _now()},
        )
    return ok({
        "employee_id": item.get("employee_id"),
        "name": item.get("name"),
        "email": item.get("email"),
        "property": pid,
        "hotel_name": HOTEL_NAMES.get(pid, ""),
        "company_name": COMPANY_NAMES.get(pid, ""),
        "token_expires_at": item.get("token_expires_at", ""),
    })


@router.post("/api/public/onboarding/submit")
def public_submit(event, params):
    body = parse_body(event)
    token = (body.get("token") or "").strip()
    if not token:
        return bad_request("token required")
    item = _find_by_token(token)
    if not item or _is_expired(item):
        return forbidden("invalid or expired link")
    if item.get("status") in TERMINAL_STATUSES:
        return forbidden("this onboarding has already been submitted")

    cleaned, err = _validate_submission(body.get("answers") or {})
    if err:
        return bad_request(err)

    pid = item.get("property", "casco_bay")
    eid = item.get("employee_id")
    now = _now()
    item["submitted_at"] = now
    item["status"] = "submitted"

    filled_html = _render_filled_html({**item, "submitted_at": now}, cleaned)
    s3_key = f"filled/{eid}.html"
    _s3.put_object(
        Bucket=FILLED_BUCKET,
        Key=s3_key,
        Body=filled_html.encode("utf-8"),
        ContentType="text/html; charset=utf-8",
        ServerSideEncryption="AES256",
    )

    TBL().update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression=(
            "SET #s = :s, submitted_at = :now, submitted_data = :d, "
            "filled_s3_key = :k REMOVE token_hash, GSI1PK, token_expires_at"
        ),
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues=to_dynamo({
            ":s": "submitted",
            ":now": now,
            ":d": cleaned,
            ":k": s3_key,
        }),
    )
    return ok({"submitted_at": now})


# ---------------------------------------------------------------------------
# Submission validation
# ---------------------------------------------------------------------------

_REQUIRED_TEXT_FIELDS = [
    ("name", 120),
    ("address", 240),
    ("dob", 40),
    ("ssn", 40),
    ("position", 80),
    ("email", 200),
    ("phone", 40),
    ("emergency_name", 120),
    ("emergency_phone", 40),
    ("typed_name", 120),
    ("typed_date", 40),
]

_OPTIONAL_TEXT_FIELDS = [
    ("date_hired", 40),
    ("pay_rate", 40),
    ("emergency_relationship", 80),
    ("bank_name", 120),
    ("account_type", 20),
    ("routing_number", 20),
    ("account_number", 40),
    ("deposit_status", 40),
    ("status_type", 20),
    ("contrib_percent", 10),
    ("contrib_amount", 20),
]

_REQUIRED_ACKS = ("at_will", "handbook", "mepl", "harassment", "safety")


def _validate_submission(answers):
    cleaned = {}
    for field, maxlen in _REQUIRED_TEXT_FIELDS:
        v = (answers.get(field) or "").strip()
        if not v:
            return None, f"{field} is required"
        if len(v) > maxlen:
            return None, f"{field} too long"
        cleaned[field] = v
    for field, maxlen in _OPTIONAL_TEXT_FIELDS:
        v = (answers.get(field) or "").strip()
        if len(v) > maxlen:
            return None, f"{field} too long"
        cleaned[field] = v
    ack = answers.get("ack") or {}
    if not isinstance(ack, dict):
        return None, "ack must be an object"
    for key in _REQUIRED_ACKS:
        if not ack.get(key):
            return None, f"You must acknowledge: {key}"
    cleaned["ack"] = {k: bool(ack.get(k)) for k in _REQUIRED_ACKS}
    cleaned["elect_401k"] = bool(answers.get("elect_401k"))
    sig = answers.get("signature_png") or ""
    if not sig.startswith("data:image/"):
        return None, "signature required"
    if len(sig) > 500_000:
        return None, "signature image too large"
    cleaned["signature_png"] = sig
    return cleaned, None


# ---------------------------------------------------------------------------
# Lambda entry
# ---------------------------------------------------------------------------

def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
