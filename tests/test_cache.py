import unittest
from unittest.mock import patch

from server_app import cache


class DataCacheTests(unittest.TestCase):
    def setUp(self):
        cache.DATA_CACHE.clear()

    def tearDown(self):
        cache.DATA_CACHE.clear()

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
