import unittest

from server_app.domains.quarantine.service import check_version
from server_app.domains.technical_services.repository import require_version
from server_app.shared.concurrency import StaleWriteError, require_current_version, require_exact_version


class WriteConcurrencyTests(unittest.TestCase):
    def test_allows_matching_server_version(self):
        require_current_version({"updatedAt": "2026-07-14T09:00:00+00:00"}, "2026-07-14T09:00:00+00:00", "记录")

    def test_rejects_stale_server_version(self):
        with self.assertRaisesRegex(StaleWriteError, "刷新后重新编辑"):
            require_current_version({"updatedAt": "2026-07-14T09:01:00+00:00"}, "2026-07-14T09:00:00+00:00", "记录")

    def test_legacy_optional_version_and_normalization_are_preserved(self):
        for version in (None, "", "  "):
            require_current_version({"updatedAt": "version"}, version, "记录")
        require_current_version({"updatedAt": " version "}, " version ", "记录")
        require_current_version({"updatedAt": "1"}, 1, "记录")

    def test_strict_versions_reject_missing_whitespace_and_type_coercion(self):
        for version in (None, "", " version ", 1, False):
            with self.subTest(version=version), self.assertRaisesRegex(StaleWriteError, "strict"):
                require_exact_version("version", version, "strict")
        require_exact_version("version", "version", "strict")
        with self.assertRaises(StaleWriteError):
            require_exact_version("1", 1, "strict")

    def test_domain_strict_checks_keep_existing_messages_and_rules(self):
        for version in (None, "", "wrong", " version "):
            with self.subTest(version=version):
                with self.assertRaisesRegex(StaleWriteError, "技术服务明细已更新"):
                    require_version({"updated_at": "version"}, version)
                with self.assertRaisesRegex(StaleWriteError, "记录已更新或缺少版本"):
                    check_version({"updatedAt": "version"}, {"expectedUpdatedAt": version})
        require_version({"updated_at": "version"}, "version")
        check_version({"updatedAt": "version"}, {"expectedUpdatedAt": "version"})
        with self.assertRaises(StaleWriteError):
            require_version({}, None)
        with self.assertRaises(StaleWriteError):
            check_version({}, {})
