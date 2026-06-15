"""Seed DynamoDB with master shift tasks, checklists, inventory items, and rooms.

Usage:
    python3 scripts/seed_data.py --stack avr-mgmt --region us-east-1
    python3 scripts/seed_data.py --stack avr-mgmt --properties casco_bay
    python3 scripts/seed_data.py --stack avr-mgmt --reset    # delete + reseed
"""
import argparse
import sys
from decimal import Decimal
from urllib.parse import quote_plus

import boto3
from boto3.dynamodb.conditions import Key


# ============================================================
# Master shift tasks (transcribed from operational meeting notes)
# ============================================================

SHIFT_TASKS = {
    "1st": [
        ("Opening", [
            "Clock in",
            "Cash count",
            "Check messages from previous shift, triage",
        ]),
        ("Grounds", [
            "Empty interior + exterior trash; water flowers",
            "Walk perimeter — pick up litter, check landscaping",
            "Sweep front walkway; inspect dumpster + meter",
            "Walk floors — clear door trash, return luggage carts",
        ]),
        ("Breakfast", [
            "Refill breakfast items",
            "Breakfast cleanup: leftovers, wipe counters, put away stuff",
            "Sweep + mop breakfast area, kitchen, and lobby",
            "Clean public bathrooms (toilets, urinals, replenish supplies)",
            "Wash breakfast supplies; reset coffee for next service",
        ]),
        ("Front Desk", [
            "Handle checkouts (account posting)",
            "CAN the room (after 11:00 AM)",
            "Coordinate with housekeeping for opening rooms",
            "Update departures",
            "Coordinate with housekeeping/maintenance on checkout reviews",
        ]),
        ("Housekeeping Coordination", [
            "11:00 AM - 3:00 PM: Housekeeping cleans rooms",
            "Assign rooms to housekeepers (manager)",
        ]),
        ("Check-in", [
            "Check in guests",
            "Busy times: check with housekeeping on clean rooms, update availability",
        ]),
        ("Inventory", [
            "Document breakfast inventory remaining (bananas, croissants, etc.)",
        ]),
        ("Marketing & Sales", [
            "Madalia online booking reviews",
            "Reply to all reviews",
            "Leisure outreach",
            "Transient outreach calls",
            "Cvent RFP",
            "Business cases",
        ]),
        ("MEPS", [
            "Coordinate with housekeeping on MEPS room assignments",
            "MEPS rooms done by 2 PM max (1 PM target)",
            "Make keys for MEPS rooms, give keys + brochures to liaison",
        ]),
        ("Handoff", [
            "Dinner prep begins (transition to 2nd shift)",
        ]),
    ],
    "2nd": [
        ("Dinner Prep", [
            "Ninja Air Fryer: chicken tenders (read bag for instructions)",
            "Other toaster oven/air fryer (black): veggie patty, beef patty",
            "Assemble burgers: lettuce, cheese, half-wrap in foil",
            "Cook hot dogs and assemble (half-wrap in foil)",
            "Microwave Mac & cheese: 7 min, stir, 5 min",
            "Air fry veggies",
            "Air fry tater tots in lobby air fryer",
            "Pour salad into bowl",
            "Salad toppings: cut onion, tomatoes, pickles",
            "Move water bottles + soda to fridge in lobby (by # of MEPS)",
            "Set up fruit + cookies (under cabinet)",
            "Bring yogurt from fridge",
        ]),
        ("Closing", [
            "10 PM: Clean up / wrap up dinner",
            "Print emergency reports: arrivals, in-house, vacant rooms, credit checks",
        ]),
    ],
    "3rd": [
        ("Night", [
            "Finish dinner clean up if pending",
            "Print leftover arrivals registration cards (~midnight)",
            "Charge virtual cards (~2 AM)",
            "3 AM: Night audit (day rolls over automatically)",
            "Print departures, cross off as guests check out",
        ]),
        ("Breakfast Prep", [
            "MEPS breakfast prep: start at 3:00 AM (includes boiled eggs)",
            "Non-MEPS breakfast prep: start at 5:00 AM",
        ]),
        ("Office", [
            "Office inventory check (supplies)",
        ]),
    ],
}


