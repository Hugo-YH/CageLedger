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

ROOT = Path(__file__).resolve().parent.parent


class ApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="cageledger-api-")
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
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
        cls.temp_dir.cleanup()

    def test_health_and_unauthenticated_contracts(self):
        status, payload, headers = request_json(self.base_url, "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn("system", payload)
        self.assertIn("Server-Timing", headers)
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(self.base_url, "/api/users")
        self.assertEqual(context.exception.code, 401)
        self.assertEqual(json.load(context.exception), {"error": "请先登录"})

    def test_authenticated_list_shapes(self):
        status, login, _ = request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.opener,
        )
        self.assertEqual(status, 200)
        self.assertEqual(login["user"]["role"], "admin")
        expected = {
            "/api/bootstrap?scope=summary": {"rooms", "racks", "slots", "occupancies", "roomSummaries"},
            "/api/intake-batches?limit=5&offset=0": {"items", "page"},
            "/api/placement-tasks?limit=5&offset=0": {"items", "page"},
            "/api/quantity-sheets?limit=5&offset=0": {"items", "page"},
            "/api/billing-settlement-candidates?limit=5&offset=0": {"items", "page", "filterOptions"},
            "/api/billing-workflows?limit=5&offset=0": {"items", "page"},
            "/api/reimbursement-records?limit=5&offset=0": {"items", "page"},
            "/api/principal-identities": {"items"},
            "/api/users": {"users"},
        }
        for path, keys in expected.items():
            with self.subTest(path=path):
                response_status, payload, _ = request_json(self.base_url, path, opener=self.opener)
                self.assertEqual(response_status, 200)
                self.assertTrue(keys.issubset(payload.keys()))


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
