"""One-shot migration: pull linen counts out of the soon-to-be-deleted linen table
and re-create them as items in the `linen` inventory category.

Usage:
    python3 scripts/migrate_linen_to_inventory.py --stack avr-mgmt --region us-east-1
    python3 scripts/migrate_linen_to_inventory.py --stack avr-mgmt --dry-run

The current_stock value for each linen type is taken from the most recent weekly
count we can find (across all months). par_level is set to 0 so the manager
re-fills it via the UI.

Run this BEFORE `sam deploy` removes the old linen table. After the migration
succeeds, redeploy to drop the linen DynamoDB resource.
"""
import argparse
import sys
from datetime import datetime, timezone

import boto3


LINEN_CATEGORY = "linen"
PROPERTIES = ["casco_bay", "saco_bay"]


def stack_outputs(cfn, stack):
    resp = cfn.describe_stacks(StackName=stack)
    return {o["OutputKey"]: o["OutputValue"] for o in resp["Stacks"][0].get("Outputs", [])}


def scan_linen(linen_tbl, property_id):
    """Return {linen_type: (latest_month_week_tuple, count)}."""
    latest = {}
    paginator = boto3.client("dynamodb").get_paginator("scan")
    # Use the resource-level scan for simplicity, paginated manually:
    last_key = None
    while True:
        kwargs = {}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = linen_tbl.scan(**kwargs)
        for it in resp.get("Items", []):
            pk = it.get("PK", "")
            if not pk.startswith(f"PROPERTY#{property_id}#MONTH#"):
                continue
            month = pk.rsplit("#", 1)[-1]
            linen_type = it.get("linen_type", "")
            week = int(it.get("week", 0))
            count = int(it.get("count", 0))
            if not linen_type:
                continue
            key = (month, week)
            existing = latest.get(linen_type)
            if existing is None or key > existing[0]:
                latest[linen_type] = (key, count)
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
    return latest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", default="avr-mgmt")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    boto3.setup_default_session(region_name=args.region)
    cfn = boto3.client("cloudformation")
    dynamodb = boto3.resource("dynamodb")

    outs = stack_outputs(cfn, args.stack)
    # We rely on the table-naming convention (StackPrefix-linen / -inventory)
    # because Outputs no longer expose linen.
    prefix = args.stack.replace("-mgmt", "")  # crude — fine for default deploys
    # Better: derive from the inventory table name which IS in env vars on the
    # inventory Lambda. But for a one-shot script we just check common prefixes.
    candidates = [
        f"{prefix}-mgmt-linen", f"{prefix}-linen", "avr-linen",
    ]
    linen_tbl_name = None
    for name in candidates:
        try:
            dynamodb.Table(name).load()
            linen_tbl_name = name
            break
        except Exception:
            continue
    if not linen_tbl_name:
        print("Could not find linen table. If it was already deleted, you're done.")
        sys.exit(0)
    inventory_tbl_name = linen_tbl_name.replace("-linen", "-inventory")

    linen_tbl = dynamodb.Table(linen_tbl_name)
    inventory_tbl = dynamodb.Table(inventory_tbl_name)
    print(f"Source: {linen_tbl_name}")
    print(f"Target: {inventory_tbl_name}")
    print()

    now = datetime.now(timezone.utc).isoformat()
    total_written = 0
    for pid in PROPERTIES:
        latest = scan_linen(linen_tbl, pid)
        print(f"[{pid}] {len(latest)} linen types found")
        for linen_type, ((month, week), count) in sorted(latest.items()):
            item_id = linen_type.lower().replace(" ", "_")
            item = {
                "PK": f"PROPERTY#{pid}",
                "SK": f"CATEGORY#{LINEN_CATEGORY}#ITEM#{item_id}",
                "item_id": item_id,
                "item_name": linen_type,
                "category": LINEN_CATEGORY,
                "current_stock": count,
                "par_level": 0,
                "unit": "each",
                "reorder_threshold_pct": 30,
                "last_updated": now,
                "updated_by": "migration:linen",
            }
            print(f"  {linen_type}: stock={count} (from {month} wk{week})")
            if not args.dry_run:
                inventory_tbl.put_item(Item=item)
                total_written += 1
        print()

    if args.dry_run:
        print("Dry run complete. Re-run without --dry-run to write.")
    else:
        print(f"Wrote {total_written} items to {inventory_tbl_name}.")
        print("Now run `sam deploy` to remove the old linen table.")


if __name__ == "__main__":
    main()
