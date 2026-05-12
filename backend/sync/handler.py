"""Cloudbeds sync (Saco Bay only).

Triggered by EventBridge every 6 hours.
Refreshes OAuth token, pulls dashboard/reservations/transactions, caches into DynamoDB.
"""
import json
import os
import traceback
from datetime import datetime, timezone

import boto3
import urllib.request
import urllib.parse
import urllib.error

from shared.dynamo import table, to_dynamo

_secrets = boto3.client("secretsmanager")
TBL = lambda: table("TABLE_REPORTS")
SECRET_PREFIX = os.environ.get("CLOUDBEDS_SECRET_PREFIX", "avr/cloudbeds")

PROPERTIES_WITH_CLOUDBEDS = ["saco_bay"]
CLOUDBEDS_BASE = "https://api.cloudbeds.com"
TOKEN_URL = "https://hotels.cloudbeds.com/api/v1.1/access_token"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _http_post_form(url, data, headers=None):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _get_secret(property_id):
    name = f"{SECRET_PREFIX}/{property_id}"
    resp = _secrets.get_secret_value(SecretId=name)
    return json.loads(resp["SecretString"])


def _put_secret(property_id, data):
    name = f"{SECRET_PREFIX}/{property_id}"
    _secrets.put_secret_value(SecretId=name, SecretString=json.dumps(data))


def _refresh_token(creds):
    resp = _http_post_form(TOKEN_URL, {
        "grant_type": "refresh_token",
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
    })
    return resp


def _cb_get(path, access_token):
    return _http_get(
        f"{CLOUDBEDS_BASE}{path}",
        headers={"Authorization": f"Bearer {access_token}"},
    )


def _cache_daily_stats(property_id, dashboard_response):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    data = dashboard_response.get("data") or dashboard_response
    payload = {
        "occupancy_pct": data.get("occupancy", data.get("occupancy_pct", 0)),
        "adr": data.get("adr", 0),
        "revpar": data.get("revpar", 0),
        "total_revenue": data.get("revenue", data.get("total_revenue", 0)),
        "rooms_sold": data.get("rooms_sold", 0),
        "rooms_available": data.get("rooms_available", 0),
    }
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{property_id}",
        "SK": f"REPORT#daily_stats#DATE#{today}",
        "data": payload,
        "synced_at": _now(),
        "source": "cloudbeds",
    }))


def _cache_reservations(property_id, reservations_response):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    data = reservations_response.get("data") or {}
    payload = {
        "arriving_today": data.get("arriving_today", 0),
        "departing_today": data.get("departing_today", 0),
        "in_house": data.get("in_house", 0),
        "no_shows": data.get("no_shows", 0),
    }
    TBL().put_item(Item=to_dynamo({
        "PK": f"PROPERTY#{property_id}",
        "SK": f"REPORT#reservations#DATE#{today}",
        "data": payload,
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
            if creds.get("client_id", "").startswith("PLACEHOLDER"):
                results[pid] = "skipped: placeholder credentials"
                continue
            token_resp = _refresh_token(creds)
            access_token = token_resp.get("access_token")
            if not access_token:
                raise RuntimeError(f"no access_token in refresh response: {token_resp}")
            new_refresh = token_resp.get("refresh_token")
            if new_refresh and new_refresh != creds.get("refresh_token"):
                creds["refresh_token"] = new_refresh
                _put_secret(pid, creds)

            try:
                dashboard = _cb_get("/api/v1.1/getDashboard", access_token)
                _cache_daily_stats(pid, dashboard)
            except Exception as e:
                _record_error(pid, f"dashboard: {e}")

            try:
                reservations = _cb_get("/api/v1.1/getReservations", access_token)
                _cache_reservations(pid, reservations)
            except Exception as e:
                _record_error(pid, f"reservations: {e}")

            results[pid] = "ok"
        except Exception as e:
            traceback.print_exc()
            _record_error(pid, str(e))
            results[pid] = f"error: {e}"
    return {"statusCode": 200, "body": json.dumps(results)}
