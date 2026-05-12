from .response import forbidden, unauthorized


ROLE_OWNER = "owner"
ROLE_MANAGER = "manager"
ROLE_FRONTDESK = "frontdesk"
ROLE_HOUSEKEEPING = "housekeeping"
ROLE_GROUNDS = "grounds"
ROLE_BREAKFAST = "breakfast"

ALL_ROLES = [
    ROLE_OWNER,
    ROLE_MANAGER,
    ROLE_FRONTDESK,
    ROLE_HOUSEKEEPING,
    ROLE_GROUNDS,
    ROLE_BREAKFAST,
]

MANAGEMENT_ROLES = [ROLE_OWNER, ROLE_MANAGER]


def _claims(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]
    except (KeyError, TypeError):
        return {}


def get_identity(event):
    """Return the caller's identity dict from JWT claims."""
    c = _claims(event)
    return {
        "sub": c.get("sub", ""),
        "email": c.get("email", ""),
        "name": c.get("name", c.get("email", "")),
        "role": c.get("custom:role", ""),
        "property": c.get("custom:property", ""),
    }


def authorize(event, allowed_roles):
    """Return None if authorized, otherwise an error response."""
    identity = get_identity(event)
    if not identity["sub"]:
        return unauthorized()
    if identity["role"] not in allowed_roles:
        return forbidden()
    return None


def authorize_property(event, property_id, allowed_roles=None):
    """Authorize role + property scope. Owner/manager can access any property.
    Other roles must have custom:property == property_id or 'both'."""
    identity = get_identity(event)
    if not identity["sub"]:
        return unauthorized()
    if allowed_roles is not None and identity["role"] not in allowed_roles:
        return forbidden()
    if identity["role"] in MANAGEMENT_ROLES:
        return None
    user_property = identity["property"]
    if user_property == "both" or user_property == property_id:
        return None
    return forbidden(f"Not authorized for property {property_id}")
