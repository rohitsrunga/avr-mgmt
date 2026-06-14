"""Finance reconciliation (Saco Bay only).

Live, on-demand three-stage money trace over a date range, anchored on
**transaction date**, sourced entirely from the Cloudbeds **Data Insights**
API (no QuickBooks, no caching — usage is rare and ranges are arbitrary):

  1. Revenue charged    — what guests were charged in the PMS
  2. Payments received  — what guests actually paid in Cloudbeds
  3. Payments posted    — what the owners received in their bank (payouts)

Why Data Insights and not the v1.3/accounting APIs: the old getTransactions
endpoint is retired, and Cloudbeds Payments payout routes sit behind
interactive SSO. Data Insights *custom* report queries need an Insights
report permission the property key lacks (403), but the **pre-built stock
reports are not gated** — so we drive everything off two stock reports:

  * #174 "Daily Transactions Report by Transaction Type" — per-transaction
    rows grouped by transaction_type, carrying reservation_number,
    primary_guest_full_name, debit/credit and card last-4. Charges (Room
    Rate / Room Revenue / Tax / Adjustment) → stage 1; Payment → stage 2.
    Its real date filter is `service_date`; we neutralise that and activate
    the `transaction_datetime_property_timezone` filter for txn-date anchoring.
  * #226 "Payouts by Transaction Date" — payout rows grouped by
    payout_date / transaction_date / reservation code, with gross
    (total_amount), fee_amount and net_amount (what hits the bank).

We join the two on the reservation confirmation code: a stay drops off the
Outstanding list once a payout's gross accounts for its received payment.
Payout net is post-fee, so reconciliation compares received vs payout
**gross**; net is surfaced as the bank deposit.

Auth: owner/manager only. Property must be Cloudbeds-enabled (Saco Bay).
"""
import copy
import json
import os
import re
import traceback
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import boto3

from shared.auth import MANAGEMENT_ROLES, authorize_property
from shared.response import bad_request, ok, server_error
from shared.router import Router, query_params

_secrets = boto3.client("secretsmanager")
SECRET_PREFIX = os.environ.get("CLOUDBEDS_SECRET_PREFIX", "avr/cloudbeds")

PROPERTIES_WITH_CLOUDBEDS = ["saco_bay"]
DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1"
CB_BASE = "https://api.cloudbeds.com/api/v1.3"

# Stock report ids (stable Cloudbeds catalogue ids).
REPORT_TRANSACTIONS = 174  # Daily Transactions Report by Transaction Type
REPORT_PAYOUTS = 226       # Payouts by Transaction Date

# Cloudbeds transaction_type values that represent a guest payment (stage 2);
# everything else (Room Rate, Room Revenue, Tax, Adjustment, …) is a charge.
PAYMENT_TYPES = {"payment"}

# Treat sub-cent gaps as fully reconciled.
EPS = 0.01

router = Router()


# ---------------------------------------------------------------- helpers
def _now():
    return datetime.now(timezone.utc).isoformat()


def _get_api_key(property_id):
    name = f"{SECRET_PREFIX}/{property_id}"
    resp = _secrets.get_secret_value(SecretId=name)
    creds = json.loads(resp["SecretString"])
    return (creds.get("api_key") or "").strip()


