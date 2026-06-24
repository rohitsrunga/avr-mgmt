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
    primary_guest_full_name, debit/credit and stay dates. Charges (Room
    Rate / Room Revenue / Tax / Adjustment) → stage 1; Payment → stage 2.
    We anchor on **checkout date** (neutralising the report's service_date /
    transaction_datetime / checkin_date filters) so each reservation's FULL
    folio + payments land in the window its stay completed in. That makes
    charged ≈ received for paid stays, so a gap is a *real* balance due
    rather than a timing artifact of lump-sum payments vs per-night charges.
  * #226 "Payouts by Transaction Date" — payout rows grouped by
    payout_date / transaction_date / reservation code, with gross
    (total_amount), fee_amount and net_amount (what hits the bank). Payouts
    lag the stay and a stay's payments post before checkout, so we pull this
    over a padded transaction-date window and keep only payouts whose
    reservation is in the checkout-anchored set.

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
from datetime import date, datetime, timedelta, timezone

import boto3

from shared.auth import MANAGEMENT_ROLES, authorize_property, get_identity
from shared.dynamo import query_pk, table, to_dynamo
from shared.response import bad_request, forbidden, ok, server_error
from shared.router import Router, parse_body, query_params
from shared.settings import VALID_PROPERTIES, is_feature_enabled
from shared import payment_calendar, usali

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

# Payouts lag the stay, and a stay's payments can post well before checkout
# (deposits at booking) or shortly after, so we pull the payout report over a
# padded transaction-date window around the selected checkout range and keep
# only payouts belonging to the stays we selected.
PAYOUT_LOOKBACK_DAYS = 180
PAYOUT_LOOKAHEAD_DAYS = 45

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
    ci_c = col("checkin_date")
    co_c = col("checkout_date")

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
            "received": 0.0, "cards": set(), "checkin": "", "checkout": "",
        })
        guest = _display(guest_c[i])
        if guest and guest != "-" and not s["guest"]:
            s["guest"] = guest
        for key, src in (("checkin", ci_c), ("checkout", co_c)):
            if not s[key]:
                val = _display(src[i])
                if val and val != "-":
                    s[key] = val
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


def _parse_payouts_by_day(resp):
    """#226 → {payout_date: {posted_gross, posted_net, fees, count}}.

    Aggregated by **payout (bank-deposit) date** across every transaction and
    reservation in the report — independent of the checkout-anchored
    reconciliation set. This ties out to the actual bank statement: each entry
    is the money that landed in the bank on that date, regardless of when the
    underlying stays checked out."""
    records = resp.get("records") or {}
    out = {}
    for payout_date, td_map in records.items():
        if not payout_date or payout_date == "-" or not isinstance(td_map, dict):
            continue
        day = out.setdefault(payout_date, {
            "date": payout_date, "posted_gross": 0.0,
            "posted_net": 0.0, "fees": 0.0, "count": 0,
        })
        for _txn_date, res_map in td_map.items():
            if not isinstance(res_map, dict):
                continue
            for res_code, metrics in res_map.items():
                if not res_code or res_code == "-" or not isinstance(metrics, dict):
                    continue

                def _sum(key):
                    return float(((metrics.get(key) or {}).get("sum")) or 0)

                day["posted_gross"] += _sum("total_amount")
                day["posted_net"] += _sum("net_amount")
                day["fees"] += _sum("fee_amount")
                day["count"] += 1
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
            "checkin": t.get("checkin", ""),
            "checkout": t.get("checkout", ""),
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

    # Stage 1+2: anchor each reservation's full folio on its checkout date.
    txn_resp = _run_stock_report(
        api_key, cb_pid, REPORT_TRANSACTIONS,
        _make_date_mutator(
            "checkout_date",
            {"service_date", "transaction_datetime_property_timezone", "checkin_date"},
            d_from, d_to,
        ),
        details=True,
    )
    txns = _parse_transactions(txn_resp)

    # Stage 3: pull payouts over a padded transaction-date window so a stay's
    # earlier/later-posting payments are captured, then keep only payouts for
    # the stays selected above.
    pay_from = (datetime.fromisoformat(d_from).date() - timedelta(days=PAYOUT_LOOKBACK_DAYS)).isoformat()
    pay_to = (datetime.fromisoformat(d_to).date() + timedelta(days=PAYOUT_LOOKAHEAD_DAYS)).isoformat()
    payout_resp = _run_stock_report(
        api_key, cb_pid, REPORT_PAYOUTS,
        _make_date_mutator("transaction_date", {"payout_date"}, pay_from, pay_to),
        details=False,
    )
    payouts = {r: p for r, p in _parse_payouts(payout_resp).items() if r in txns}

    stays, exceptions, totals = _reconcile(txns, payouts)

    # Bank posts by day: actual payouts whose PAYOUT (bank-deposit) date falls
    # in the filtered range, summed across all reservations — independent of the
    # checkout-anchored reconciliation above, so the summary table ties out to
    # the bank statement. The payout pull already spans a wide transaction-date
    # window, which captures every payout depositing within [d_from, d_to].
    bank_posts = [
        {
            "date": d["date"],
            "count": d["count"],
            "posted_gross": _round2(d["posted_gross"]),
            "posted_net": _round2(d["posted_net"]),
            "fees": _round2(d["fees"]),
        }
        for pd, d in _parse_payouts_by_day(payout_resp).items()
        if d_from <= pd <= d_to
    ]
    bank_posts.sort(key=lambda r: r["date"], reverse=True)

    return ok({
        "property_id": pid,
        "from": d_from,
        "to": d_to,
        "enabled": True,
        "currency": "USD",
        "totals": totals,
        "stays": stays,
        "exceptions": exceptions,
        "bank_posts": bank_posts,
        "synced_at": _now(),
    })


