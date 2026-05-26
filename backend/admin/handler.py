"""User management + per-property feature flags. Owner-only writes.

Cognito user CRUD plus an /api/admin/features section that backs the
"Property features" toggles in the Admin tab.
"""
import os
import secrets

import boto3

from shared.auth import ALL_ROLES, ROLE_OWNER, authorize, get_identity
from shared.response import bad_request, forbidden, not_found, ok, server_error
from shared.router import Router, parse_body
from shared.settings import (
    TOGGLEABLE_FEATURES,
    VALID_PROPERTIES,
    get_all_feature_configs,
    set_feature_config,
)

router = Router()
_cognito = boto3.client("cognito-idp")
USER_POOL_ID = os.environ["USER_POOL_ID"]

VALID_PROPERTIES = {"casco_bay", "saco_bay", "both"}


def _attr(user, name):
    for a in user.get("Attributes", []) or user.get("UserAttributes", []):
        if a["Name"] == name:
            return a["Value"]
    return ""


def _serialize_user(u):
    return {
        "username": u.get("Username", ""),
        "email": _attr(u, "email"),
        "name": _attr(u, "name"),
        "role": _attr(u, "custom:role"),
        "property": _attr(u, "custom:property"),
        "enabled": u.get("Enabled", True),
        "status": u.get("UserStatus", ""),
        "created": u.get("UserCreateDate").isoformat() if u.get("UserCreateDate") else "",
    }


@router.get("/api/admin/users")
def list_users(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    users = []
    pagination_token = None
    while True:
        kwargs = {"UserPoolId": USER_POOL_ID, "Limit": 60}
        if pagination_token:
            kwargs["PaginationToken"] = pagination_token
        resp = _cognito.list_users(**kwargs)
        users.extend(resp.get("Users", []))
        pagination_token = resp.get("PaginationToken")
        if not pagination_token:
            break
    return ok({"users": [_serialize_user(u) for u in users]})


@router.post("/api/admin/users")
def create_user(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    body = parse_body(event)
    email = body.get("email")
    role = body.get("role")
    prop = body.get("property", "both")
    name = body.get("name", "")
    if not email or not role:
        return bad_request("email and role required")
    if role not in ALL_ROLES:
        return bad_request(f"role must be one of {ALL_ROLES}")
    if prop not in VALID_PROPERTIES:
        return bad_request(f"property must be one of {VALID_PROPERTIES}")
    temp_password = body.get("temp_password") or _generate_temp_password()
    try:
        _cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "name", "Value": name},
                {"Name": "custom:role", "Value": role},
                {"Name": "custom:property", "Value": prop},
            ],
            TemporaryPassword=temp_password,
            MessageAction="SUPPRESS",  # owner shares password manually
        )
    except _cognito.exceptions.UsernameExistsException:
        return bad_request("user already exists")
    return ok({"username": email, "temp_password": temp_password})


@router.put("/api/admin/users/{username}")
def update_user(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    username = params["username"]
    body = parse_body(event)
    attrs = []
    if "name" in body:
        attrs.append({"Name": "name", "Value": body["name"]})
    if "role" in body:
        if body["role"] not in ALL_ROLES:
            return bad_request(f"role must be one of {ALL_ROLES}")
        attrs.append({"Name": "custom:role", "Value": body["role"]})
    if "property" in body:
        if body["property"] not in VALID_PROPERTIES:
            return bad_request(f"property must be one of {VALID_PROPERTIES}")
        attrs.append({"Name": "custom:property", "Value": body["property"]})
    if attrs:
        try:
            _cognito.admin_update_user_attributes(
                UserPoolId=USER_POOL_ID,
                Username=username,
                UserAttributes=attrs,
            )
        except _cognito.exceptions.UserNotFoundException:
            return not_found("user not found")
    if "enabled" in body:
        if body["enabled"]:
            _cognito.admin_enable_user(UserPoolId=USER_POOL_ID, Username=username)
        else:
            _cognito.admin_disable_user(UserPoolId=USER_POOL_ID, Username=username)
    return ok({"updated": True})


@router.post("/api/admin/users/{username}/reset-password")
def reset_password(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    body = parse_body(event)
    new_password = body.get("new_password") or _generate_temp_password()
    permanent = bool(body.get("permanent", False))
    try:
        _cognito.admin_set_user_password(
            UserPoolId=USER_POOL_ID,
            Username=params["username"],
            Password=new_password,
            Permanent=permanent,
        )
    except _cognito.exceptions.UserNotFoundException:
        return not_found("user not found")
    return ok({"new_password": new_password, "permanent": permanent})


@router.delete("/api/admin/users/{username}")
def delete_user(event, params):
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    identity = get_identity(event)
    if identity["email"] == params["username"]:
        return bad_request("cannot delete your own account")
    try:
        _cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=params["username"])
    except _cognito.exceptions.UserNotFoundException:
        return not_found("user not found")
    return ok({"deleted": True})


# ---------------------------------------------------------------------------
# Feature flags (per-property, owner-toggleable)
# ---------------------------------------------------------------------------

@router.get("/api/admin/features")
def list_features(event, params):
    """Any authenticated user can read this — the SPA uses it at startup to
    decide which nav tabs to render."""
    err = authorize(event, ALL_ROLES)
    if err:
        return err
    return ok({
        "properties": list(VALID_PROPERTIES),
        "features": list(TOGGLEABLE_FEATURES),
        "config": get_all_feature_configs(),
    })


@router.put("/api/admin/features/{property_id}")
def update_features(event, params):
    """Owner-only. Body: {enabled: ["dinner","groups",...]}."""
    err = authorize(event, [ROLE_OWNER])
    if err:
        return err
    pid = params["property_id"]
    if pid not in VALID_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    body = parse_body(event)
    enabled = body.get("enabled")
    if not isinstance(enabled, list):
        return bad_request("body must include an `enabled` list of feature ids")
    cleaned = set_feature_config(pid, enabled)
    return ok({"property_id": pid, "enabled": cleaned})


def _generate_temp_password():
    """12-char password meeting Cognito policy: upper+lower+number."""
    upper = "ABCDEFGHJKMNPQRSTUVWXYZ"
    lower = "abcdefghjkmnpqrstuvwxyz"
    digits = "23456789"
    chars = upper + lower + digits
    pw = [secrets.choice(upper), secrets.choice(lower), secrets.choice(digits)]
    pw += [secrets.choice(chars) for _ in range(9)]
    secrets.SystemRandom().shuffle(pw)
    return "".join(pw)


def handler(event, context):
    try:
        return router.dispatch(event)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return server_error(str(e))
