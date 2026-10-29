import sqlite3
import unittest

from server_app.domains.reimbursement_ledger import repository
from server_app.persistence.reimbursement_schema import initialize_reimbursement_schema


class ClaimProjectionTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        initialize_reimbursement_schema(self.conn)
        self.conn.execute(
            "CREATE INDEX idx_reimbursement_allocations_line ON reimbursement_allocations(funding_line_id,status)"
        )
        self.conn.execute(
            "INSERT INTO reimbursement_claims(id,document_number,funding_owner,created_by,created_by_name,created_at,updated_at,payload) VALUES ('c','DOC','Owner','u','User','t','t','{\"extra\":1}')"
        )
        self.conn.execute(
            "INSERT INTO reimbursement_claims(id,document_number,funding_owner,created_by,created_by_name,created_at,updated_at,payload) VALUES ('other','OTHER','Other','u','User','t','t','{}')"
        )
        self.conn.execute(
            "INSERT INTO reimbursement_settlement_obligations(id,workflow_id,statement_version_id,month,source_pi,iacuc,created_at,updated_at,payload) VALUES ('o','w','v','2026-01','PI','IACUC','t','t','{}')"
        )

    def tearDown(self):
        self.conn.close()

    def add_line(self, index, allocations=2, claim="c"):
        line_id = f"{claim}-l{index}"
        self.conn.execute(
            "INSERT INTO reimbursement_claim_funding_lines(id,claim_id,fund_book_no,funding_owner,sort_order,created_at,updated_at,payload) VALUES (?,?,?,?,?,?,?,?)",
            (line_id, claim, f"book{index}", "line owner", 10 - index, "t", "t", '{"lineExtra":true}'),
        )
        for n in range(allocations):
            self.conn.execute(
                "INSERT INTO reimbursement_allocations(id,funding_line_id,obligation_id,amount,created_by,created_by_name,created_at,updated_at,payload) VALUES (?,?,?,?,?,?,?,?,?)",
                (f"{line_id}-a{n}", line_id, "o", n + 0.25, "u", "User", f"t{1 - n}", "t", '{"allocationExtra":true}'),
            )

    def legacy_projection(self, row):
        result = repository.claim_payload(self.conn, row, False)
        lines = self.conn.execute(
            "SELECT * FROM reimbursement_claim_funding_lines WHERE claim_id=? ORDER BY sort_order, rowid", (row["id"],)
        ).fetchall()
        result["fundingLines"] = [repository.funding_line_payload(self.conn, line, True) for line in lines]
        result["attachments"] = []
        return result

    def test_projection_and_query_count(self):
        for i in range(10):
            self.add_line(i)
        self.add_line(1, claim="other")
        row = repository.claim_row(self.conn, "c")
        expected = self.legacy_projection(row)
        statements = []
        self.conn.set_trace_callback(statements.append)
        actual = repository.claim_payload(self.conn, row, True)
        self.conn.set_trace_callback(None)
        self.assertEqual(actual, expected)
        self.assertEqual(len(statements), 4)
        self.assertTrue(
            all(
                a["fundingOwner"] == "Owner" and a["documentNumber"] == "DOC"
                for line in actual["fundingLines"]
                for a in line["allocations"]
            )
        )
        other = repository.claim_payload(self.conn, repository.claim_row(self.conn, "other"), True)
        self.assertTrue(
            all(
                a["fundingOwner"] == "Other" and a["documentNumber"] == "OTHER"
                for line in other["fundingLines"]
                for a in line["allocations"]
            )
        )

    def test_no_allocations(self):
        self.add_line(0, allocations=0)
        row = repository.claim_row(self.conn, "c")
        expected = self.legacy_projection(row)
        statements = []
        self.conn.set_trace_callback(statements.append)
        actual = repository.claim_payload(self.conn, row, True)
        self.conn.set_trace_callback(None)
        self.assertEqual(actual, expected)
        self.assertEqual(len(statements), 4)

    def test_same_time_allocation_order_matches_legacy_index_scan(self):
        self.add_line(0)
        self.conn.execute("UPDATE reimbursement_allocations SET created_at='same'")
        self.conn.execute("UPDATE reimbursement_allocations SET status='reversed' WHERE id='c-l0-a0'")
        row = repository.claim_row(self.conn, "c")
        self.assertEqual(repository.claim_payload(self.conn, row, True), self.legacy_projection(row))
        self.conn.execute("DROP INDEX idx_reimbursement_allocations_line")
        self.assertEqual(repository.claim_payload(self.conn, row, True), self.legacy_projection(row))

    def test_missing_obligation_preserves_error(self):
        self.add_line(0)
        self.conn.execute("DELETE FROM reimbursement_settlement_obligations WHERE id='o'")
        row = repository.claim_row(self.conn, "c")
        for projection in (lambda: self.legacy_projection(row), lambda: repository.claim_payload(self.conn, row, True)):
            with self.assertRaisesRegex(LookupError, "结算应收不存在"):
                projection()

    def test_missing_claim_preserves_error(self):
        self.add_line(0)
        row = repository.claim_row(self.conn, "c")
        self.conn.execute("DELETE FROM reimbursement_claims WHERE id='c'")
        for projection in (lambda: self.legacy_projection(row), lambda: repository.claim_payload(self.conn, row, True)):
            with self.assertRaisesRegex(LookupError, "报销单不存在"):
                projection()


if __name__ == "__main__":
    unittest.main()
