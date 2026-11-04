import base64
import copy
import json
import re
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch
from zipfile import ZipFile

from openpyxl import Workbook

from server_app.domains.researchers import excel, service
from server_app.domains.researchers import repository as repo
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection
from server_app.web import researchers as web

ADMIN = {"id": "admin", "username": "admin", "displayName": "管理员", "role": "admin"}
STAFF = {"id": "staff", "username": "staff", "displayName": "房间管理员", "role": "room_admin"}
HEADERS = ["姓名", "账号", "手机", "邮箱", "部门", "座机"]


def workbook(rows, *, headers=HEADERS, wrong_dimensions=False):
    book = Workbook()
    sheet = book.active
    sheet.title = "成员列表"
    sheet.append(["通讯录说明（不是表头）"])
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    stream = BytesIO()
    book.save(stream)
    book.close()
    content = stream.getvalue()
    if wrong_dimensions:
        output = BytesIO()
        with ZipFile(BytesIO(content)) as source, ZipFile(output, "w") as target:
            for item in source.infolist():
                value = source.read(item.filename)
                if item.filename == "xl/worksheets/sheet1.xml":
                    value = re.sub(rb'<dimension ref="[^"]+"', b'<dimension ref="A1"', value)
                target.writestr(item, value)
        content = output.getvalue()
    return {"filename": "通讯录.xlsx", "data": base64.b64encode(content).decode()}


def initialize(conn):
    repo.ensure_schema(conn)
    conn.execute("""CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,actor_user_id TEXT,actor_username TEXT,actor_display_name TEXT,
        action TEXT,entity_type TEXT,entity_id TEXT,message TEXT,slot_ids TEXT,at TEXT,payload TEXT)""")
    conn.commit()


class ResearcherTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        initialize(self.conn)
        self.addCleanup(self.conn.close)

    def commit(self, file, request_id="request-1"):
        prepared = service.prepare(file)
        preview = service.preview(self.conn, ADMIN, prepared)
        body = {**file, "requestId": request_id, "confirmationToken": preview["confirmationToken"]}
        with self.conn:
            result = service.confirm(self.conn, ADMIN, body, prepared)
        return result, body

    def test_incorrect_excel_dimensions_do_not_hide_members_and_phone_numbers_stay_text(self):
        file = workbook(
            [
                ["甲", "A", 13900000001, None, "实验人员/某课题组", "020-01234567"],
                ["乙", "B", "+852 01234567", "b@example.org", "实验人员", None],
            ],
            wrong_dimensions=True,
        )
        rows = service.prepare(file)[2]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["row"], 3)
        self.assertEqual(rows[0]["values"]["mobile"], "13900000001")
        self.assertEqual(rows[1]["values"]["mobile"], "+852 01234567")

    def test_preview_and_schema_repeat_are_read_only_and_do_not_change_other_tables(self):
        self.conn.execute("CREATE TABLE existing_business(id TEXT PRIMARY KEY,payload TEXT)")
        self.conn.execute("INSERT INTO existing_business VALUES('business','unchanged')")
        before = list(self.conn.iterdump())
        prepared = service.prepare(workbook([["甲", "A", "13900000001"]]))
        preview = service.preview(self.conn, ADMIN, prepared)
        self.assertEqual(preview["counts"], {"created": 1, "updated": 0, "unchanged": 0, "invalid": 0})
        repo.ensure_schema(self.conn)
        repo.ensure_schema(self.conn)
        self.assertEqual(list(self.conn.iterdump()), before)

    def test_duplicate_names_and_phones_keep_distinct_stable_ids_and_updates_preserve_blanks(self):
        self.commit(
            workbook([["同名", "A", "13900000001", "a@example.org"], ["同名", "B", "13900000001", "b@example.org"]])
        )
        old = copy.deepcopy(repo.by_account(self.conn))
        self.assertNotEqual(old["a"]["id"], old["b"]["id"])
        update = workbook([["甲新姓名", "a", None, None, "实验人员/新课题组"]])
        result, _ = self.commit(update, "request-2")
        current = repo.by_account(self.conn)
        self.assertEqual(result["counts"]["updated"], 1)
        self.assertEqual(current["a"]["id"], old["a"]["id"])
        self.assertEqual(current["a"]["account"], "A")
        self.assertEqual(current["a"]["mobile"], "13900000001")
        self.assertEqual(current["a"]["email"], "a@example.org")
        self.assertEqual(current["b"], old["b"])
        self.assertEqual(len(current), 2)

    def test_import_replay_is_exact_and_new_upload_of_same_content_is_unchanged(self):
        file = workbook([["甲", "A", "13900000001"]])
        result, body = self.commit(file)
        before = list(self.conn.iterdump())
        with self.conn:
            replay = service.confirm(self.conn, ADMIN, body, service.prepare(file))
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["counts"], result["counts"])
        self.assertEqual(list(self.conn.iterdump()), before)
        another, _ = self.commit(file, "request-2")
        self.assertEqual(another["counts"], {"created": 0, "updated": 0, "unchanged": 1, "invalid": 0})
        changed = workbook([["甲", "A", "13900000002"]])
        with self.conn, self.assertRaises(StaleWriteError):
            service.confirm(self.conn, ADMIN, body, service.prepare(changed))

    def test_invalid_or_duplicate_account_rows_block_the_entire_import(self):
        for rows in ([["甲", "A"], ["乙", "a"]], [["甲", "A"], ["无账号", None]]):
            with self.subTest(rows=rows):
                file = workbook(rows)
                prepared = service.prepare(file)
                preview = service.preview(self.conn, ADMIN, prepared)
                self.assertFalse(preview["canImport"])
                self.assertGreater(preview["counts"]["invalid"], 0)
                before = list(self.conn.iterdump())
                with self.assertRaises(ValueError), self.conn:
                    service.confirm(
                        self.conn,
                        ADMIN,
                        {**file, "requestId": "bad", "confirmationToken": preview["confirmationToken"]},
                        prepared,
                    )
                self.assertEqual(list(self.conn.iterdump()), before)

    def test_formulas_wrong_type_and_large_workbooks_are_rejected_without_writes(self):
        prepared = service.prepare(workbook([["甲", "A", "=1+1"]]))
        self.assertFalse(service.preview(self.conn, ADMIN, prepared)["canImport"])
        for invalid in (
            {"filename": "x.xls", "data": ""},
            {"filename": "x.xlsx", "data": "broken"},
            {"filename": "x.xlsx", "data": base64.b64encode(b"not-a-workbook").decode()},
        ):
            with self.subTest(invalid=invalid["filename"]), self.assertRaises(ValueError):
                service.prepare(invalid)
        with patch.object(excel, "MAX_ROWS", 1), self.assertRaisesRegex(ValueError, "最多"):
            service.prepare(workbook([["甲", "A"], ["乙", "B"]]))
        self.assertEqual(repo.by_account(self.conn), {})

    def test_stale_preview_and_edit_cannot_overwrite_saved_contacts(self):
        self.commit(workbook([["甲", "A", "13900000001"]]))
        file = workbook([["甲", "A", "13900000002"]])
        prepared = service.prepare(file)
        preview = service.preview(self.conn, ADMIN, prepared)
        old = repo.by_account(self.conn)["a"]
        with self.conn:
            saved = service.update(
                self.conn, ADMIN, old["id"], {"item": {"mobile": ""}, "expectedUpdatedAt": old["updatedAt"]}
            )["item"]
        self.assertEqual(saved["mobile"], "")
        for operation in (
            lambda: service.confirm(
                self.conn,
                ADMIN,
                {**file, "requestId": "stale", "confirmationToken": preview["confirmationToken"]},
                prepared,
            ),
            lambda: service.update(
                self.conn, ADMIN, old["id"], {"item": {"mobile": "13900000003"}, "expectedUpdatedAt": old["updatedAt"]}
            ),
        ):
            before = list(self.conn.iterdump())
            with self.assertRaises(StaleWriteError), self.conn:
                operation()
            self.assertEqual(list(self.conn.iterdump()), before)

    def test_audit_failure_rolls_back_all_people_and_import_request(self):
        file = workbook([["甲", "A"], ["乙", "B"]])
        prepared = service.prepare(file)
        preview = service.preview(self.conn, ADMIN, prepared)
        before = list(self.conn.iterdump())
        with patch.object(service, "write_audit_events", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError), self.conn:
                service.confirm(
                    self.conn,
                    ADMIN,
                    {**file, "requestId": "rollback", "confirmationToken": preview["confirmationToken"]},
                    prepared,
                )
        self.assertEqual(list(self.conn.iterdump()), before)

    def test_search_pagination_and_department_lookup_are_read_only_and_literal(self):
        self.commit(
            workbook(
                [
                    ["甲_测试", "A", "13900000001", None, "部门A"],
                    ["甲其他", "B", "13900000002", None, "部门B"],
                    ["乙", "C", None, "c@example.org", "部门A"],
                ]
            )
        )
        before = list(self.conn.iterdump())
        self.assertEqual(repo.list_items(self.conn, {"q": "甲_"})["page"]["total"], 1)
        self.assertEqual(repo.list_items(self.conn, {"q": "13900000002"})["items"][0]["account"], "B")
        page = repo.list_items(self.conn, {"department": "部门A", "limit": "1", "offset": "1"})
        self.assertEqual(page["page"], {"limit": 1, "offset": 1, "total": 2})
        self.assertEqual(page["departments"], ["部门A", "部门B"])
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(list(self.conn.iterdump()), before)

    def test_all_member_changes_and_import_metadata_are_audited(self):
        self.commit(workbook([["甲", "A", "13900000001"]]))
        old = repo.by_account(self.conn)["a"]
        with self.conn:
            service.update(
                self.conn,
                ADMIN,
                old["id"],
                {"item": {"telephone": "020-01234567"}, "expectedUpdatedAt": old["updatedAt"]},
            )
        events = [json.loads(row[0]) for row in self.conn.execute("SELECT payload FROM audit_events ORDER BY rowid")]
        self.assertEqual(
            [event["action"] for event in events],
            ["researcher.created", "researcher_directory.imported", "researcher.updated"],
        )
        self.assertEqual(events[-1]["before"], old)
        self.assertEqual(events[-1]["after"]["id"], old["id"])
        self.assertEqual(events[-1]["actorUserId"], ADMIN["id"])

    def test_http_authentication_and_admin_authorization_precede_file_or_database_access(self):
        for actor, method, path in (
            (None, "GET", "/api/researchers"),
            (STAFF, "POST", "/api/researchers/import/preview"),
            (STAFF, "POST", "/api/researchers/import"),
            (STAFF, "PUT", "/api/researchers/id"),
        ):
            handler = Mock(path=path)
            handler.require_user.return_value = actor
            with patch.object(web, "connect_db", side_effect=AssertionError("unauthorized DB read")):
                self.assertTrue(web.handle(handler, method, path))
            handler.read_json_body.assert_not_called()
            if actor:
                self.assertEqual(handler.send_json.call_args.args[1], 403)
        for actor in (ADMIN, STAFF):
            handler = Mock(path="/api/researchers")
            handler.require_user.return_value = actor
            with patch.object(web, "connect_db", return_value=self.conn):
                self.assertTrue(web.handle(handler, "GET", "/api/researchers"))
            self.assertEqual(handler.send_json.call_args.args[0]["items"], [])


