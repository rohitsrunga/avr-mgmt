"""Per-property feature flags (owner-toggleable from the Admin tab).

Item shape in the SettingsTable:
    PK = PROPERTY#<property_id>
    SK = FEATURES
    enabled = [<feature_id>, ...]    # list of feature ids that are turned on

The absence of an item (the default) means **all toggleable features are
enabled**. Owner writes through the admin Lambda flip individual feature
flags; backend handlers read here to gate public/authenticated routes.
"""
import os
from typing import Iterable, List

import boto3

_dynamodb = boto3.resource("dynamodb")

# Properties the system knows about. Used for validation.
VALID_PROPERTIES = ("casco_bay", "saco_bay")

# Features owners can toggle per property. Sections always available to all
# properties (shifts, inventory, rooms, housekeeping, admin) are deliberately
# not listed here — they aren't user-toggleable.
# Note: dinner orders is a Casco Bay-only program, gated by property in the
# dinner_orders Lambda — it is intentionally NOT a per-property toggle.
TOGGLEABLE_FEATURES = (
    "business_case",
    "groups",
    "inspections",
)


def _table():
    return _dynamodb.Table(os.environ["TABLE_SETTINGS"])


def _normalize_enabled(values: Iterable[str]) -> List[str]:
    """Filter to known features, preserving order, removing dups."""
    seen = []
    for v in values or []:
        if v in TOGGLEABLE_FEATURES and v not in seen:
            seen.append(v)
    return seen


def get_feature_config(property_id: str) -> List[str]:
    """Return the list of enabled features for one property.
    Defaults to all toggleable features when no row exists."""
    try:
        resp = _table().get_item(Key={"PK": f"PROPERTY#{property_id}", "SK": "FEATURES"})
    except Exception as e:
        # Log to CloudWatch so a silently-broken read (perms, missing table,
        # wrong env var) is at least visible in `sam logs`. We still return
        # defaults so the UI doesn't 500, but the log surfaces the root cause.
        print(f"[settings.get_feature_config] {property_id}: read failed: {type(e).__name__}: {e}")
        return list(TOGGLEABLE_FEATURES)
    item = resp.get("Item")
    if not item:
        print(f"[settings.get_feature_config] {property_id}: no item — returning defaults")
        return list(TOGGLEABLE_FEATURES)
    if "enabled" not in item:
        print(f"[settings.get_feature_config] {property_id}: item missing 'enabled' key (keys={list(item.keys())})")
        return list(TOGGLEABLE_FEATURES)
    return _normalize_enabled(item["enabled"])


def get_all_feature_configs() -> dict:
    """Return {property_id: [enabled features]} for every known property.
    Always includes every property in VALID_PROPERTIES."""
    return {pid: get_feature_config(pid) for pid in VALID_PROPERTIES}


def set_feature_config(property_id: str, enabled: Iterable[str]) -> List[str]:
    """Replace the enabled list for a property. Returns the cleaned list
    that was actually persisted."""
    if property_id not in VALID_PROPERTIES:
        raise ValueError(f"unknown property: {property_id}")
    cleaned = _normalize_enabled(enabled)
    _table().put_item(Item={
        "PK": f"PROPERTY#{property_id}",
        "SK": "FEATURES",
        "enabled": cleaned,
    })
    return cleaned


def is_feature_enabled(property_id: str, feature_id: str) -> bool:
    """Cheap predicate used by domain Lambdas to gate routes."""
    if property_id not in VALID_PROPERTIES:
        return False
    if feature_id not in TOGGLEABLE_FEATURES:
        # Unknown feature → treat as always enabled. Lets us add new features
        # to the code without first writing rows for every property.
        return True
    return feature_id in get_feature_config(property_id)
