import sqlite3
import unittest
from contextlib import closing

from server_app.domains.reimbursement_ledger.service import (
    confirm_allocation,
    create_allocation,
    get_claim,
    list_obligations,
    reverse_allocation,
    save_claim,
)
from server_app.persistence.money_fields import ensure_schema
from server_app.shared.money_fields import MONEY_COLUMNS, exact_cents, money_difference, money_sum
from tests import test_reimbursement_ledger as fixture


class MoneySchemaTests(unittest.TestCase):
    def database(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        for table, fields in MONEY_COLUMNS.items():
            conn.execute(
                f'CREATE TABLE "{table}" (id TEXT PRIMARY KEY,' + ",".join(f'"{field}" REAL' for field in fields) + ")"
            )
            conn.execute(
                f'INSERT INTO "{table}" VALUES (' + ",".join("?" for _ in range(len(fields) + 1)) + ")",
                ("seed", *[12.34 if index % 2 == 0 else -2.03 for index in range(len(fields))]),
            )
        conn.commit()
        return conn

    def test_backfill_preserves_original_fields_and_repeated_migration_is_idle(self):
        with closing(self.database()) as conn:
            before = {table: tuple(conn.execute(f'SELECT * FROM "{table}"').fetchone()) for table in MONEY_COLUMNS}
            ensure_schema(conn)
            for table, fields in MONEY_COLUMNS.items():
                row = conn.execute(f'SELECT * FROM "{table}"').fetchone()
                self.assertEqual(tuple(row)[: len(before[table])], before[table])
                for field in fields:
                    self.assertEqual(row[field + "_cents"], exact_cents(row[field]))
                    self.assertIsInstance(row[field + "_cents"], int)
            changes = conn.total_changes
            ensure_schema(conn)
            self.assertEqual(conn.total_changes, changes)

    def test_legacy_writes_keep_cent_mirrors_in_sync_and_reject_drift(self):
        with closing(self.database()) as conn:
            ensure_schema(conn)
            for table, fields in MONEY_COLUMNS.items():
                for field in fields:
                    with self.subTest(table=table, field=field):
                        conn.execute(f'UPDATE "{table}" SET "{field}"=0.29 WHERE id=\'seed\'')
                        self.assertEqual(conn.execute(f'SELECT "{field}_cents" FROM "{table}"').fetchone()[0], 29)
                        with self.assertRaises(sqlite3.IntegrityError):
                            conn.execute(f'UPDATE "{table}" SET "{field}_cents"=30 WHERE id=\'seed\'')
                        self.assertEqual(conn.execute(f'SELECT "{field}" FROM "{table}"').fetchone()[0], 0.29)

    def test_fractional_null_and_large_legacy_values_are_not_silently_rounded(self):
        with closing(self.database()) as conn:
            ensure_schema(conn)
            for value in (None, 0.005, 1.005, 1.234567, 1e100, 0.30000000000000004):
                conn.execute("UPDATE billing_candidate_snapshots SET total_amount=?", (value,))
                row = conn.execute("SELECT total_amount,total_amount_cents FROM billing_candidate_snapshots").fetchone()
                self.assertEqual(row[0], value)
                self.assertIsNone(row[1])

    def test_exact_arithmetic_retains_legacy_fallback_rounding(self):
        self.assertEqual(money_sum([0.1, 0.2]), 0.3)
        self.assertEqual(money_difference(0.3, 0.1), 0.2)
        self.assertEqual(money_sum([0.004, 0.004]), round(0.004 + 0.004, 2))
        self.assertEqual(money_difference(1.005, 0), round(1.005, 2))
        self.assertEqual(exact_cents(-1.23), -123)


class MoneyAllocationTests(unittest.TestCase):
    def setUp(self):
        self.base = fixture.ReimbursementLedgerTests()
        self.base.setUp()
        self.conn = self.base.conn
        self.conn.execute("UPDATE reimbursement_settlement_obligations SET payable_amount=0.3,outstanding_amount=0.3")
        self.conn.execute(
            "UPDATE billing_statement_versions SET payload=json_set(payload,'$.statement.totalAmount',0.3)"
        )
        self.conn.commit()
        self.obligation = list_obligations(self.conn, fixture.ADMIN, {})["items"][0]
        self.claim = save_claim(
            self.conn,
            fixture.ADMIN,
            None,
            {
                "documentNumber": "CENTS-BOUNDARY",
                "fundingLines": [{"fundBookNo": "F-CENTS", "fundingOwner": "测试负责人", "reimbursementAmount": 0.3}],
            },
        )["item"]

    def tearDown(self):
        self.base.tearDown()

    def allocate(self, amount):
        return create_allocation(
            self.conn,
            fixture.ADMIN,
            {
                "claimId": self.claim["id"],
                "fundingLineId": self.claim["fundingLines"][0]["id"],
                "obligationId": self.obligation["id"],
                "amount": amount,
            },
        )["item"]

    def test_point_one_plus_point_two_confirms_exactly_and_reversal_restores_balance(self):
        first, second = self.allocate(0.1), self.allocate(0.2)
        confirm_allocation(self.conn, fixture.ADMIN, first["id"])
        confirm_allocation(self.conn, fixture.ADMIN, second["id"])
        claim = get_claim(self.conn, fixture.ADMIN, self.claim["id"])["item"]
        self.assertEqual((claim["allocatedAmount"], claim["unallocatedAmount"]), (0.3, 0))
        row = self.conn.execute(
            "SELECT allocated_amount_cents,outstanding_amount_cents,status FROM reimbursement_settlement_obligations WHERE id=?",
            (self.obligation["id"],),
        ).fetchone()
        self.assertEqual(tuple(row), (30, 0, "settled"))
        excessive = self.allocate(0.01)
        with self.assertRaises(ValueError):
            confirm_allocation(self.conn, fixture.ADMIN, excessive["id"])
        reverse_allocation(self.conn, fixture.ADMIN, second["id"], "核销选错")
        claim = get_claim(self.conn, fixture.ADMIN, self.claim["id"])["item"]
        self.assertEqual((claim["allocatedAmount"], claim["unallocatedAmount"]), (0.1, 0.2))

    def test_input_rounding_matches_previous_policy(self):
        for value in (0.005, 1.005, 2.675):
            allocation = self.allocate(value)
            self.assertEqual(allocation["amount"], round(value, 2))


if __name__ == "__main__":
    unittest.main()