# ================================================================
# USALI P&L / Budget / Forecast (both properties, owner/manager).
# Actuals are ingested from QuickBooks by scripts/qb_ingest_pnl.py;
# budgets + forecast assumptions are entered here. Gated by the
# `finance_pnl` per-property feature flag.
# ================================================================
FINANCE_FEATURE = "finance_pnl"
_YEAR_RE = re.compile(r"^\d{4}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _fin_tbl():
    return table("TABLE_FINANCE")


def _pk(pid):
    return f"PROPERTY#{pid}"


def _check_pnl(event, pid):
    """Property scope (owner/manager) + finance_pnl feature gate."""
    if pid not in VALID_PROPERTIES:
        return bad_request(f"unknown property: {pid}")
    err = authorize_property(event, pid, MANAGEMENT_ROLES)
    if err:
        return err
    if not is_feature_enabled(pid, FINANCE_FEATURE):
        return forbidden("P&L is disabled for this property")
    return None


def _year_of(event, default=None):
    q = query_params(event)
    y = q.get("year")
    if y and _YEAR_RE.match(y):
        return int(y)
    return default or datetime.now(timezone.utc).year


def _monthly_by_prefix(pid, prefix):
    """{'YYYY-MM': item} for ACTUAL#/BUDGET# rows under a property."""
    out = {}
    for item in query_pk(_fin_tbl(), _pk(pid), prefix):
        sk = item.get("SK", "")
        parts = sk.split("#", 1)
        if len(parts) == 2 and _MONTH_RE.match(parts[1]):
            out[parts[1]] = item
    return out


def _bucket(item):
    """Normalise a stored monthly item into the shape usali helpers expect."""
    return {
        "lines": item.get("lines") or {},
        "room_revenue": item.get("room_revenue", 0),
        "other_revenue": item.get("other_revenue", 0),
    }


@router.get("/api/finance/{property_id}/pnl")
def pnl(event, params):
    pid = params["property_id"]
    err = _check_pnl(event, pid)
    if err:
        return err
    year = _year_of(event)

    actual_items = _monthly_by_prefix(pid, "ACTUAL#")
    actuals_all = {m: _bucket(it) for m, it in actual_items.items()}
    budgets_all = {m: _bucket(it) for m, it in _monthly_by_prefix(pid, "BUDGET#").items()}
    assum_item = _fin_tbl().get_item(
        Key={"PK": _pk(pid), "SK": f"ASSUMPTIONS#{year}"}
    ).get("Item")
    assumptions = {k: v for k, v in (assum_item or {}).items() if k not in ("PK", "SK")}

    forecast_all = usali.compute_forecast(assumptions, actuals_all, year)
    forecast_basis = forecast_all.pop("_forecast_basis", "")
    yoy_factor = forecast_all.pop("_yoy_factor", None)

    month_list = [f"{year}-{m:02d}" for m in range(1, 13)]

    def waterfall_for(source):
        b = source or {"lines": {}, "room_revenue": 0, "other_revenue": 0}
        return usali.build_waterfall(
            b.get("lines") or {},
            {"room": b.get("room_revenue", 0), "other": b.get("other_revenue", 0)},
        )

    prior_months = [f"{year - 1}-{m:02d}" for m in range(1, 13)]
    act_s = [waterfall_for(actuals_all.get(m)) for m in month_list]
    bud_s = [waterfall_for(budgets_all.get(m)) for m in month_list]
    fc_s = [waterfall_for(forecast_all.get(m)) for m in month_list]
    pri_s = [waterfall_for(actuals_all.get(m)) for m in prior_months]

    def amt(series, mi, ri):
        v = series[mi][ri]["amount"]
        return None if v is None else _round2(v)

    rows = []
    scaffold = act_s[0]  # row order is identical across months/series
    for ri, base in enumerate(scaffold):
        row = {"kind": base["kind"], "label": base["label"], "level": base["level"]}
        if base.get("dept"):
            row["dept"] = base["dept"]
        if base.get("driver"):
            row["driver"] = base["driver"]
        actual = [amt(act_s, mi, ri) for mi in range(12)]
        budget = [amt(bud_s, mi, ri) for mi in range(12)]
        forecast = [amt(fc_s, mi, ri) for mi in range(12)]
        prior = [amt(pri_s, mi, ri) for mi in range(12)]
        variance = [
            _round2(actual[i] - budget[i])
            if actual[i] is not None and budget[i] is not None else None
            for i in range(12)
        ]
        row.update(actual=actual, budget=budget, forecast=forecast, prior=prior, variance=variance)
        rows.append(row)

    # Third drill-down: {account_key: {name: [12 monthly amounts]}} for this
    # year, assembled from the stored (already >=$1K) name detail.
    name_detail = {}
    for mi, ym in enumerate(month_list):
        names = ((actual_items.get(ym) or {}).get("names")) or {}
        for key, nmap in names.items():
            for nm, val in nmap.items():
                arr = name_detail.setdefault(key, {}).setdefault(nm, [None] * 12)
                arr[mi] = _round2(float(val))

    # Cash in Bank — month-end bank balances, forecast rolled forward from the
    # last actual balance by (EBITDA − estimated income tax) per month.
    # An owner-entered CASH_OVERRIDE#<YYYY-MM> {account: balance} takes priority
    # over the QB book balance (QB's API only exposes the *book* balance, which
    # diverges when bank-feed deposits are recorded late).
    tax_rate = float(assumptions.get("income_tax_rate", 25) or 0)
    ebitda_idx = next((ri for ri, b in enumerate(scaffold)
                       if b["kind"] == "subtotal" and b["label"] == "EBITDA"), None)

    override_items = _monthly_by_prefix(pid, "CASH_OVERRIDE#")
    overrides_by_month = {
        m: {k: float(v) for k, v in (it.get("accounts") or {}).items()}
        for m, it in override_items.items()
    }

    def book_cash(month):
        return {k: float(v) for k, v in ((actual_items.get(month) or {}).get("cash") or {}).items()}

    def eff_cash(month):
        """Effective per-account balances: override wins, else QB book."""
        book, ov = book_cash(month), overrides_by_month.get(month) or {}
        return {n: (ov[n] if n in ov else book[n]) for n in set(book) | set(ov)}

    def has_cash(month):
        return bool(book_cash(month)) or bool(overrides_by_month.get(month))

    def eff_total(month):
        return sum(eff_cash(month).values()) if has_cash(month) else None

    cash_months = sorted(m for m in (set(actual_items) | set(overrides_by_month)) if has_cash(m))
    cash_actual = [eff_total(m) for m in month_list]
    cash_prior = [eff_total(m) for m in prior_months]

    # Per-account month-end balances for the drill-down (effective + raw book).
    # Include EVERY bank account ever seen (any year) or overridden, so a month
    # with missing data still shows an (editable) row rather than vanishing.
    all_names = sorted(
        {n for it in actual_items.values() for n in (it.get("cash") or {})}
        | {n for ov in overrides_by_month.values() for n in ov}
    )
    cash_accounts = {n: [None] * 12 for n in all_names}
    book_accounts = {n: [None] * 12 for n in all_names}
    for mi, ym in enumerate(month_list):
        e, b = eff_cash(ym), book_cash(ym)
        for n in all_names:
            if n in e:
                cash_accounts[n][mi] = _round2(e[n])
            if n in b:
                book_accounts[n][mi] = _round2(b[n])

    def seed_before(ym):
        prior_cash = [m for m in cash_months if m < ym]
        return eff_total(prior_cash[-1]) if prior_cash else None

    cash_series = [None] * 12
    running = None
    for mi, ym in enumerate(month_list):
        if cash_actual[mi] is not None:
            running = cash_actual[mi]
            cash_series[mi] = _round2(cash_actual[mi])
        else:
            if running is None:
                running = seed_before(ym)
            base = running or 0.0
            eb = fc_s[mi][ebitda_idx]["amount"] if ebitda_idx is not None else 0.0
            eb = float(eb or 0.0)
            net = eb - max(0.0, eb) * tax_rate / 100.0
            running = base + net
            cash_series[mi] = _round2(running)

    cash = {
        "total": cash_series,
        "prior": cash_prior,
        "accounts": cash_accounts,
        "book": book_accounts,
        "overrides": {m: overrides_by_month[m] for m in month_list if m in overrides_by_month},
        "actual_months": [m for m in month_list if has_cash(m)],
        "tax_rate": tax_rate,
    }

    pulled = [it.get("pulled_at") for it in actual_items.values() if it.get("pulled_at")]
    return ok({
        "property_id": pid,
        "year": year,
        "months": month_list,
        "rows": rows,
        "name_detail": name_detail,
        "cash": cash,
        "assumptions": assumptions,
        "has_assumptions": bool(assum_item),
        "forecast_basis": forecast_basis,
        "yoy_factor": yoy_factor,
        "prior_year_months": sorted(m for m in actuals_all if m.startswith(str(year - 1))),
        "actual_months": sorted(m for m in actuals_all if m.startswith(str(year))),
        "synced_at": max(pulled) if pulled else None,
    })


@router.get("/api/finance/{property_id}/budget")
def get_budget(event, params):
    pid = params["property_id"]
    err = _check_pnl(event, pid)
    if err:
        return err
    year = _year_of(event)
    budgets = {
        m: _bucket(it) for m, it in _monthly_by_prefix(pid, "BUDGET#").items()
        if m.startswith(str(year))
    }
    return ok({"property_id": pid, "year": year, "budget": budgets})


@router.put("/api/finance/{property_id}/budget")
def put_budget(event, params):
    pid = params["property_id"]
    err = _check_pnl(event, pid)
    if err:
        return err
    body = parse_body(event)
    month = (body.get("month") or "").strip()
    if not _MONTH_RE.match(month):
        return bad_request("month must be YYYY-MM")
    lines = body.get("lines") or {}
    if not isinstance(lines, dict):
        return bad_request("lines must be an object")
    # Keep only known account keys; coerce to numbers.
    clean = {}
    for k, v in lines.items():
        if k in usali.ACCOUNT_KEYS:
            try:
                clean[k] = float(v)
            except (TypeError, ValueError):
                return bad_request(f"non-numeric budget for {k}")
    item = {
        "PK": _pk(pid),
        "SK": f"BUDGET#{month}",
        "lines": clean,
        "room_revenue": float(body.get("room_revenue") or 0),
        "other_revenue": float(body.get("other_revenue") or 0),
        "updated_at": _now(),
        "updated_by": get_identity(event).get("email", ""),
    }
    _fin_tbl().put_item(Item=to_dynamo(item))
    return ok({"saved": True, "month": month, "budget": _bucket(item)})


@router.get("/api/finance/{property_id}/assumptions")
def get_assumptions(event, params):
    pid = params["property_id"]
    err = _check_pnl(event, pid)
    if err:
        return err
    year = _year_of(event)
    item = _fin_tbl().get_item(
        Key={"PK": _pk(pid), "SK": f"ASSUMPTIONS#{year}"}
    ).get("Item")
    assumptions = {k: v for k, v in (item or {}).items() if k not in ("PK", "SK")}
    return ok({"property_id": pid, "year": year, "assumptions": assumptions or None})


@router.put("/api/finance/{property_id}/assumptions")
def put_assumptions(event, params):
    pid = params["property_id"]
    err = _check_pnl(event, pid)
    if err:
        return err
    year = _year_of(event)
    body = parse_body(event)

    item = {
        "PK": _pk(pid),
        "SK": f"ASSUMPTIONS#{year}",
        "updated_at": _now(),
        "updated_by": get_identity(event).get("email", ""),
    }
    # Optional manual Y/Y growth override (percent). Blank/absent clears it
    # (the put replaces the whole item), so the computed YTD trend resumes.
    ov = body.get("yoy_override")
    if ov not in (None, ""):
        try:
            item["yoy_override"] = float(ov)
        except (TypeError, ValueError):
            return bad_request("yoy_override must be a number (percent)")

    tr = body.get("income_tax_rate")
    if tr not in (None, ""):
        try:
            item["income_tax_rate"] = float(tr)
        except (TypeError, ValueError):
            return bad_request("income_tax_rate must be a number (percent)")

    _fin_tbl().put_item(Item=to_dynamo(item))
    stored = {k: v for k, v in item.items() if k not in ("PK", "SK")}
    return ok({"saved": True, "year": year, "assumptions": stored})


@router.put("/api/finance/{property_id}/cash-override")
def put_cash_override(event, params):
    """Owner-entered actual month-end bank balances that override the QB book
    balance for that month. Body: {month: 'YYYY-MM', accounts: {name: balance}}.
    Blank/absent accounts are dropped; an empty set removes the override."""
    pid = params["property_id"]
    err = _check_pnl(event, pid)
    if err:
        return err
    body = parse_body(event)
    month = (body.get("month") or "").strip()
    if not _MONTH_RE.match(month):
        return bad_request("month must be YYYY-MM")
    accounts_in = body.get("accounts")
    if not isinstance(accounts_in, dict):
        return bad_request("accounts must be an object")
    clean = {}
    for name, val in accounts_in.items():
        if val in (None, ""):
            continue
        try:
            clean[str(name)] = float(val)
        except (TypeError, ValueError):
            return bad_request(f"non-numeric balance for {name}")
    key = {"PK": _pk(pid), "SK": f"CASH_OVERRIDE#{month}"}
    if clean:
        _fin_tbl().put_item(Item=to_dynamo({
            **key, "accounts": clean,
            "updated_at": _now(), "updated_by": get_identity(event).get("email", ""),
        }))
    else:
        _fin_tbl().delete_item(Key=key)  # all cleared → drop the override
    return ok({"saved": True, "month": month, "accounts": clean})


# ================================================================
# Payment / obligations calendar (weekly payables matrix).
# Vendor obligation records + daily payment history are ingested from
# QuickBooks by scripts/qb_ingest_payments.py (PAYOBLIG#<line>#<vendor> rows);
# this route does the horizon-dependent week math + nesting. Owner/manager,
# gated by the same finance_pnl flag as the P&L. Supports an "all_hotels"
# property scope that nests both hotels under each vendor.
# ================================================================
ALL_HOTELS = "all_hotels"
HOTEL_NAMES = {"casco_bay": "Casco Bay", "saco_bay": "Saco Bay"}
_DEFAULT_PC_MONTHS = 6


def _payoblig_records(pid, hotel_name):
    """Obligation records under a property, tagged with the display hotel name."""
    out = []
    for item in query_pk(_fin_tbl(), _pk(pid), "PAYOBLIG#"):
        rec = {k: v for k, v in item.items() if k not in ("PK", "SK")}
        rec["hotel"] = hotel_name
        out.append(rec)
    return out


@router.get("/api/finance/{property_id}/payment-calendar")
def payment_calendar_route(event, params):
    pid = params["property_id"]
    if pid == ALL_HOTELS:
        # Both hotels merged. Owner/manager only; both must have the flag on.
        err = authorize_property(event, "casco_bay", MANAGEMENT_ROLES)
        if err:
            return err
        if not all(is_feature_enabled(p, FINANCE_FEATURE) for p in VALID_PROPERTIES):
            return forbidden("Payment calendar is disabled for a property")
        scopes = list(VALID_PROPERTIES)
    else:
        err = _check_pnl(event, pid)
        if err:
            return err
        scopes = [pid]

    q = query_params(event)
    months = q.get("months")
    try:
        n_months = int(months) if months else _DEFAULT_PC_MONTHS
    except (TypeError, ValueError):
        return bad_request("months must be an integer")
    n_months = max(1, min(18, n_months))

    today = datetime.now(timezone.utc).date()
    start_q = q.get("start")
    if start_q:
        if not _MONTH_RE.match(start_q):
            return bad_request("start must be YYYY-MM")
        sy, sm = map(int, start_q.split("-"))
    else:
        sy, sm = today.year, today.month
    start = date(sy, sm, 1)

    records = []
    for p in scopes:
        records += _payoblig_records(p, HOTEL_NAMES.get(p, p))

    data = payment_calendar.build_calendar(records, start, n_months, today=today)
    pulled = [r.get("pulled_at") for r in records if r.get("pulled_at")]
    return ok({
        "property_id": pid,
        "scope": "all_hotels" if pid == ALL_HOTELS else pid,
        "start": start.strftime("%Y-%m"),
        "months": n_months,
        **data,
        "synced_at": max(pulled) if pulled else None,
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
