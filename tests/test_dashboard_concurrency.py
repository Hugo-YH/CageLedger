import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from pathlib import Path
from unittest.mock import patch

import server
from server_app import cache
from server_app.domains import dashboard_overview as overview
from server_app.domains.state import infrastructure_commands


class DashboardConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "one.sqlite"
        self.seed(self.path, 7)
        cache.invalidate_data_cache_prefixes("")
        self.addCleanup(cache.invalidate_data_cache_prefixes, "")

    def seed(self, path, quantity):
        with closing(sqlite3.connect(path)) as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            item = {"id": "same-id", "intakeDate": "2026-09-01", "quantity": quantity}
            conn.execute(
                "INSERT INTO intake_batches(id,batch_no,status,updated_at,intake_date,payload) VALUES(?,'B','received','v1',?,?)",
                (item["id"], item["intakeDate"], json.dumps(item)),
            )
            conn.commit()

    def read(self, path=None, rooms=None):
        with closing(sqlite3.connect(path or self.path)) as conn:
            conn.row_factory = sqlite3.Row
            return overview.dashboard_overview_payload(conn, "2026-09", rooms=rooms)

    def test_cold_same_key_requests_coalesce_and_warm_requests_do_not_build(self):
        entered, finish = threading.Event(), threading.Event()
        original = overview._intake_overview

        def build(*args):
            entered.set()
            self.assertTrue(finish.wait(3))
            return original(*args)

        with patch.object(overview, "_intake_overview", side_effect=build) as builder:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(self.read) for _ in range(4)]
                try:
                    self.assertTrue(entered.wait(2))
                finally:
                    finish.set()
                results = [future.result(3) for future in futures]
            self.assertEqual(builder.call_count, 1)
            self.assertTrue(all(item == results[0] for item in results))
            self.assertEqual(self.read(), results[0])
            self.assertEqual(builder.call_count, 1)

    def test_database_and_explicit_room_scopes_do_not_share_payloads(self):
        second = Path(self.directory.name) / "two.sqlite"
        self.seed(second, 13)
        self.assertNotEqual(self.read()["intake"], self.read(second)["intake"])
        with patch.object(overview, "_rooms_overview", side_effect=lambda _c, _m, by_id, _n: sorted(by_id)):
            one = self.read(rooms=[{"id": "a,b"}, {"id": "c"}])
            two = self.read(rooms=[{"id": "a"}, {"id": "b,c"}])
        self.assertEqual(one["rooms"], ["a,b", "c"])
        self.assertEqual(two["rooms"], ["a", "b,c"])

    def test_transient_databases_never_reuse_another_connections_cache(self):
        with closing(sqlite3.connect(":memory:")) as one, closing(sqlite3.connect(":memory:")) as two:
            for conn in (one, two):
                conn.row_factory = sqlite3.Row
                server.initialize_schema(conn)
                conn.commit()
            with patch.object(overview, "_intake_overview", side_effect=[{"db": 1}, {"db": 2}, {"db": 1}]) as build:
                self.assertEqual(overview.dashboard_overview_payload(one, "2026-09")["intake"], {"db": 1})
                self.assertEqual(overview.dashboard_overview_payload(two, "2026-09")["intake"], {"db": 2})
                self.assertEqual(overview.dashboard_overview_payload(one, "2026-09")["intake"], {"db": 1})
                self.assertEqual(build.call_count, 3)

    def test_default_room_scope_rebuilds_after_official_room_create_and_delete(self):
        @contextmanager
        def connection():
            with closing(sqlite3.connect(self.path)) as conn:
                conn.row_factory = sqlite3.Row
                yield conn

        actor = {"id": "test-admin", "username": "test-admin", "displayName": "测试管理员", "role": "admin"}
        spec = {"id_prefix": "room"}
        with (
            patch.object(infrastructure_commands, "connect_db", connection),
            patch.object(overview, "_read_rooms", wraps=overview._read_rooms) as read_rooms,
        ):
            self.read()
            self.read()
            self.assertEqual(read_rooms.call_count, 1)
            infrastructure_commands.write_infrastructure_entity(
                "rooms", "POST", "", {"item": {"id": "new-room", "name": "新饲养间"}}, actor, spec
            )
            self.read()
            self.assertEqual(read_rooms.call_count, 2)
            infrastructure_commands.write_infrastructure_entity("rooms", "DELETE", "new-room", {}, actor, spec)
            self.read()
            self.assertEqual(read_rooms.call_count, 3)

    def test_interrupted_build_releases_lock_and_allows_a_fresh_retry(self):
        with patch.object(
            overview, "_intake_overview", side_effect=[sqlite3.OperationalError("interrupted"), {"fresh": True}]
        ) as build:
            with self.assertRaisesRegex(sqlite3.OperationalError, "interrupted"):
                self.read()
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertEqual(pool.submit(self.read).result(2)["intake"], {"fresh": True})
            self.assertEqual(self.read()["intake"], {"fresh": True})
            self.assertEqual(build.call_count, 2)

    def test_waiting_reader_captures_generation_after_lock_and_retires_old_fill(self):
        entered, waiting, finish = threading.Event(), threading.Event(), threading.Event()
        lock_attempts = 0
        build_count = 0
        counter = threading.Lock()

        @contextmanager
        def observed_lock(key, conn):
            nonlocal lock_attempts
            with counter:
                lock_attempts += 1
                if lock_attempts == 2:
                    waiting.set()
            with cache.cache_build_lock(key, conn):
                yield

        def build(*_args):
            nonlocal build_count
            build_count += 1
            if build_count == 1:
                entered.set()
                self.assertTrue(finish.wait(3))
                return {"version": "old"}
            return {"version": "fresh"}

        with (
            patch.object(overview, "cache_build_lock", observed_lock),
            patch.object(overview, "_intake_overview", side_effect=build),
        ):
            with ThreadPoolExecutor(max_workers=2) as pool:
                old = pool.submit(self.read)
                try:
                    self.assertTrue(entered.wait(2))
                    fresh = pool.submit(self.read)
                    self.assertTrue(waiting.wait(2))
                    overview.invalidate_dashboard_overview_cache()
                finally:
                    finish.set()
                self.assertEqual(old.result(3)["intake"], {"version": "old"})
                self.assertEqual(fresh.result(3)["intake"], {"version": "fresh"})
            self.assertEqual(self.read()["intake"], {"version": "fresh"})
            self.assertEqual(build_count, 2)

    def test_existing_write_transaction_never_waits_or_publishes_uncommitted_data(self):
        entered, finish = threading.Event(), threading.Event()
        original = overview._intake_overview

        def build(conn, month):
            if not conn.in_transaction:
                entered.set()
                self.assertTrue(finish.wait(3))
            return original(conn, month)

        with patch.object(overview, "_intake_overview", side_effect=build):
            with ThreadPoolExecutor(max_workers=2) as pool:
                reader = pool.submit(self.read)
                try:
                    self.assertTrue(entered.wait(2))

                    def writer():
                        with closing(sqlite3.connect(self.path)) as conn:
                            conn.row_factory = sqlite3.Row
                            conn.execute("BEGIN IMMEDIATE")
                            conn.execute("UPDATE intake_batches SET payload=json_set(payload,'$.quantity',99)")
                            payload = overview.dashboard_overview_payload(conn, "2026-09")
                            self.assertTrue(conn.in_transaction)
                            conn.rollback()
                            return payload

                    written = pool.submit(writer).result(2)
                finally:
                    finish.set()
                committed = reader.result(3)
            self.assertNotEqual(written["intake"], committed["intake"])
            self.assertEqual(self.read()["intake"], committed["intake"])
