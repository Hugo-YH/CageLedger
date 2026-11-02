import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

from server_app.cache import invalidate_data_cache_prefixes
from server_app.repositories.entities import list_intake_batches_page
from server_app.repositories.filter_options import filtered_where
from server_app.web.entity_contracts import ENTITY_ORDER_BY


class IntakeSummaryCacheTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def database(self, name, batch_no):
        path = Path(self.directory.name) / name if name != ":memory:" else name
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        self.addCleanup(conn.close)
        conn.execute(
            "CREATE TABLE intake_batches (id TEXT, batch_no TEXT, intake_date TEXT, updated_at TEXT, payload TEXT)"
        )
        conn.execute(
            "INSERT INTO intake_batches VALUES ('same-id',?,'2026-11-02','v1',?)",
            (batch_no, json.dumps({"id": "same-id", "batchNo": batch_no})),
        )
        conn.commit()
        return path, conn

    def listing(self, conn):
        return list_intake_batches_page(
            conn, {"limit": 20, "offset": 0, "view": "summary"}, filtered_where, ENTITY_ORDER_BY
        )

    def test_file_and_memory_databases_do_not_share_same_record_ids(self):
        for kind in ("file", "memory"):
            with self.subTest(kind=kind):
                _, first = self.database("first.sqlite" if kind == "file" else ":memory:", "FIRST")
                _, second = self.database("second.sqlite" if kind == "file" else ":memory:", "SECOND")
                self.assertEqual(self.listing(first)["items"][0]["batchNo"], "FIRST")
                self.assertEqual(self.listing(second)["items"][0]["batchNo"], "SECOND")

    def test_transaction_reads_its_own_changes_without_publishing_them(self):
        _, conn = self.database("transaction.sqlite", "COMMITTED")
        self.assertEqual(self.listing(conn)["items"][0]["batchNo"], "COMMITTED")
        conn.execute("UPDATE intake_batches SET payload=?", (json.dumps({"id": "same-id", "batchNo": "DRAFT"}),))
        self.assertEqual(self.listing(conn)["items"][0]["batchNo"], "DRAFT")
        conn.rollback()
        self.assertEqual(self.listing(conn)["items"][0]["batchNo"], "COMMITTED")

    def test_concurrent_cold_readers_share_one_rebuild_and_writes_invalidate_it(self):
        path, conn = self.database("concurrent.sqlite", "COMMITTED")
        barrier, lock = threading.Barrier(6), threading.Lock()
        counts = []

        def read():
            with closing(sqlite3.connect(path)) as reader:
                reader.row_factory = sqlite3.Row

                def trace(statement):
                    if statement.startswith("SELECT COUNT(*)"):
                        with lock:
                            counts.append(1)

                reader.set_trace_callback(trace)
                barrier.wait(timeout=5)
                return self.listing(reader)["items"][0]["batchNo"]

        with ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(list(pool.map(lambda _: read(), range(6))), ["COMMITTED"] * 6)
        self.assertEqual(len(counts), 1)
        conn.execute("UPDATE intake_batches SET payload=?", (json.dumps({"id": "same-id", "batchNo": "NEW"}),))
        conn.commit()
        invalidate_data_cache_prefixes("intake_batches::")
        self.assertEqual(self.listing(conn)["items"][0]["batchNo"], "NEW")
