import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from server_app.domains.administration.system import (
    parse_proc_cpuinfo,
    parse_proc_meminfo,
    system_environment,
)

ROOT = Path(__file__).resolve().parent.parent


class SystemEnvironmentParsingTests(unittest.TestCase):
    def test_parse_proc_cpuinfo_extracts_first_model_name(self):
        text = "\n".join(
            [
                "processor : 0",
                "model name : Intel(R) Core(TM) i9-14900K",
                "",
                "processor : 1",
                "model name : Intel(R) Core(TM) i9-14900K",
            ]
        )
        self.assertEqual(parse_proc_cpuinfo(text), "Intel(R) Core(TM) i9-14900K")

    def test_parse_proc_cpuinfo_missing_model(self):
        self.assertEqual(parse_proc_cpuinfo("processor : 0\n"), "")

    def test_parse_proc_meminfo_converts_kib_to_bytes(self):
        text = "MemTotal:       16777216 kB\nMemFree:         8000000 kB\n"
        self.assertEqual(parse_proc_meminfo(text), 16777216 * 1024)

    def test_parse_proc_meminfo_missing_total(self):
        self.assertEqual(parse_proc_meminfo("MemFree: 1000 kB\n"), 0)

    def test_system_environment_shape(self):
        payload = system_environment()
        self.assertEqual(
            set(payload),
            {"cpu", "memory", "system", "python", "database"},
        )
        self.assertEqual(set(payload["cpu"]), {"model", "architecture", "cores", "load"})
        self.assertGreaterEqual(payload["cpu"]["cores"], 1)
        self.assertEqual(len(payload["cpu"]["load"]), 3)
        self.assertEqual(set(payload["memory"]), {"totalBytes"})
        self.assertEqual(
            set(payload["system"]),
            {"platform", "release", "version", "hostname", "container"},
        )
        self.assertEqual(
            set(payload["python"]),
            {"version", "implementation", "compiler", "executable", "bits64"},
        )
        self.assertTrue(payload["python"]["version"])
        self.assertIsInstance(payload["python"]["bits64"], bool)
        self.assertEqual(set(payload["database"]), {"ok", "journalMode", "sizeBytes", "tables", "path"})
        self.assertIsInstance(payload["database"]["ok"], bool)


class SystemEnvironmentApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="cageledger-env-")
        cls.port = available_port()
        env = {
            **os.environ,
            "CAGELEDGER_HOST": "127.0.0.1",
            "CAGELEDGER_PORT": str(cls.port),
            "CAGELEDGER_DB": str(Path(cls.temp_dir.name) / "cageledger.sqlite"),
            "CAGELEDGER_IACUC_INDEX": str(Path(cls.temp_dir.name) / "iacuc-index.json"),
            "CAGELEDGER_DEV_ASSETS": "1",
        }
        cls.server = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        wait_for_server(cls.server, cls.base_url)
        cls.admin_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
        cls.temp_dir.cleanup()

    def test_environment_requires_login(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(self.base_url, "/api/system/environment")
        self.assertEqual(context.exception.code, 401)

    def test_admin_reads_environment(self):
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.admin_opener,
        )
        status, payload, _ = request_json(self.base_url, "/api/system/environment", opener=self.admin_opener)
        self.assertEqual(status, 200)
        self.assertEqual(
            set(payload),
            {"cpu", "memory", "system", "python", "database"},
        )
        self.assertEqual(set(payload["cpu"]), {"model", "architecture", "cores", "load"})
        self.assertEqual(len(payload["cpu"]["load"]), 3)
        self.assertEqual(set(payload["memory"]), {"totalBytes"})
        self.assertEqual(
            set(payload["system"]),
            {"platform", "release", "version", "hostname", "container"},
        )
        self.assertEqual(
            set(payload["python"]),
            {"version", "implementation", "compiler", "executable", "bits64"},
        )
        self.assertEqual(set(payload["database"]), {"ok", "journalMode", "sizeBytes", "tables", "path"})
        self.assertTrue(payload["database"]["ok"])
        self.assertTrue(payload["database"]["journalMode"])
        self.assertGreaterEqual(payload["database"]["tables"], 0)
        self.assertIsNotNone(payload["database"]["sizeBytes"])

    def test_room_admin_is_rejected(self):
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.admin_opener,
        )
        request_json(
            self.base_url,
            "/api/users",
            method="POST",
            body={
                "username": "env-room-admin",
                "password": "room123",
                "displayName": "环境测试员",
                "role": "room_admin",
                "roomIds": [],
            },
            opener=self.admin_opener,
        )
        room_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "env-room-admin", "password": "room123"},
            opener=room_opener,
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(self.base_url, "/api/system/environment", opener=room_opener)
        self.assertEqual(context.exception.code, 403)
        self.assertEqual(json.load(context.exception), {"error": "需要管理员权限"})


def available_port():
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return candidate.getsockname()[1]


def wait_for_server(process, base_url):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            details = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"CageLedger test server exited early: {details}")
        try:
            request_json(base_url, "/api/health")
            return
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    raise RuntimeError("CageLedger test server did not become ready")


def request_json(base_url, path, method="GET", body=None, opener=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    open_request = opener.open if opener else urllib.request.urlopen
    response = open_request(request, timeout=5)
    with response:
        return response.status, json.load(response), response.headers


if __name__ == "__main__":
    unittest.main()
