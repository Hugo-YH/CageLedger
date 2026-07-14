import unittest

from server_app.shared.concurrency import StaleWriteError, require_current_version


class WriteConcurrencyTests(unittest.TestCase):
    def test_allows_matching_server_version(self):
        require_current_version({"updatedAt": "2026-07-14T09:00:00+00:00"}, "2026-07-14T09:00:00+00:00", "记录")

    def test_rejects_stale_server_version(self):
        with self.assertRaisesRegex(StaleWriteError, "刷新后重新编辑"):
            require_current_version({"updatedAt": "2026-07-14T09:01:00+00:00"}, "2026-07-14T09:00:00+00:00", "记录")