def _headers(api_key, cb_property_id=None):
    h = {
        "Authorization": f"Bearer {api_key}",
        "x-api-key": api_key,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if cb_property_id:
        h["X-PROPERTY-ID"] = str(cb_property_id)
    return h


def _http(url, api_key, cb_property_id=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, headers=_headers(api_key, cb_property_id),
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def _cb_property_id(api_key):
    """Resolve the numeric Cloudbeds property id the key is scoped to.
    The Data Insights API requires it both in the X-PROPERTY-ID header and
    the query body's property_ids."""
    data = (_http(f"{CB_BASE}/getHotels", api_key).get("data")) or []
    if not data:
        raise RuntimeError("getHotels returned no property for this key")
    return str(data[0].get("propertyID") or data[0].get("propertyId"))


def _display(value):
    """Stock-report cells for reservation/guest come back as Cloudbeds
    connect URLs with the human value in a `display=` query param; plain
    values pass through unchanged."""
    if not isinstance(value, str):
        return value
    m = re.search(r"display=([^&]+)", value)
    return urllib.parse.unquote(m.group(1)) if m else value


def _run_stock_report(api_key, cb_pid, report_id, mutate_filters, details):
    """Fetch a stock report's saved definition, deep-copy its filters,
    apply `mutate_filters` (in place), and POST the query. Stock-report
    queries reject filter *columns* not present in the native definition
    and require group_rows/columns to match — so we only mutate values."""
    defn = _http(f"{DI_BASE}/stock_reports/{report_id}", api_key, cb_pid)
    filters = copy.deepcopy(defn.get("filters") or {})
    mutate_filters(filters)
    settings = dict(defn.get("settings") or {})
    settings["details"] = details
    body = {
        "property_ids": [int(cb_pid)],
        "group_rows": defn.get("group_rows") or [],
        "columns": defn.get("columns") or [],
        "settings": settings,
        "filters": filters,
    }
    return _http(
        f"{DI_BASE}/stock_reports/{report_id}/query/data?mode=Run",
        api_key, cb_pid, body,
    )


def _walk_filters(node, fn):
    if isinstance(node, dict):
        for child in node.get("and", []):
            _walk_filters(child, fn)
        for child in node.get("or", []):
            _walk_filters(child, fn)
        if node.get("cdf"):
            fn(node)


def _make_date_mutator(date_field, neutralize, date_from, date_to):
    """Return a mutate fn that turns the first occurrence of `date_field`
    into a >= lower bound, the second into a <= upper bound, and sets every
    `neutralize` column's operator to the no-op `all`."""
    state = {"n": 0}

    def mutate(filters):
        def visit(node):
            col = (node.get("cdf") or {}).get("column")
            if col == date_field:
                state["n"] += 1
                if state["n"] == 1:
                    node["operator"] = "greater_than_or_equal"
                    node["value"] = date_from
                elif state["n"] == 2:
                    node["operator"] = "less_than_or_equal"
                    node["value"] = date_to
            elif col in neutralize:
                node["operator"] = "all"
                node["value"] = ""
        _walk_filters(filters, visit)

    return mutate


# ---------------------------------------------------------------- parsing
def _parse_transactions(resp):
    """#174 → {reservation_code: {guest, charged, received, cards}}."""
    index = resp.get("index") or []
    records = resp.get("records") or {}
    n = len(index)

    def col(name):
        v = records.get(name)
        return v if isinstance(v, list) and len(v) == n else [None] * n

    res_c = col("reservation_number")
    guest_c = col("primary_guest_full_name")
    deb_c = col("debit_amount")
    cre_c = col("credit_amount")
    card_c = col("card_last_4_digits")

    stays = {}
    for i in range(n):
        res = _display(res_c[i])
        if not res or res == "-":
            continue
        ttype = (index[i][0] if index[i] else "") or ""
        debit = float(deb_c[i] or 0)
        credit = float(cre_c[i] or 0)
        s = stays.setdefault(res, {
            "reservation": res, "guest": "", "charged": 0.0,
            "received": 0.0, "cards": set(),
        })
        guest = _display(guest_c[i])
        if guest and guest != "-" and not s["guest"]:
            s["guest"] = guest
        if str(ttype).strip().lower() in PAYMENT_TYPES:
            s["received"] += credit - debit
            card = card_c[i]
            if card and str(card) not in ("-", "None"):
                s["cards"].add(str(card))
        else:
            s["charged"] += debit - credit
    return stays


def _parse_payouts(resp):
    """#226 → {reservation_code: {posted_gross, posted_net, fees,
    payout_date}}. records nests payout_date → transaction_date →
    reservation_code → {metric: {sum}}."""
    records = resp.get("records") or {}
    out = {}
    for payout_date, td_map in records.items():
        if not isinstance(td_map, dict):
            continue
        for _txn_date, res_map in td_map.items():
            if not isinstance(res_map, dict):
                continue
            for res_code, metrics in res_map.items():
                if not res_code or res_code == "-" or not isinstance(metrics, dict):
                    continue

                def _sum(key):
                    return float(((metrics.get(key) or {}).get("sum")) or 0)

                p = out.setdefault(res_code, {
                    "posted_gross": 0.0, "posted_net": 0.0,
                    "fees": 0.0, "payout_date": "",
                })
                p["posted_gross"] += _sum("total_amount")
                p["posted_net"] += _sum("net_amount")
                p["fees"] += _sum("fee_amount")
                if payout_date and payout_date != "-" and payout_date > p["payout_date"]:
                    p["payout_date"] = payout_date
    return out


def _round2(x):
    return round(float(x or 0) + 0.0, 2)


def _reconcile(txns, payouts):
    stays = []
    totals = {"charged": 0.0, "received": 0.0, "posted_gross": 0.0,
              "posted_net": 0.0, "fees": 0.0, "outstanding": 0.0}
    for res, t in txns.items():
        p = payouts.get(res, {})
        received = t["received"]
        posted_gross = p.get("posted_gross", 0.0)
        outstanding = max(0.0, received - posted_gross)
        reconciled = received > EPS and posted_gross + EPS >= received
        stays.append({
            "reservation": res,
            "guest": t["guest"] or "—",
            "cards": sorted(t["cards"]),
            "charged": _round2(t["charged"]),
            "received": _round2(received),
            "posted_gross": _round2(posted_gross),
            "posted_net": _round2(p.get("posted_net", 0.0)),
            "fees": _round2(p.get("fees", 0.0)),
            "outstanding": _round2(outstanding),
            "payout_date": p.get("payout_date", ""),
            "reconciled": bool(reconciled),
        })
        totals["charged"] += t["charged"]
        totals["received"] += received
        totals["posted_gross"] += posted_gross
        totals["posted_net"] += p.get("posted_net", 0.0)
        totals["fees"] += p.get("fees", 0.0)
        totals["outstanding"] += outstanding

    # Payouts whose reservation never appeared in the transactions pull
    # (e.g. payment recorded outside the range) — surface for review.
    exceptions = []
    for res, p in payouts.items():
        if res not in txns:
            exceptions.append({
                "reservation": res,
                "posted_gross": _round2(p.get("posted_gross", 0.0)),
                "posted_net": _round2(p.get("posted_net", 0.0)),
                "payout_date": p.get("payout_date", ""),
            })
            totals["posted_gross"] += p.get("posted_gross", 0.0)
            totals["posted_net"] += p.get("posted_net", 0.0)
            totals["fees"] += p.get("fees", 0.0)

    # Outstanding first (largest gap on top), then reconciled by recency.
    stays.sort(key=lambda s: (s["reconciled"], -s["outstanding"], -s["received"]))
    totals = {k: _round2(v) for k, v in totals.items()}
    return stays, exceptions, totals


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _default_range():
    today = datetime.now(timezone.utc).date()
    return (today - timedelta(days=30)).isoformat(), today.isoformat()


# ---------------------------------------------------------------- route
@router.get("/api/finance/{property_id}/reconciliation")
def reconciliation(event, params):
    pid = params["property_id"]
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err

    q = query_params(event)
    d_from, d_to = _default_range()
    d_from = q.get("from") or d_from
    d_to = q.get("to") or d_to
    if not _DATE_RE.match(d_from) or not _DATE_RE.match(d_to):
        return bad_request("from/to must be YYYY-MM-DD")
    if d_from > d_to:
        return bad_request("from must be on or before to")

    if pid not in PROPERTIES_WITH_CLOUDBEDS:
        return ok({
            "property_id": pid, "from": d_from, "to": d_to,
            "enabled": False, "stays": [], "exceptions": [],
            "totals": {}, "synced_at": _now(),
        })

    api_key = _get_api_key(pid)
    if not api_key or api_key.startswith("PLACEHOLDER"):
        return ok({
            "property_id": pid, "from": d_from, "to": d_to,
            "enabled": False, "stays": [], "exceptions": [], "totals": {},
            "error": "Cloudbeds key not configured", "synced_at": _now(),
        })

    cb_pid = _cb_property_id(api_key)

    txn_resp = _run_stock_report(
        api_key, cb_pid, REPORT_TRANSACTIONS,
        _make_date_mutator(
            "transaction_datetime_property_timezone",
            {"service_date"}, d_from, d_to,
        ),
        details=True,
    )
    payout_resp = _run_stock_report(
        api_key, cb_pid, REPORT_PAYOUTS,
        _make_date_mutator("transaction_date", {"payout_date"}, d_from, d_to),
        details=False,
    )

    txns = _parse_transactions(txn_resp)
    payouts = _parse_payouts(payout_resp)
    stays, exceptions, totals = _reconcile(txns, payouts)

    return ok({
        "property_id": pid,
        "from": d_from,
        "to": d_to,
        "enabled": True,
        "currency": "USD",
        "totals": totals,
        "stays": stays,
        "exceptions": exceptions,
        "synced_at": _now(),
    })


def handler(event, context):
    try:
        return router.dispatch(event)
    except urllib.error.HTTPError as e:
        traceback.print_exc()
        return server_error(f"Cloudbeds API error {e.code}: {e.read().decode()[:200]}")
    except Exception as e:
        traceback.print_exc()
        return server_error(str(e))
