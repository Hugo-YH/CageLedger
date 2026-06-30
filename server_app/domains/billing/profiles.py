import re

from server_app.shared import as_int, clean_text

BILLING_RULES = {
    "mouse_standard": {
        "species": "mouse",
        "unit": "cage_day",
        "internalPrice": 4.5,
        "externalPrice": 13.5,
        "tiered": True,
        "freeAllowance": True,
    },
    "mouse_diabetic": {
        "species": "mouse",
        "unit": "cage_day",
        "internalPrice": 7.2,
        "externalPrice": 21.6,
        "tiered": False,
        "freeAllowance": False,
    },
    "rat_standard": {
        "species": "rat",
        "unit": "cage_day",
        "internalPrice": 8.5,
        "externalPrice": 25.5,
        "tiered": False,
        "freeAllowance": False,
    },
    "rat_diabetic": {
        "species": "rat",
        "unit": "cage_day",
        "internalPrice": 14,
        "externalPrice": 42,
        "tiered": False,
        "freeAllowance": False,
    },
    "guinea_pig": {
        "species": "guinea_pig",
        "unit": "animal_day",
        "internalPrice": 3,
        "externalPrice": 9,
        "tiered": False,
        "freeAllowance": False,
    },
    "rabbit": {
        "species": "rabbit",
        "unit": "animal_day",
        "internalPrice": 5,
        "externalPrice": 15,
        "tiered": False,
        "freeAllowance": False,
    },
    "monkey": {
        "species": "monkey",
        "unit": "animal_day",
        "internalPrice": 35,
        "externalPrice": 65,
        "tiered": False,
        "freeAllowance": False,
    },
    "pig": {
        "species": "pig",
        "unit": "animal_day",
        "internalPrice": 15,
        "externalPrice": 45,
        "tiered": False,
        "freeAllowance": False,
    },
    "dog": {
        "species": "dog",
        "unit": "animal_day",
        "internalPrice": 15,
        "externalPrice": 45,
        "tiered": False,
        "freeAllowance": False,
    },
}


def normalize_billing_item(value):
    text = clean_text(value)
    return text if text in BILLING_RULES else "mouse_standard"


def normalize_customer_type(value):
    return "external" if clean_text(value) == "external" else "internal"


def normalize_billing_unit(value):
    return "animal_day" if clean_text(value) == "animal_day" else "cage_day"


def billing_item_for_species(species):
    return {
        "mouse": "mouse_standard",
        "rat": "rat_standard",
        "guinea_pig": "guinea_pig",
        "rabbit": "rabbit",
        "monkey": "monkey",
        "pig": "pig",
        "dog": "dog",
    }.get(clean_text(species), "mouse_standard")


def infer_billing_item_from_room(room=None):
    room = room or {}
    text = " ".join(
        clean_text(room.get(key, ""))
        for key in ("name", "area", "defaultSpecies", "species")
        if clean_text(room.get(key, ""))
    )
    if re.search(r"糖尿病.*大鼠|大鼠.*糖尿病", text):
        return "rat_diabetic"
    if re.search(r"糖尿病.*小鼠|小鼠.*糖尿病", text):
        return "mouse_diabetic"
    if "豚鼠" in text:
        return "guinea_pig"
    if "大鼠" in text:
        return "rat_standard"
    if "兔" in text:
        return "rabbit"
    if "猴" in text:
        return "monkey"
    if "犬" in text or "狗" in text:
        return "dog"
    if "猪" in text:
        return "pig"
    if "小鼠" in text:
        return "mouse_standard"
    return ""


def room_has_manual_billing_profile(room=None, inferred_billing_item=""):
    room = room or {}
    if room.get("billingProfileConfirmed"):
        return True
    if not room.get("billingProfileConfigured"):
        return False
    fallback_mouse = clean_text(room.get("defaultBillingItem", "")) in ("", "mouse_standard") and clean_text(
        room.get("defaultSpecies", "")
    ) in ("", "mouse")
    return not (fallback_mouse and inferred_billing_item and inferred_billing_item != "mouse_standard")


def billing_profile_for_room(room=None, fallback_unit=None):
    room = room or {}
    inferred_billing_item = infer_billing_item_from_room(room)
    manual_billing = room_has_manual_billing_profile(room, inferred_billing_item)
    billing_item = normalize_billing_item(
        (room.get("defaultBillingItem") if manual_billing else inferred_billing_item)
        or room.get("defaultBillingItem")
        or billing_item_for_species(room.get("defaultSpecies", "mouse"))
    )
    if fallback_unit == "animal_day" and billing_item == "mouse_standard":
        billing_item = "guinea_pig"
    rule = BILLING_RULES.get(billing_item, BILLING_RULES["mouse_standard"])
    customer_type = normalize_customer_type(room.get("defaultCustomerType", "internal"))
    unit_price = rule["externalPrice"] if customer_type == "external" else rule["internalPrice"]
    return {
        "facility": clean_text(room.get("facility", "zhujiang")) or "zhujiang",
        "species": rule["species"],
        "billingItem": billing_item,
        "customerType": customer_type,
        "unit": rule["unit"],
        "unitPrice": unit_price,
        "tiered": bool(rule.get("tiered") and customer_type == "internal"),
        "freeAllowance": bool(rule.get("freeAllowance") and customer_type == "internal"),
        "defaultAnimalCount": max(as_int(room.get("defaultAnimalCount")) or 1, 1),
    }


def billing_profile_for_occupancy(occupancy, state):
    slot = next((item for item in state.get("slots", []) if item.get("id") == occupancy.get("slotId")), None)
    rack = next((item for item in state.get("racks", []) if item.get("id") == (slot or {}).get("rackId")), None)
    room = next((item for item in state.get("rooms", []) if item.get("id") == (rack or {}).get("roomId")), None)
    base = billing_profile_for_room(room)
    billing_item = normalize_billing_item(occupancy.get("billingItem") or base["billingItem"])
    rule = BILLING_RULES.get(billing_item, BILLING_RULES["mouse_standard"])
    customer_type = normalize_customer_type(occupancy.get("customerType") or base["customerType"])
    unit_price = rule["externalPrice"] if customer_type == "external" else rule["internalPrice"]
    return {
        **base,
        "species": rule["species"],
        "billingItem": billing_item,
        "customerType": customer_type,
        "unit": rule["unit"],
        "unitPrice": unit_price,
        "tiered": bool(rule.get("tiered") and customer_type == "internal"),
        "freeAllowance": bool(rule.get("freeAllowance") and customer_type == "internal"),
    }


def occupancy_animal_count(occupancy, profile):
    return max(as_int(occupancy.get("animalCount")) or as_int(profile.get("defaultAnimalCount")) or 1, 1)
