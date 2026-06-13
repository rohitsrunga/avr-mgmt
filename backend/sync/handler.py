"""Cloudbeds sync (Saco Bay only).

Triggered by EventBridge every 6 hours.

Authenticates with a property-level `cbat_` API key sent as a Bearer
token — no OAuth refresh dance. The key is permanent as long as it's
used at least once every 30 days. Pulls the BAN-tile counts
(getDashboard) and the rooms-to-clean union (getHousekeepingStatus +
getReservations) into the CachedReportsTable so the read-only reports
endpoints serve cached data without round-tripping to Cloudbeds.
"""
import json
import os
import traceback
from datetime import datetime, timezone

import boto3
import urllib.parse
import urllib.request

from shared.dynamo import table, to_dynamo

_secrets = boto3.client("secretsmanager")
TBL = lambda: table("TABLE_REPORTS")
SECRET_PREFIX = os.environ.get("CLOUDBEDS_SECRET_PREFIX", "avr/cloudbeds")

PROPERTIES_WITH_CLOUDBEDS = ["saco_bay"]
CLOUDBEDS_BASE = "https://api.cloudbeds.com/api/v1.3"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _get_secret(property_id):
    name = f"{SECRET_PREFIX}/{property_id}"
    resp = _secrets.get_secret_value(SecretId=name)
    return json.loads(resp["SecretString"])


def _cb_get(path, api_key, params=None):
    url = f"{CLOUDBEDS_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    # Send the key as both Bearer and x-api-key — the property-level
    # quickstart accepts Bearer, the v1.3 reference prescribes x-api-key.
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}",
        "x-api-key":     api_key,
        "Accept":        "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _i(value):
    """getDashboard returns some counts as strings ('22') and others as ints —
    coerce defensively."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _cache_today_counts(property_id, dashboard_response):
    """getDashboard splits today's counts into *pending* (`arrivals`,
    `departures`) and *already-completed* (`arrivalsConfirmed`,
    `departuresConfirmed`). The BAN tile is meant to show *today's total*
    so we sum the two. `roomsOccupied` is the live in-house room count;
    `inHouse` is a different (smaller) number whose docs are unclear, so
    we prefer `roomsOccupied`. Stored under the legacy SK so
    reports/handler.py:/today reads it without changes."""
    data = dashboard_response.get("data") or {}
    arrivals   = _i(data.get("arrivals")) + _i(data.get("arrivalsConfirmed"))
    departures = _i(data.get("departures")) + _i(data.get("departuresConfirmed"))
    in_house   = _i(data.get("roomsOccupied")) or _i(data.get("inHouse"))
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{property_id}",
        "SK": f"REPORT#reservations#DATE#{_today()}",
        "data": {
            "arriving_today":  arrivals,
            "in_house":        in_house,
            "departing_today": departures,
        },
        "synced_at": _now(),
        "source": "cloudbeds",
    }))


def _extract_dirty_rooms(hk_response):
    """getHousekeepingStatus row: `roomCondition` is clean|dirty;
    `vacantPickup` is a separate boolean. Either signals the room needs
    attention."""
    rows = hk_response.get("data") or []
    out = []
    for r in rows:
        condition = str(r.get("roomCondition") or "").lower()
        if condition == "dirty" or r.get("vacantPickup"):
            name = r.get("roomName") or r.get("roomID") or ""
            if name:
                out.append(str(name))
    return out


def _extract_departure_rooms(reservations_response):
    """We filter getReservations by checkOutFrom/To=today, so every row in
    the response is checking out today. Pull room identifiers from the
    `rooms` array (populated when includeAllRooms=true)."""
    rows = reservations_response.get("data") or []
    out = []
    for res in rows:
        for room in (res.get("rooms") or res.get("assignedRooms") or []):
            name = (
                room.get("roomName")
                or room.get("roomNumber")
                or room.get("roomID")
                or ""
            )
            if name:
                out.append(str(name))
    return out


def _cache_rooms_to_clean(property_id, dirty, departures):
    union = sorted(set(dirty) | set(departures))
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{property_id}",
        "SK": f"REPORT#rooms_to_clean#DATE#{_today()}",
        "data": {
            "rooms":      union,
            "dirty":      sorted(set(dirty)),
            "departures": sorted(set(departures)),
        },
        "synced_at": _now(),
        "source": "cloudbeds",
    }))


def _record_error(property_id, error):
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{property_id}",
        "SK": f"REPORT#sync_error#DATE#{_now()}",
        "data": {"error": str(error)[:500]},
        "synced_at": _now(),
        "source": "cloudbeds",
    }))


def handler(event, context):
    results = {}
    for pid in PROPERTIES_WITH_CLOUDBEDS:
        try:
            creds = _get_secret(pid)
            api_key = (creds.get("api_key") or "").strip()
            if not api_key or api_key.startswith("PLACEHOLDER"):
                results[pid] = "skipped: no api_key in secret (run scripts/cloudbeds_oauth_setup.py)"
                continue

            try:
                dash = _cb_get("/getDashboard", api_key)
                _cache_today_counts(pid, dash)
            except Exception as e:
                _record_error(pid, f"dashboard: {e}")

            dirty, dirty_ok = [], False
            try:
                hk = _cb_get("/getHousekeepingStatus", api_key, {
                    "roomCondition": "dirty",
                    "pageSize": 5000,
                })
                dirty = _extract_dirty_rooms(hk)
                dirty_ok = True
            except Exception as e:
                _record_error(pid, f"housekeeping: {e}")

            departures, dep_ok = [], False
            try:
                today = _today()
                res = _cb_get("/getReservations", api_key, {
                    "checkOutFrom":    today,
                    "checkOutTo":      today,
                    "includeAllRooms": "true",
                    "pageSize":        100,
                })
                departures = _extract_departure_rooms(res)
                dep_ok = True
            except Exception as e:
                _record_error(pid, f"reservations: {e}")

            # Only overwrite the cached row if at least one source
            # succeeded — otherwise the reports endpoint falls back to
            # yesterday's row, which beats an empty refresh.
            if dirty_ok or dep_ok:
                _cache_rooms_to_clean(pid, dirty, departures)

            results[pid] = "ok"
        except Exception as e:
            traceback.print_exc()
            _record_error(pid, str(e))
            results[pid] = f"error: {e}"
    return {"statusCode": 200, "body": json.dumps(results)}
