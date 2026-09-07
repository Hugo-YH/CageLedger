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
            "CAGELEDGER_LOGIN_FAILURE_LIMIT": "3",
            "CAGELEDGER_LOGIN_IP_FAILURE_LIMIT": "100",
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
            cls.server.wait(timeout=5)
        cls.server.stderr.close()
        cls.temp_dir.cleanup()

    def test_health_and_unauthenticated_contracts(self):
        status, payload, headers = request_json(self.base_url, "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn("system", payload)
        self.assertIn("Server-Timing", headers)
        self.assertRegex(headers["X-Request-ID"], r"^[0-9a-f]{16}$")
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(self.base_url, "/api/users")
        self.assertEqual(context.exception.code, 401)
        self.assertEqual(json.load(context.exception), {"error": "请先登录"})

    def test_login_invalid_body_returns_json_error(self):
        for raw in (b"null", b"[]", b"\xff", b"{"):
            request = urllib.request.Request(
                self.base_url + "/api/auth/login", data=raw, headers={"Content-Type": "application/json"}
            )
            with self.subTest(raw=raw), self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(request, timeout=5)
            with context.exception as response:
                self.assertEqual(response.code, 400)
                self.assertIsInstance(json.load(response)["error"], str)

    def test_write_requests_enforce_origin(self):
        request = urllib.request.Request(
            self.base_url + "/api/auth/login",
            data=b'{"username":"admin","password":"admin123"}',
            headers={"Content-Type": "application/json", "Origin": "https://evil.example"},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=5)
        with context.exception as response:
            self.assertEqual(response.code, 403)
            self.assertEqual(json.load(response), {"error": "请求来源不受信任"})

        request = urllib.request.Request(
            self.base_url + "/api/auth/login",
            data=b'{"username":"admin","password":"admin123"}',
            headers={"Content-Type": "application/json", "Origin": self.base_url},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], self.base_url)
            self.assertEqual(response.headers["Access-Control-Allow-Credentials"], "true")

    def test_login_failures_are_rate_limited(self):
        for _ in range(3):
            with self.assertRaises(urllib.error.HTTPError) as context:
                request_json(
                    self.base_url,
                    "/api/auth/login",
                    method="POST",
                    body={"username": "rate-limit-probe", "password": "wrong"},
                )
            self.assertEqual(context.exception.code, 401)
            context.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                "/api/auth/login",
                method="POST",
                body={"username": "rate-limit-probe", "password": "wrong"},
            )
        with context.exception as response:
            self.assertEqual(response.code, 429)
            self.assertGreaterEqual(int(response.headers["Retry-After"]), 1)
            self.assertEqual(json.load(response), {"error": "登录失败次数过多，请稍后重试"})

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
            "/api/billing-settlement-candidates?limit=5&offset=0": {"items", "page"},
            "/api/filter-options?list=settlement-candidates&column=month": {"items"},
            "/api/billing-workflows?limit=5&offset=0": {"items", "page"},
            "/api/reimbursement-records?limit=5&offset=0": {"items", "page"},
            "/api/reimbursement-ledger/obligations?limit=5&offset=0": {"items", "page"},
            "/api/reimbursement-ledger/claims?limit=5&offset=0": {"items", "page"},
            "/api/reimbursement-ledger/legacy-records?limit=5&offset=0": {"items", "page"},
            "/api/principal-identities": {"items"},
            "/api/iacuc-index/expiry": {"items"},
            "/api/users": {"users"},
        }
        for path, keys in expected.items():
            with self.subTest(path=path):
                response_status, payload, _ = request_json(self.base_url, path, opener=self.opener)
                self.assertEqual(response_status, 200)
                self.assertTrue(keys.issubset(payload.keys()))

    def test_release_announcement_acknowledgement_is_persisted_per_user_and_version(self):
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.opener,
        )
        version = "api-contract-1.0.0"
        status, initial, _ = request_json(self.base_url, f"/api/release-announcements/{version}", opener=self.opener)
        self.assertEqual(status, 200)
        self.assertEqual(initial, {"version": version, "acknowledged": False})

        status, acknowledged, _ = request_json(
            self.base_url,
            f"/api/release-announcements/{version}/acknowledge",
            method="POST",
            opener=self.opener,
        )
        self.assertEqual(status, 200)
        self.assertEqual(acknowledged, {"version": version, "acknowledged": True})

        _, persisted, _ = request_json(self.base_url, f"/api/release-announcements/{version}", opener=self.opener)
        self.assertEqual(persisted, acknowledged)

        request_json(
            self.base_url,
            "/api/users",
            method="POST",
            body={
                "username": "release-status-user",
                "password": "release-status-password",
                "displayName": "版本确认测试账号",
                "role": "room_admin",
                "roomIds": [],
            },
            opener=self.opener,
        )
        other_user = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "release-status-user", "password": "release-status-password"},
            opener=other_user,
        )
        _, other_status, _ = request_json(self.base_url, f"/api/release-announcements/{version}", opener=other_user)
        self.assertEqual(other_status, {"version": version, "acknowledged": False})

    def test_claim_api_rejects_cross_claim_funding_line(self):
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.opener,
        )
        endpoint = "/api/reimbursement-ledger/claims"
        body = {
            "documentNumber": "ownership-api-test",
            "fundingLines": [{"fundBookNo": "F1", "fundingOwner": "测试负责人", "reimbursementAmount": 80}],
        }
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                endpoint,
                method="POST",
                body={**body, "fundingLines": [{**body["fundingLines"][0], "reimbursementAmount": "NaN"}]},
                opener=self.opener,
            )
        with context.exception as response:
            self.assertEqual(response.code, 400)
            self.assertEqual(json.load(response), {"error": "报销金额格式无效"})
        _, created, _ = request_json(self.base_url, endpoint, method="POST", body=body, opener=self.opener)
        original = created["item"]
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                endpoint,
                method="POST",
                opener=self.opener,
                body={**body, "fundingLines": [{**original["fundingLines"][0], "reimbursementAmount": 1}]},
            )
        with context.exception as response:
            self.assertEqual(response.code, 403)
            self.assertEqual(json.load(response), {"error": "经费明细不属于当前报销单"})
        _, detail, _ = request_json(self.base_url, endpoint + "/" + original["id"], opener=self.opener)
        self.assertEqual(detail["item"], original)

    def test_monthly_billing_summary_requires_available_quantity_sheets(self):
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.opener,
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                "/api/billing-monthly-summary/export",
                method="POST",
                body={"month": "2026-06"},
                opener=self.opener,
            )
        self.assertEqual(context.exception.code, 400)
        self.assertEqual(json.load(context.exception), {"error": "该月份没有已保存的数量统计表"})

        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                "/api/billing-monthly-summary/export",
                method="POST",
                body={"month": "2026/06"},
                opener=self.opener,
            )
        self.assertEqual(context.exception.code, 400)
        self.assertEqual(json.load(context.exception), {"error": "结算月份格式应为 YYYY-MM"})

    def test_intake_batch_actions_process_multiple_batches_in_one_request(self):
        request_json(
            self.base_url,
            "/api/auth/login",
            method="POST",
            body={"username": "admin", "password": "admin123"},
            opener=self.opener,
        )
        room_name = "P2 批量接收房间"
        request_json(
            self.base_url,
            "/api/rooms",
            method="POST",
            body={"item": {"id": "room-p2-bulk", "name": room_name}},
            opener=self.opener,
        )
        batch_ids = ["batch-p2-bulk-1", "batch-p2-bulk-2"]
        for index, batch_id in enumerate(batch_ids, start=1):
            request_json(
                self.base_url,
                "/api/intake-batches",
                method="POST",
                body={
                    "item": {
                        "id": batch_id,
                        "batchNo": f"P2-{index}",
                        "supplier": "测试供应商",
                        "iacuc": "Z2026001",
                        "pi": "测试负责人",
                        "owner": "测试实验员",
                        "roomName": room_name,
                        "intakeDate": "2026-08-10",
                        "status": "draft",
                        "quantity": 2,
                        "finalCardCount": 2,
                        "remainingCardCount": 2,
                        "receipts": [],
                    }
                },
                opener=self.opener,
            )
        status, printed, _ = request_json(
            self.base_url,
            "/api/intake-batches/mark-printed",
            method="POST",
            body={"ids": batch_ids},
            opener=self.opener,
        )
        self.assertEqual(status, 200)
        self.assertEqual([item["status"] for item in printed["items"]], ["printed", "printed"])
        status, received, _ = request_json(
            self.base_url,
            "/api/intake-batches/confirm-receipt",
            method="POST",
            body={"ids": batch_ids, "actualReceiptDate": "2026-08-10"},
            opener=self.opener,
        )
        self.assertEqual(status, 201)
        self.assertEqual([item["status"] for item in received["batches"]], ["received", "received"])
        self.assertEqual(len(received["tasks"]), 0)
        sheet_ids = ["sheet-p2-bulk-1", "sheet-p2-bulk-2"]
        for index, sheet_id in enumerate(sheet_ids, start=1):
            request_json(
                self.base_url,
                "/api/quantity-sheets",
                method="POST",
                body={
                    "sheet": {
                        "id": sheet_id,
                        "month": "2026-08",
                        "iacuc": f"Z20260{index:02d}",
                        "roomId": "room-p2-bulk",
                        "roomName": room_name,
                        "pi": "测试负责人",
                        "rows": [],
                    }
                },
                opener=self.opener,
            )
        status, print_data, _ = request_json(
            self.base_url,
            "/api/quantity-sheets/print-data",
            method="POST",
            body={"ids": sheet_ids},
            opener=self.opener,
        )
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in print_data["items"]], sheet_ids)


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
