import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RuntimeLogConfigTests(unittest.TestCase):
    def load_config(self, **overrides):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix="cageledger-log-config-") as directory:
            env = {key: value for key, value in os.environ.items() if not key.startswith("CAGELEDGER_")}
            env.update(
                CAGELEDGER_DATA_ROOT=directory,
                CAGELEDGER_DB=str(Path(directory) / "database.sqlite"),
                CAGELEDGER_LOG_DIR=str(Path(directory) / "logs"),
            )
            env.update(overrides)
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import json; from server_app import config; "
                    "print(json.dumps({name: getattr(config, name) for name in "
                    "('LOG_MAX_BYTES', 'LOG_FILE_COUNT', 'LOG_RETENTION_DAYS', 'LOG_TOTAL_MAX_BYTES')}))",
                ],
                cwd=root,
                env=env,
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
        return json.loads(result.stdout)

    def test_defaults_keep_ten_mebibyte_segments_with_ninety_day_archive_limits(self):
        self.assertEqual(
            self.load_config(),
            {
                "LOG_MAX_BYTES": 10 * 1024**2,
                "LOG_FILE_COUNT": 365,
                "LOG_RETENTION_DAYS": 90,
                "LOG_TOTAL_MAX_BYTES": 1024**3,
            },
        )

    def test_existing_explicit_five_file_limit_remains_supported(self):
        self.assertEqual(self.load_config(CAGELEDGER_LOG_FILE_COUNT="5")["LOG_FILE_COUNT"], 5)

    def test_file_count_and_retention_are_clamped_to_supported_bounds(self):
        for count, days, expected_count, expected_days in [("1", "0", 2, 1), ("1001", "3651", 1000, 3650)]:
            with self.subTest(count=count, days=days):
                values = self.load_config(CAGELEDGER_LOG_FILE_COUNT=count, CAGELEDGER_LOG_RETENTION_DAYS=days)
                self.assertEqual(values["LOG_FILE_COUNT"], expected_count)
                self.assertEqual(values["LOG_RETENTION_DAYS"], expected_days)

    def test_invalid_values_use_defaults(self):
        values = self.load_config(
            CAGELEDGER_LOG_MAX_BYTES="invalid",
            CAGELEDGER_LOG_FILE_COUNT="invalid",
            CAGELEDGER_LOG_RETENTION_DAYS="invalid",
            CAGELEDGER_LOG_TOTAL_MAX_BYTES="invalid",
        )
        self.assertEqual(values, self.load_config())

    def test_total_capacity_tracks_segment_minimum_and_ten_gibibyte_maximum(self):
        for maximum, total, expected_maximum, expected_total in [
            (str(100 * 1024**2), "1", 100 * 1024**2, 200 * 1024**2),
            ("1", "1", 64 * 1024, 128 * 1024),
            (str(101 * 1024**2), str(11 * 1024**3), 100 * 1024**2, 10 * 1024**3),
        ]:
            with self.subTest(maximum=maximum, total=total):
                values = self.load_config(CAGELEDGER_LOG_MAX_BYTES=maximum, CAGELEDGER_LOG_TOTAL_MAX_BYTES=total)
                self.assertEqual(values["LOG_MAX_BYTES"], expected_maximum)
                self.assertEqual(values["LOG_TOTAL_MAX_BYTES"], expected_total)

    def test_total_capacity_default_and_invalid_fallback_respect_large_segments(self):
        for overrides in [{}, {"CAGELEDGER_LOG_TOTAL_MAX_BYTES": "invalid"}]:
            with self.subTest(overrides=overrides):
                values = self.load_config(CAGELEDGER_LOG_MAX_BYTES=str(100 * 1024**2), **overrides)
                self.assertEqual(values["LOG_TOTAL_MAX_BYTES"], 1024**3)


if __name__ == "__main__":
    unittest.main()