class ResearcherConcurrencyTests(unittest.TestCase):
    def test_only_one_of_two_reviewed_imports_can_commit_for_the_same_account(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "contacts.sqlite"
            with closing(sqlite3.connect(path)) as conn:
                initialize(conn)
            prepared = [service.prepare(workbook([["甲", "A", f"1390000000{index}"]])) for index in (1, 2)]
            with closing(sqlite3.connect(path)) as conn:
                previews = [service.preview(conn, ADMIN, value) for value in prepared]
            first_read, release, second_begin, second_read = (threading.Event() for _ in range(4))
            original = repo.by_account

            def observed(conn):
                value = original(conn)
                if threading.current_thread().name == "first":
                    first_read.set()
                    if not release.wait(5):
                        raise TimeoutError("first writer not released")
                else:
                    second_read.set()
                return value

            def run(index):
                threading.current_thread().name = "first" if index == 0 else "second"
                with sqlite3.connect(path, factory=ClosingConnection, timeout=5) as conn:
                    if index:
                        conn.set_trace_callback(lambda sql: second_begin.set() if sql == "BEGIN IMMEDIATE" else None)
                    body = {"requestId": str(index), "confirmationToken": previews[index]["confirmationToken"]}
                    return service.confirm(conn, ADMIN, body, prepared[index])

            with patch.object(repo, "by_account", side_effect=observed), ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(run, 0)
                try:
                    self.assertTrue(first_read.wait(3))
                    second = pool.submit(run, 1)
                    self.assertTrue(second_begin.wait(3))
                    self.assertFalse(second_read.wait(0.1))
                finally:
                    release.set()
                first.result(timeout=5)
                with self.assertRaises(StaleWriteError):
                    second.result(timeout=5)
            with closing(sqlite3.connect(path)) as conn:
                self.assertEqual(repo.by_account(conn)["a"]["mobile"], "13900000001")
                self.assertEqual(conn.execute("SELECT count(*) FROM researcher_imports").fetchone()[0], 1)