# ============================================================
# Inventory catalog
# ============================================================
# Breakfast + cleaning categories are the real products AVR buys at Sam's Club,
# transcribed from ~6 months of Scarborough, ME receipts. The receipt item
# numbers (`sku`) are kept for reference but are NOT the website's product IDs,
# so each item also carries a resolved Sam's Club product-page `url` (confirmed
# by name/SKU lookup). Items without a confident single product page omit `url`
# and seed_inventory falls back to a https://www.samsclub.com/search?q=<name>
# search link. Either way a low-stock item is one click from reordering.

INVENTORY_CATALOG = {
    "breakfast_food": [
        {"name": "Hostess Danish Claw Variety Pack (24 ct.)", "sku": "990002385", "unit": "pack", "par": 4,
         "url": "https://www.samsclub.com/p/hostess-danish-claw-variety-pack-24ct/P03001740"},
        {"name": "Uncle Wally's Muffins, Choc Chip & Blueberry (20 pk.)", "sku": "990012815", "unit": "pack", "par": 4,
         "url": "https://www.samsclub.com/p/uncle-wallys-assorted-twin-pack-chocolate-chip-blueberry-muffins/P03007439"},
        # 30CTVRTYMIX / 30CT VP — receipt abbreviations couldn't be pinned to one
        # product page; left to name-search so they land on the bakery results.
        {"name": "Breakfast Muffin Variety Pack (30 ct.)", "sku": "990511770", "unit": "pack", "par": 3},
        {"name": "Breakfast Pastry Variety Pack (30 ct.)", "sku": "980272280", "unit": "pack", "par": 3},
        {"name": "Member's Mark All Butter Sandwich Croissants (12 ct.)", "sku": "859370", "unit": "pack", "par": 6,
         "url": "https://www.samsclub.com/p/members-mark-butter-sandwich-croissant-12-ct/prod9300349"},
        {"name": "Member's Mark Chocolate Croissants (12 ct.)", "sku": "984304911", "unit": "pack", "par": 4,
         "url": "https://www.samsclub.com/p/members-mark-chocolate-croissants/19625258089"},
        {"name": "English Muffins", "sku": "701786", "unit": "pack", "par": 6},
        {"name": "Duchess Honey Buns (3 oz., 12 pk.)", "sku": "980328069", "unit": "pack", "par": 4,
         "url": "https://www.samsclub.com/p/duchess-honey-buns-3oz-12pk/163882"},
        {"name": "Member's Mark Cinnamon Butter Coffee Cake (22 oz.)", "sku": "980218790", "unit": "each", "par": 3,
         "url": "https://www.samsclub.com/p/members-mark-cinnamon-butter-coffee-cake/prod22500576"},
        {"name": "Member's Mark Mini Candy Cookies (36 ct.)", "sku": "102193", "unit": "pack", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-mini-candy-cookies-34-ct/prod13450302"},
        {"name": "Bimbo White Bread", "sku": "66392", "unit": "loaf", "par": 4},
        {"name": "Wheat Bread", "sku": "816831", "unit": "loaf", "par": 4},
        {"name": "White Sandwich Bread", "sku": "610019", "unit": "loaf", "par": 4},
        {"name": "Fantini Bakery Bulkie Rolls (24 oz., 12 ct.)", "sku": "889689", "unit": "pack", "par": 4,
         "url": "https://www.samsclub.com/p/fantini-bakery-bulkie-rolls-12-ct/131037"},
        {"name": "Member's Mark Buttermilk Pancake Mix (10 lbs.)", "sku": "642969", "unit": "bag", "par": 2,
         "url": "https://www.samsclub.com/p/member-s-mark-buttermilk-pancake-mix-10-lbs/prod20996183"},
        {"name": "Member's Mark Cinnamon French Toast Sticks (50 ct.)", "sku": "990292127", "unit": "bag", "par": 3,
         "url": "https://www.samsclub.com/p/members-mark-cinnamon-french-toast-sticks-50ct/prod22842371"},
        {"name": "Member's Mark Chicken Patties, Fully Cooked (5 lbs.)", "sku": "96228", "unit": "bag", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-chicken-patties/prod23300814"},
        {"name": "Member's Mark 80/20 Angus Beef Patties (1/3 lb., 18 ct.)", "sku": "990290437", "unit": "case", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-80-20-ground-angus-beef-patties-frozen-1-3-lb-18-ct/prod20295335"},
        {"name": "Quaker Instant Oatmeal Variety Pack (52 pk.)", "sku": "866624", "unit": "box", "par": 2,
         "url": "https://www.samsclub.com/p/instant-oatmeal-52ct-variety-pack/prod20620161"},
        {"name": "Kellogg's Froot Loops Cereal (43.6 oz.)", "sku": "657545", "unit": "box", "par": 3,
         "url": "https://www.samsclub.com/p/kellogg-s-froot-loops-cereal-43-6-oz/prod711121"},
        {"name": "Kellogg's Raisin Bran Cereal (76.5 oz.)", "sku": "990514971", "unit": "box", "par": 3,
         "url": "https://www.samsclub.com/p/kellogg-s-raisin-bran-76-5-oz/129327"},
        {"name": "Honey Nut Cheerios Twin Pack (49 oz.)", "sku": "341296", "unit": "box", "par": 3,
         "url": "https://www.samsclub.com/p/honey-nut-cheerios-twin-pack-3-lb-1-oz-box/158058"},
        {"name": "General Mills Cereal Cups Variety Pack", "sku": "990351639", "unit": "case", "par": 2,
         "url": "https://www.samsclub.com/p/general-mills-cereal-cups-variety-pack-19-7-oz-12-pk/P990324393"},
        {"name": "Dannon Activia Probiotic Yogurt Variety Pack (24 pk.)", "sku": "990509113", "unit": "pack", "par": 3,
         "url": "https://www.samsclub.com/p/activia-24-pk/prod21002332"},
        {"name": "Yoplait Original Yogurt Variety Pack (18 ct.)", "sku": "990328342", "unit": "pack", "par": 4,
         "url": "https://www.samsclub.com/p/yoplait-original-yogurt-variety-pack/prod22340228"},
        {"name": "Garden Salad", "sku": "905604", "unit": "bag", "par": 4},
        {"name": "Spring Mix Salad Greens", "sku": "990421155", "unit": "bag", "par": 3},
        {"name": "Bananas", "sku": "362153", "unit": "bunch", "par": 10},
        {"name": "Clementines", "sku": "457334", "unit": "box", "par": 4},
    ],
    "breakfast_beverage": [
        {"name": "Member's Mark House Blend Coffee Pods (100 ct.)", "sku": "990392614", "unit": "box", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-single-serve-cups-house-blend-coffee-100-ct/P03021218"},
        # Receipt was a 40-ct box (likely discontinued online) — name-search to current K-Cup results.
        {"name": "Starbucks House Blend K-Cups", "sku": "763358", "unit": "box", "par": 2},
        {"name": "Starbucks Dark Roast / Espresso K-Cups", "sku": "980175178", "unit": "box", "par": 2},
        {"name": "Whole Milk", "sku": "980018247", "unit": "gallon", "par": 4},
        {"name": "2% Reduced Fat Milk", "sku": "980015302", "unit": "gallon", "par": 4},
        {"name": "SunnyD Tangy Original", "sku": "359187", "unit": "bottle", "par": 3},
        {"name": "100% Juice", "sku": "667645", "unit": "case", "par": 3},
        {"name": "Welch's Juice (10 oz.)", "sku": "171345", "unit": "case", "par": 3},
        {"name": "Member's Mark Purified Water", "sku": "561914", "unit": "case", "par": 4},
        {"name": "Poland Spring Water", "sku": "129884", "unit": "case", "par": 4},
        {"name": "Coca-Cola (cans)", "sku": "542946", "unit": "case", "par": 2},
        {"name": "Diet Coke (35 pk. cans)", "sku": "543176", "unit": "case", "par": 2},
        {"name": "Pepsi (36 cans)", "sku": "781149", "unit": "case", "par": 2},
        {"name": "Dr Pepper (24 cans)", "sku": "633304", "unit": "case", "par": 2},
        {"name": "Sprite (cans)", "sku": "545238", "unit": "case", "par": 2},
        {"name": "Sunkist Orange Soda (12 oz., 24 pk.)", "sku": "990416892", "unit": "case", "par": 2,
         "url": "https://www.samsclub.com/p/sunkist-orange-soda-24-12-oz-cans/168058"},
    ],
    "breakfast_supply": [
        {"name": "Member's Mark Super Premium Paper Towels (15 rolls)", "sku": "980078481", "unit": "case", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-super-premium-individually-wrapped-paper-towels/prod21231906"},
        {"name": "Member's Mark 1-Ply Everyday Napkins (1,200 ct.)", "sku": "990288419", "unit": "pack", "par": 3,
         "url": "https://www.samsclub.com/p/members-mark-1-ply-everyday-napkins/prod12550253"},
        {"name": "Member's Mark Ultra Dinner Paper Plates, 10\" (204 ct.)", "sku": "678518", "unit": "pack", "par": 3,
         "url": "https://www.samsclub.com/p/members-mark-ultra-dinner-paper-plates-204ct/prod21161051"},
        {"name": "Chinet Classic White Dinner Plates, 10-3/8\" (165 ct.)", "sku": "414131", "unit": "pack", "par": 2,
         "url": "https://www.samsclub.com/p/chinet-classic-paper-dinner-plates-165-count/164873"},
        {"name": "Member's Mark White Plastic Forks, Heavyweight (600 ct.)", "sku": "988507", "unit": "pack", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-white-plastic-forks-600-ct/174705"},
        {"name": "Member's Mark White Plastic Knives, Heavyweight (600 ct.)", "sku": "140634", "unit": "pack", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-white-plastic-knives-heavyweight-600ct/181232"},
        {"name": "Member's Mark White Plastic Spoons, Heavyweight (600 ct.)", "sku": "988514", "unit": "pack", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-white-plastic-spoons-600-ct/174706"},
        {"name": "Member's Mark Clear Plastic Cups, 9 oz. (264 ct.)", "sku": "980259466", "unit": "pack", "par": 3,
         "url": "https://www.samsclub.com/p/cups-9oz-240ct-clear/prod13710449"},
        {"name": "Member's Mark Plastic Cups (5 oz.)", "sku": "980259465", "unit": "pack", "par": 3},
        {"name": "Member's Mark Aluminum Foil (2/150 sq. ft.)", "sku": "299338", "unit": "pack", "par": 2,
         "url": "https://www.samsclub.com/p/member-s-mark-aluminum-foil-2-150-sq-ft/107917"},
        {"name": "Food Service Trays (2 lb.)", "sku": "990375567", "unit": "pack", "par": 2},
    ],
    "housekeeping": [
        {"name": "Member's Mark 45-50 Gal. Commercial Trash Bags (220 ct.)", "sku": "850357", "unit": "case", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-45-50-gallon-commercial-trash-bags-220ct/155168"},
        {"name": "Member's Mark Fabric Softener Dryer Sheets (480 ct.)", "sku": "990393837", "unit": "box", "par": 2,
         "url": "https://www.samsclub.com/p/members-mark-fabric-softener-dryer-sheets-480ct/prod19900619"},
        {"name": "Lysol Advanced Toilet Bowl Cleaner (32 oz., 4 pk.)", "sku": "980238935", "unit": "pack", "par": 3,
         "url": "https://www.samsclub.com/p/lysol-advanced-toilet-bowl-cleaner-4pk/prod24012744"},
        {"name": "Fabuloso Multi-Purpose Cleaner, Lavender (210 oz.)", "sku": "990285551", "unit": "bottle", "par": 3,
         "url": "https://www.samsclub.com/p/fabuloso-multi-purpose-cleaner-lavender-210-oz/prod16750055"},
        {"name": "Febreze Air Effects Air Freshener Spray (4 ct.)", "sku": "990493412", "unit": "pack", "par": 3,
         "url": "https://www.samsclub.com/ip/febreze-air-effects-air-freshener-spray-gain-original-heavy-duty-4-ct/16379812864"},
    ],
}


# ============================================================
# Checklists
# ============================================================

CHECKLISTS = {
    "breakfast": [
        "Take down breakfast.",
        "Sweep and mop breakfast area.",
        "Clean stains off the chairs in breakfast area.",
        "Wash breakfast supplies, sweep and mop kitchen.",
        "Sweep and mop lobby area and wipe down glass in lobby area.",
        "Check breakfast list and note stocks running low.",
        "Clean Public Bathrooms each day (toilet bowls, urinals, replenish toilet paper and towels).",
        "Empty towel bin in gym, put used towels in laundry, ensure water supply is accurate.",
        "Turn off coffee machine in kitchen before leaving.",
        "Put out fresh pot of coffee, regular and decaf, before leaving.",
        "Empty the coffee machine grounds bin each day.",
    ],
    "groundsman": [
        "Empty trash inside and outside (morning and evening).",
        "Water flowers twice daily (morning and evening).",
        "Double check with front desk that laundry facility is open at 9AM.",
        "Check landscaping, lawn upkeep (mow and blow when needed).",
        "Check surrounding areas free from trash, litter, debris and weed.",
        "Pick up trash and cigarette buds outside.",
        "Pull weeds growing wild.",
        "Sweep gravels/loose stones out of walking area at front entrance.",
        "Inspect dumpster gate and lock.",
        "Check meter reading outside.",
        "Walk floors, clear trash from guest doors, bring luggage carts to lobby.",
    ],
}


# ============================================================
# Rooms
# ============================================================

CASCO_BAY_FLAGS = {
    "131": {"hairdryer": "Not Attached"},
    "134": {"hairdryer": "Not Attached"},
    "204": {"hairdryer": "Melting", "notes": "Replace immediately"},
    "205": {"hairdryer": "Not Attached"},
    "113": {
        "comforter_cover": "no", "cabinet": "no", "ironing_board": "no",
        "iron": "no", "microwave": "no", "fridge": "no", "ice_bucket": "no",
        "keurig": "no",
    },
}


def casco_bay_rooms():
    # 34 rooms per floor × 4 floors = 136 rooms (101–134, 201–234, 301–334, 401–434)
    return [f"{floor}{n:02d}" for floor in (1, 2, 3, 4) for n in range(1, 35)]


def saco_bay_rooms():
    return [f"{floor}{n:02d}" for floor in (1, 2, 3, 4) for n in range(1, 27)]


def get_table(client, prefix, suffix):
    return client.Table(f"{prefix}-{suffix}")


def batch_put(table, items):
    with table.batch_writer() as batch:
        for it in items:
            batch.put_item(Item=it)


def seed_shift_tasks(table, property_id):
    items = []
    for shift, categories in SHIFT_TASKS.items():
        order = 0
        for category, tasks in categories:
            for task_text in tasks:
                order += 1
                task_id = f"{shift}-{order:03d}"
                items.append({
                    "PK": f"PROPERTY#{property_id}",
                    "SK": f"SHIFT#{shift}#TASK#{task_id}",
                    "task_id": task_id,
                    "task_text": task_text,
                    "category": category,
                    "sort_order": order,
                    "is_template": True,
                    "shift": shift,
                })
    batch_put(table, items)
    print(f"  shift tasks: {len(items)}")


def _catalog_rows():
    """Yield (category, item_id, name, sku, url, unit, par) for every catalog
    entry. Catalog entries are either a plain name (no Sam's Club SKU) or a
    {name, sku, unit, par[, url]} dict for products bought at Sam's Club."""
    for category, entries in INVENTORY_CATALOG.items():
        for i, entry in enumerate(entries, start=1):
            if isinstance(entry, str):
                entry = {"name": entry}
            sku = entry.get("sku", "")
            # Prefer the resolved product page; otherwise search by product name
            # (receipt SKUs aren't the website's product IDs, so a name search
            # lands far more reliably than a SKU search).
            url = entry.get("url") or (
                "https://www.samsclub.com/search?q=" + quote_plus(entry["name"]) if sku else ""
            )
            yield (
                category, f"{category[:3]}-{i:03d}", entry["name"], sku, url,
                entry.get("unit", "each"), int(entry.get("par", 0)),
            )


def seed_inventory(table, property_id):
    items = []
    for category, item_id, name, sku, url, unit, par in _catalog_rows():
        items.append({
            "PK": f"PROPERTY#{property_id}",
            "SK": f"CATEGORY#{category}#ITEM#{item_id}",
            "item_id": item_id,
            "item_name": name,
            "category": category,
            "sku": sku,
            "url": url,
            "vendor": "sams_club" if sku else "",
            "current_stock": 0,
            "par_level": par,
            "unit": unit,
            "reorder_threshold_pct": 30,
        })
    batch_put(table, items)
    print(f"  inventory items: {len(items)}")


def refresh_inventory_links(table, property_id):
    """Update name/sku/url/unit + vendor on existing catalog items WITHOUT
    touching current_stock OR par_level (both owner-tuned) — safe to run on a
    property that already has live counts. Use this to push corrected product
    links/names to an already-seeded DB."""
    count = 0
    for category, item_id, name, sku, url, unit, _par in _catalog_rows():
        table.update_item(
            Key={"PK": f"PROPERTY#{property_id}", "SK": f"CATEGORY#{category}#ITEM#{item_id}"},
            UpdateExpression="SET item_name = :n, sku = :s, #url = :u, #unit = :unit, vendor = :v",
            ExpressionAttributeNames={"#url": "url", "#unit": "unit"},
            ExpressionAttributeValues={
                ":n": name, ":s": sku, ":u": url, ":unit": unit,
                ":v": "sams_club" if sku else "",
            },
        )
        count += 1
    print(f"  refreshed inventory links: {count}")


def prune_inventory(table, property_id):
    """Delete inventory rows that have no Sam's Club product hyperlink — i.e. the
    legacy non-Sam's items (old linen / amenity / front_desk categories). Every
    current catalog item carries a `url`, so this only removes the orphans.
    Item change-logs (LOG#...) are left untouched."""
    pk = f"PROPERTY#{property_id}"
    items = []
    kwargs = {"KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with("CATEGORY#")}
    while True:
        resp = table.query(**kwargs)
        items += resp.get("Items", [])
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    deleted = 0
    with table.batch_writer() as batch:
        for it in items:
            if not str(it.get("url") or "").strip():
                batch.delete_item(Key={"PK": it["PK"], "SK": it["SK"]})
                deleted += 1
    print(f"  pruned non-hyperlinked inventory: {deleted} (kept {len(items) - deleted})")


def seed_checklists(table, property_id):
    items = []
    for list_type, tasks in CHECKLISTS.items():
        for idx, task_text in enumerate(tasks, start=1):
            items.append({
                "PK": f"PROPERTY#{property_id}",
                "SK": f"TEMPLATE#{list_type}#ITEM#{idx}",
                "task_text": task_text,
                "type": list_type,
                "item_index": idx,
            })
    batch_put(table, items)
    print(f"  checklist templates: {len(items)}")


def seed_rooms(table, property_id, rooms, flags=None):
    flags = flags or {}
    items = []
    equipment_fields = [
        "comforter_cover", "cabinet", "ironing_board", "iron_hanger", "iron",
        "luggage_rack", "hangers", "microwave", "fridge", "ice_bucket",
        "keurig", "desk_chair", "lounge_chair", "hairdryer", "soap_dish",
    ]
    for room in rooms:
        room_flags = flags.get(room, {})
        item = {
            "PK": f"PROPERTY#{property_id}",
            "SK": f"ROOM#{room}",
            "room_number": room,
            "notes": room_flags.get("notes", ""),
        }
        for field in equipment_fields:
            item[field] = room_flags.get(field, "")
        items.append(item)
    batch_put(table, items)
    print(f"  rooms: {len(items)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", default="avr-mgmt")
    parser.add_argument("--prefix", default="avr",
                        help="Resource-name prefix used in template.yaml StackPrefix parameter")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--properties", nargs="+", default=["casco_bay", "saco_bay"])
    parser.add_argument("--reset", action="store_true",
                        help="Delete existing template/seed items before reseeding")
    parser.add_argument("--refresh-links", action="store_true",
                        help="Only refresh inventory name/sku/url/unit/par on existing "
                             "items (keeps current_stock); skips all other seeding")
    parser.add_argument("--prune-inventory", action="store_true",
                        help="Delete inventory rows with no Sam's Club product link "
                             "(legacy linen/amenity/front_desk items); skips all seeding")
    args = parser.parse_args()

    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    shift_tbl = get_table(dynamodb, args.prefix, "shift-tasks")
    inv_tbl = get_table(dynamodb, args.prefix, "inventory")
    chk_tbl = get_table(dynamodb, args.prefix, "checklists")
    room_tbl = get_table(dynamodb, args.prefix, "rooms")

    if args.refresh_links:
        for pid in args.properties:
            print(f"\nRefreshing inventory links for {pid}...")
            refresh_inventory_links(inv_tbl, pid)
        print("\nRefresh complete.")
        return

    if args.prune_inventory:
        for pid in args.properties:
            print(f"\nPruning non-hyperlinked inventory for {pid}...")
            prune_inventory(inv_tbl, pid)
        print("\nPrune complete.")
        return

    for pid in args.properties:
        print(f"\nSeeding {pid}...")
        if args.reset:
            print(f"  (reset mode: existing items will be overwritten via put_item)")
        seed_shift_tasks(shift_tbl, pid)
        seed_inventory(inv_tbl, pid)
        seed_checklists(chk_tbl, pid)
        if pid == "casco_bay":
            seed_rooms(room_tbl, pid, casco_bay_rooms(), CASCO_BAY_FLAGS)
        elif pid == "saco_bay":
            seed_rooms(room_tbl, pid, saco_bay_rooms())

    print("\nSeed complete.")


if __name__ == "__main__":
    main()
