"""Legacy JSON and calendar boundaries for lightweight overview reads."""

import calendar
import json
import random
import sqlite3
import unittest
from unittest.mock import patch

from server_app.domains import dashboard_overview as overview
from server_app.repositories.dashboard import intake_statistics_rows
from server_app.shared import as_int, clean_text


class DashboardProjectionTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE intake_batches(id TEXT,intake_date TEXT,payload TEXT);
            CREATE INDEX intake_date_lookup ON intake_batches(intake_date);
            CREATE TABLE quantity_sheets(month TEXT,room_name TEXT,payload TEXT);
        """)

    def intake(self, identity, value, date="2026-09-01"):
        self.conn.execute("INSERT INTO intake_batches VALUES(?,?,?)", (identity, date, value))

    def test_projection_preserves_json_types_last_keys_and_payload_authority(self):
        values = [
            '{"intakeDate":"2026-09-01","quantity":2,"quantity":3,"species":"mouse"}',
            json.dumps(
                {
                    "intakeDate": "2026-09-02",
                    "quantity": 123456789012345678901234567890,
                    "strainStandard": {"x": True},
                    "species": ["mouse", "rat"],
                    "rawText": "x" * 10000,
                }
            ),
            json.dumps({"intakeDate": None, "quantity": False, "strainRaw": None, "species": None}).encode(),
            b'{"quantity":1,"quantity":2}',
            json.dumps({"intakeDate": "2026-09-01", "quantity": 2, "species": "mouse"}).encode("utf-16"),
            json.dumps({"intakeDate": "2026-09-01", "quantity": 3, "species": "mouse"}).encode("utf-32"),
        ]
        for n, raw in enumerate(values):
            self.intake(str(n), raw)
        result = list(intake_statistics_rows(self.conn))
        for actual, raw in zip(result, values, strict=True):
            expected = json.loads(raw)
            for key in ("intakeDate", "quantity", "strainStandard", "strainRaw", "species"):
                self.assertEqual(actual.get(key), expected.get(key))
            self.assertNotIn("rawText", actual)
        self.assertEqual(len(list(intake_statistics_rows(self.conn, "2026-09-01", "2026-10-01"))), len(values))

    def test_intake_totals_dates_tied_order_and_one_standardization_per_label(self):
        for n in range(12):
            self.intake(
                str(n),
                json.dumps(
                    {
                        "intakeDate": "2026-09-03",
                        "quantity": -1 if n == 0 else 2,
                        "strainRaw": "C57BL/6",
                        "species": "mouse",
                        "rawText": "x" * 1000,
                    }
                ),
            )
        self.intake("other", json.dumps({"intakeDate": "2026-08-31", "quantity": 99}), "2026-08-31")
        with patch.object(overview, "standardize_strain", wraps=overview.standardize_strain) as standardize:
            result = overview._intake_overview(self.conn, "2026-09")
        self.assertEqual((result["batches"], result["animals"]), (12, 22))
        self.assertEqual(result["trend"][2], {"day": 3, "batches": 12, "animals": 22})
        self.assertEqual(standardize.call_count, 1)
        self.assertEqual(result["species"], [{"species": "mouse", "animals": 22}])

    def test_bad_json_and_legacy_non_object_keep_original_failure(self):
        self.intake("bad", "{")
        with self.assertRaises(json.JSONDecodeError):
            overview._intake_overview(self.conn, "all")
        self.conn.execute("DELETE FROM intake_batches")
        self.intake("list", "[]")
        with self.assertRaises(AttributeError):
            overview._intake_overview(self.conn, "all")

    def test_interval_totals_match_calendar_oracle_for_legacy_changes_and_leap_year(self):
        rng = random.Random(731)
        expected = {}
        for n in range(120):
            month = ("2024-02", "2026-09")[n % 2]
            room = f"房间{n % 3}"
            days = calendar.monthrange(*map(int, month.split("-")))[1]
            rows = [
                {
                    "date": f" {month}-{rng.randint(1, days):02d} ",
                    "addedCount": rng.randint(-2, 8),
                    "removedCount": rng.randint(-2, 8),
                }
                for _ in range(5)
            ]
            rows.extend(
                [
                    {"date": month + "-02", "cageCount": 0},
                    {"date": month + "-02", "cageCount": 7},
                    {"date": month + "-99", "cageCount": "not a number"},
                    {"date": "2020-01-01", "cageCount": 1000},
                ]
            )
            sheet = {"initialCageCount": n % 7 - 2, "rows": rows}
            self.conn.execute("INSERT INTO quantity_sheets VALUES(?,?,?)", (month, room, json.dumps(sheet)))
            daily = expected.setdefault((month, room), [0] * days)
            current = max(sheet["initialCageCount"], 0)
            for day in range(1, days + 1):
                matches = [r for r in rows if clean_text(r["date"])[:10] == f"{month}-{day:02d}"]
                if matches:
                    row = matches[-1]
                    current = (
                        max(as_int(row["cageCount"]) or 0, 0)
                        if row.get("cageCount") is not None
                        else max(
                            current
                            + max(as_int(row.get("addedCount")) or 0, 0)
                            - max(as_int(row.get("removedCount")) or 0, 0),
                            0,
                        )
                    )
                daily[day - 1] += current
        for month in ("2024-02", "2026-09"):
            result = overview._rooms_overview(self.conn, month, {}, {})
            for room in result:
                daily = expected[month, room["roomName"]]
                self.assertEqual([point["cages"] for point in room["trend"]], daily)
                self.assertEqual(room["cageDays"], sum(daily))
        history = overview._rooms_overview(self.conn, "all", {}, {})
        for room in history:
            self.assertEqual(room["cageDays"], sum(sum(d) for (m, r), d in expected.items() if r == room["roomName"]))
        self.assertEqual(overview._rooms_overview(self.conn, "2020-01", {}, {}), [])
