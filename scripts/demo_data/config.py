from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

DEMO_PREFIX = "demo-202605"
DEMO_MONTH = date.today().strftime("%Y-%m")
DEMO_ROOMS = {
    "zj_mouse": {
        "id": f"{DEMO_PREFIX}-room-zj-mouse",
        "name": "演示-珠江小鼠间A",
        "area": "珠江新城设施",
        "facility": "zhujiang",
        "defaultSpecies": "mouse",
        "defaultBillingItem": "mouse_standard",
        "defaultCustomerType": "internal",
        "defaultAnimalCount": 1,
        "rackCount": 1,
        "rows": 4,
        "cols": 4,
        "billingProfileConfigured": True,
        "billingProfileConfirmed": True,
    },
    "bio_monkey": {
        "id": f"{DEMO_PREFIX}-room-bio-monkey",
        "name": "演示-生物岛猴房A",
        "area": "生物岛设施",
        "facility": "bioisland",
        "defaultSpecies": "monkey",
        "defaultBillingItem": "monkey",
        "defaultCustomerType": "internal",
        "defaultAnimalCount": 1,
        "rackCount": 1,
        "rows": 2,
        "cols": 3,
        "billingProfileConfigured": True,
        "billingProfileConfirmed": True,
    },
    "bio_guinea": {
        "id": f"{DEMO_PREFIX}-room-bio-guinea",
        "name": "演示-生物岛豚鼠房A",
        "area": "生物岛设施",
        "facility": "bioisland",
        "defaultSpecies": "guinea_pig",
        "defaultBillingItem": "guinea_pig",
        "defaultCustomerType": "internal",
        "defaultAnimalCount": 4,
        "rackCount": 1,
        "rows": 2,
        "cols": 3,
        "billingProfileConfigured": True,
        "billingProfileConfirmed": True,
    },
}
DEMO_PI_MOUSE = "柯琼（演示）"
DEMO_PI_MONKEY = "周孝来（演示）"
DEMO_PI_GUINEA = "苏玉霞（演示）"
DEMO_IACUCS = {
    "mouse_a": "Z2026D01",
    "mouse_b": "Z2026D02",
    "mouse_c": "Z2026D03",
    "mouse_d": "Z2026D04",
    "monkey_a": "B2026H01",
    "monkey_b": "B2026H02",
    "guinea_a": "B2026G01",
}


@dataclass
class DemoContext:
    actor: dict
    month: str
    backup_path: Path


def demo_date(day: int) -> str:
    return f"{DEMO_MONTH}-{day:02d}"


def next_monday(value: str) -> str:
    current = datetime.strptime(value, "%Y-%m-%d").date()
    delta = (7 - current.weekday()) % 7
    delta = 7 if delta == 0 else delta
    return (current + timedelta(days=delta)).isoformat()
