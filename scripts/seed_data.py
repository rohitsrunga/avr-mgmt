"""Seed DynamoDB with master shift tasks, checklists, inventory items, and rooms.

Usage:
    python3 scripts/seed_data.py --stack avr-mgmt --region us-east-1
    python3 scripts/seed_data.py --stack avr-mgmt --properties casco_bay
    python3 scripts/seed_data.py --stack avr-mgmt --reset    # delete + reseed
"""
import argparse
import sys
from decimal import Decimal

import boto3


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
        ("Breakfast", [
            "Refill breakfast items",
            "Breakfast cleanup: leftovers, wipe counters, put away stuff",
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
# Inventory items (from printed sheets)
# ============================================================

INVENTORY_ITEMS = {
    "breakfast_food": [
        "Apples", "Bananas", "Yogurt", "Danishes", "Muffins", "English muffins",
        "Bagels", "Bread", "Waffle mix", "Frosted Flakes", "Cheerios", "Fruit Loops",
        "Raisin Bran", "Oatmeal packets", "Whole milk", "2% milk", "Croissant",
        "Egg patties", "Sausage patties", "Sausage links", "French Toast", "Honey Bun",
        "Cream cheese", "Oil", "Butter", "Peanut butter", "Jellies", "Syrup",
    ],
    "breakfast_beverage": [
        "Apple juice", "Orange juice", "Cranberry juice", "Light roast", "Medium roast",
        "Dark roast", "Green tea", "Lipton tea", "Sugar", "Hot chocolate", "Sweeteners",
        "Half & Half",
    ],
    "breakfast_supply": [
        "Coffee cups", "Juice cups", "Waffle cups", "Lids", "Stirrers", "Filter paper",
        "Paper filter roll", "Paper plates", "Paper bowls", "Knives", "Forks", "Spoons",
        "Napkins", "Paper towels", "Food handling gloves", "Non-stick spray",
    ],
    "housekeeping": [
        "Reg K-cups", "Decaf K-cups", "2-ply toilet paper", "Glass Cleaner",
        "Furniture polisher", "Stainless steel cleaner", "Mr. Clean Magic Eraser",
        "Disinfecting wipes", "Bleach", "Lemon Lift", "Stain Blaster", "Lysol",
        "Lysol toilet gel", "Gloves M", "Gloves L", "Mop heads", "Febreze",
        "Fabuloso", "Pine Sol", "Ice bags", "Bin liners", "Garbage bags",
        "Laundry bags", "Tide pods", "Dryer sheets",
    ],
    "linen": [
        "Bath towels", "Hand towels", "Wash cloths", "Bath mats",
        "Pillowcases", "Pillow covers",
        "King fitted sheets", "King flat sheets",
        "Queen fitted sheets", "Queen flat sheets",
        "Blankets", "Mattress protectors",
    ],
    "amenity": [
        "Soap", "Lotion", "Shampoo", "Conditioner", "Hand sanitizer", "Facial tissue",
        "Toilet paper", "Ice bucket", "Toothpaste packs", "K cups (reg)",
        "K cups (decaf)", "Stirrers", "Coffee cups (room)", "Coffee cups (breakfast)",
        "Lids",
    ],
    "front_desk": [
        "Pens", "Bic pens", "Pencils", "Sharpie", "Printer Paper", "Wite Out",
        "Notepad", "PostIt", "Toner", "Staples", "Tape", "Envelope (cash)",
        "Envelope (file)", "Elastic band", "Keys", "Key holders", "AAA batteries",
        "AA batteries",
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

CASCO_BAY_ROOMS = [
    "112", "113", "114", "115", "116", "117", "118", "119", "120", "121",
    "122", "123", "124", "125", "126", "127", "128", "129", "130", "131",
    "132", "133", "134", "201", "202", "203", "204", "205",
]

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


def saco_bay_rooms():
    return [f"{floor}{n:02d}" for floor in (1, 2, 3, 4) for n in range(1, 27)]


def get_table(client, stack, suffix):
    return client.Table(f"{stack}-{suffix}")


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


def seed_inventory(table, property_id):
    items = []
    for category, names in INVENTORY_ITEMS.items():
        for i, name in enumerate(names, start=1):
            item_id = f"{category[:3]}-{i:03d}"
            items.append({
                "PK": f"PROPERTY#{property_id}",
                "SK": f"CATEGORY#{category}#ITEM#{item_id}",
                "item_id": item_id,
                "item_name": name,
                "category": category,
                "current_stock": 0,
                "par_level": 0,
                "unit": "each",
                "reorder_threshold_pct": 30,
            })
    batch_put(table, items)
    print(f"  inventory items: {len(items)}")


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
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--properties", nargs="+", default=["casco_bay", "saco_bay"])
    parser.add_argument("--reset", action="store_true",
                        help="Delete existing template/seed items before reseeding")
    args = parser.parse_args()

    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    shift_tbl = get_table(dynamodb, args.stack, "shift-tasks")
    inv_tbl = get_table(dynamodb, args.stack, "inventory")
    chk_tbl = get_table(dynamodb, args.stack, "checklists")
    room_tbl = get_table(dynamodb, args.stack, "rooms")

    for pid in args.properties:
        print(f"\nSeeding {pid}...")
        if args.reset:
            print(f"  (reset mode: existing items will be overwritten via put_item)")
        seed_shift_tasks(shift_tbl, pid)
        seed_inventory(inv_tbl, pid)
        seed_checklists(chk_tbl, pid)
        if pid == "casco_bay":
            seed_rooms(room_tbl, pid, CASCO_BAY_ROOMS, CASCO_BAY_FLAGS)
        elif pid == "saco_bay":
            seed_rooms(room_tbl, pid, saco_bay_rooms())

    print("\nSeed complete.")


if __name__ == "__main__":
    main()
