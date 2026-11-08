import sqlite3
import threading
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server_app import cache
from server_app.repositories.iacuc import read_iacuc_index
from server_app.repositories.state import read_cached_state


class CacheConcurrencyTests(unittest.TestCase):
    def setUp(self):
        cache.invalidate_data_cache_prefixes("")
        self.addCleanup(cache.invalidate_data_cache_prefixes, "")

    def test_invalidation_prevents_a_late_reader_from_replacing_fresh_data(self):
        read = threading.Event()
        finish = threading.Event()
        results = []

        def old_reader():
            generation = cache.cache_generation()
            self.assertIs(cache.cache_get("key", cache.CACHE_MISS), cache.CACHE_MISS)
            read.set()
            self.assertTrue(finish.wait(2))
            results.append(cache.cache_set("key", "old", expected_generation=generation))

        thread = threading.Thread(target=old_reader)
        thread.start()
        try:
            self.assertTrue(read.wait(1))
            cache.invalidate_data_cache("key")
            cache.cache_set("key", "fresh")
        finally:
            finish.set()
            thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(results, ["old"])
        self.assertEqual(cache.cache_get("key"), "fresh")

    def test_prefix_invalidation_retires_a_fill_even_when_no_entry_exists(self):
        generation = cache.cache_generation()
        cache.invalidate_data_cache_prefixes("quantity_sheets::")
        cache.cache_set("quantity_sheets::detail", None, expected_generation=generation)
        self.assertIs(cache.cache_get("quantity_sheets::detail", cache.CACHE_MISS), cache.CACHE_MISS)
        fresh_generation = cache.cache_generation()
        cache.cache_set("quantity_sheets::detail", None, expected_generation=fresh_generation)
        self.assertIsNone(cache.cache_get("quantity_sheets::detail", cache.CACHE_MISS))

    def test_concurrent_state_misses_only_build_once(self):
        entered = threading.Event()
        release = threading.Event()
        results = []

        def assemble(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(2))
            return {"rooms": []}

        with patch("server_app.repositories.state.assemble_state", side_effect=assemble) as build:
            threads = [
                threading.Thread(
                    target=lambda: results.append(read_cached_state(SimpleNamespace(in_transaction=False), dict))
                )
                for _ in range(8)
            ]
            for thread in threads:
                thread.start()
            try:
                self.assertTrue(entered.wait(1))
            finally:
                release.set()
                for thread in threads:
                    thread.join(2)
            self.assertTrue(all(not t.is_alive() for t in threads))
            self.assertEqual(build.call_count, 1)
            self.assertEqual(results, [{"rooms": []}] * 8)

    def test_a_writer_never_waits_for_a_rebuild_lock(self):
        holding = threading.Event()
        release = threading.Event()

        def hold():
            with cache.cache_build_lock("assembled_state", SimpleNamespace(in_transaction=False)):
                holding.set()
                release.wait(2)

        thread = threading.Thread(target=hold)
        thread.start()
        try:
            self.assertTrue(holding.wait(1))
            with patch("server_app.repositories.state.assemble_state", return_value={"writer": True}):
                self.assertEqual(read_cached_state(SimpleNamespace(in_transaction=True), dict), {"writer": True})
                self.assertIs(cache.cache_get("assembled_state", cache.CACHE_MISS), cache.CACHE_MISS)
        finally:
            release.set()
            thread.join(2)
        self.assertFalse(thread.is_alive())

    def test_failed_build_releases_lock_and_does_not_cache_empty_success(self):
        conn = SimpleNamespace(in_transaction=False)
        with patch(
            "server_app.repositories.state.assemble_state",
            side_effect=[RuntimeError("database failure"), {"rooms": []}],
        ):
            with self.assertRaises(RuntimeError):
                read_cached_state(conn, dict)
            self.assertIs(cache.cache_get("assembled_state", cache.CACHE_MISS), cache.CACHE_MISS)
            self.assertEqual(read_cached_state(conn, dict), {"rooms": []})

    def test_transaction_reads_own_writes_without_publishing_them(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("CREATE TABLE experiment_applications(payload TEXT, imported_at TEXT)")
            conn.execute("INSERT INTO experiment_applications VALUES ('{\"iacuc\":\"old\"}', 'v1')")
            conn.commit()
            self.assertEqual(read_iacuc_index(conn, Path("missing"), Path("missing"))["items"][0]["iacuc"], "old")
            conn.execute('UPDATE experiment_applications SET payload=\'{"iacuc":"new"}\'')
            self.assertEqual(read_iacuc_index(conn, Path("missing"), Path("missing"))["items"][0]["iacuc"], "new")
            self.assertEqual(cache.cache_get("iacuc_index")["items"][0]["iacuc"], "old")
            conn.rollback()
            self.assertEqual(read_iacuc_index(conn, Path("missing"), Path("missing"))["items"][0]["iacuc"], "old")

    def test_cache_memory_budget_and_large_value_bypass(self):
        with patch.object(cache, "CACHE_MAX_BYTES", 2200), patch.object(cache, "CACHE_MAX_ITEM_BYTES", 1800):
            cache.cache_set("first", "a" * 1400)
            cache.cache_set("second", "b" * 1400)
            self.assertIs(cache.cache_get("first", cache.CACHE_MISS), cache.CACHE_MISS)
            self.assertEqual(cache.cache_get("second"), "b" * 1400)
            self.assertLessEqual(sum(item["sizeBytes"] for item in cache.DATA_CACHE.values()), 2200)
            self.assertEqual(cache.cache_set("second", "c" * 3000), "c" * 3000)
            self.assertIs(cache.cache_get("second", cache.CACHE_MISS), cache.CACHE_MISS)

    def test_cache_size_measurement_handles_cycles(self):
        item = {"value": 1}
        item["self"] = item
        cache.cache_set("cyclic", item)
        self.assertIs(cache.cache_get("cyclic"), item)

    def test_rejected_transaction_fill_does_not_traverse_the_value(self):
        with patch.object(cache, "_value_size", side_effect=AssertionError("unneeded traversal")):
            self.assertEqual(cache.cache_set("writer", {"local": True}, expected_generation=-1), {"local": True})
        self.assertIsNone(cache.cache_get("writer"))

    def test_invalidation_during_size_measurement_still_rejects_the_fill(self):
        generation = cache.cache_generation()

        def measure(_):
            cache.invalidate_data_cache("target")
            return 100

        with patch.object(cache, "_value_size", side_effect=measure):
            cache.cache_set("target", "old", expected_generation=generation)
        self.assertIsNone(cache.cache_get("target"))

    def test_unrelated_writes_preserve_fills_but_history_overflow_is_conservative(self):
        generation = cache.cache_generation()
        cache.invalidate_data_cache_prefixes("audit_events::")
        cache.cache_set("applications_by_iacuc", {"current": True}, expected_generation=generation)
        self.assertEqual(cache.cache_get("applications_by_iacuc"), {"current": True})
        for _ in range(520):
            cache.invalidate_data_cache("unrelated")
        cache.cache_set("ancient", "old", expected_generation=generation)
        self.assertIsNone(cache.cache_get("ancient"))
        self.assertLessEqual(len(cache._INVALIDATIONS), 512)

    def test_hot_reader_skips_its_build_lock_and_unrelated_keys_do_not_wait(self):
        held, release, completed = threading.Event(), threading.Event(), threading.Event()
        conn = SimpleNamespace(in_transaction=False)
        cache.cache_set("assembled_state", {"rooms": []})

        def hold():
            with cache.cache_build_lock("assembled_state", conn):
                held.set()
                release.wait(2)

        def read():
            with cache.cache_build_lock("different", conn):
                self.assertEqual(read_cached_state(conn, dict), {"rooms": []})
            completed.set()

        holder, reader = threading.Thread(target=hold), threading.Thread(target=read)
        holder.start()
        try:
            self.assertTrue(held.wait(1))
            reader.start()
            self.assertTrue(completed.wait(1), "hot or unrelated reader waited for another build")
        finally:
            release.set()
            holder.join(2)
            if reader.ident is not None:
                reader.join(2)
        self.assertFalse(holder.is_alive() or reader.is_alive())
        self.assertFalse(cache._BUILD_LOCKS)


if __name__ == "__main__":
    unittest.main()
