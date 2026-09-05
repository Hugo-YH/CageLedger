import unittest
from unittest.mock import Mock, patch

from server_app import cache
from server_app.domains.state.query import actor_cache_scope
from server_app.repositories.quantity_sheets import get_quantity_sheet


class DataCacheTests(unittest.TestCase):
    def setUp(self):
        cache.DATA_CACHE.clear()

    def tearDown(self):
        cache.DATA_CACHE.clear()

    def test_keys_distinguish_delimiters_types_and_list_boundaries(self):
        pairs = [
            ({"a": "x|b=y", "b": "z"}, {"a": "x", "b": "y|b=z"}),
            ({"rooms": ["a,b", "c"]}, {"rooms": ["a", "b,c"]}),
            ({"value": "1"}, {"value": 1}),
        ]
        for first, second in pairs:
            with self.subTest(first=first):
                self.assertNotEqual(cache.cache_key("list", **first), cache.cache_key("list", **second))
        self.assertEqual(cache.cache_key("list", b=2, a=1), cache.cache_key("list", a=1, b=2))

    def test_prefix_invalidation_keeps_other_namespaces(self):
        first = cache.cache_key("sheets::detail", id="1")
        second = cache.cache_key("rooms", id="1")
        cache.cache_set(first, 1)
        cache.cache_set(second, 2)
        cache.invalidate_data_cache_prefixes("sheets::")
        self.assertIs(cache.cache_get(first, cache.CACHE_MISS), cache.CACHE_MISS)
        self.assertEqual(cache.cache_get(second), 2)

    def test_actor_room_scope_cannot_collide_on_commas(self):
        first = actor_cache_scope({"role": "manager", "roomIds": ["a,b", "c"]})
        second = actor_cache_scope({"role": "manager", "roomIds": ["a", "b,c"]})
        self.assertNotEqual(
            cache.cache_key("bootstrap_summary", actor=first), cache.cache_key("bootstrap_summary", actor=second)
        )

    def test_null_result_avoids_repeat_query_until_invalidated(self):
        conn = Mock()
        conn.execute.return_value.fetchone.return_value = None
        self.assertIsNone(get_quantity_sheet(conn, "missing"))
        self.assertIsNone(get_quantity_sheet(conn, "missing"))
        self.assertEqual(conn.execute.call_count, 1)
        cache.invalidate_data_cache_prefixes("quantity_sheets::")
        get_quantity_sheet(conn, "missing")
        self.assertEqual(conn.execute.call_count, 2)

    def test_expiration_uses_elapsed_time(self):
        with patch.object(cache.time, "monotonic", return_value=100):
            cache.cache_set("entry", None, ttl_seconds=5)
        with patch.object(cache.time, "monotonic", return_value=104):
            self.assertIsNone(cache.cache_get("entry", cache.CACHE_MISS))
        with patch.object(cache.time, "monotonic", return_value=105):
            self.assertIs(cache.cache_get("entry", cache.CACHE_MISS), cache.CACHE_MISS)

    def test_cache_evicts_an_entry_when_it_reaches_its_capacity(self):
        with patch.object(cache, "CACHE_MAX_ENTRIES", 2):
            cache.cache_set("first", 1, ttl_seconds=1)
            cache.cache_set("second", 2, ttl_seconds=2)
            cache.cache_set("third", 3, ttl_seconds=3)

        self.assertNotIn("first", cache.DATA_CACHE)
        self.assertEqual(cache.cache_get("second"), 2)
        self.assertEqual(cache.cache_get("third"), 3)


if __name__ == "__main__":
    unittest.main()
