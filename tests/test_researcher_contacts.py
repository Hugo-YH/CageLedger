import sqlite3
import unittest
from unittest.mock import Mock, patch

from server_app.domains.researchers import contacts, repository
from server_app.domains.researchers.fields import empty_fields
from server_app.web import researchers as web

STAFF = {"id": "staff", "role": "room_admin"}


class ResearcherContactTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        repository.ensure_schema(self.conn)
        self.addCleanup(self.conn.close)

    def add(self, account, name, **fields):
        repository.put(
            self.conn,
            {
                **empty_fields(),
                "id": account,
                "account": account,
                "name": name,
                "createdAt": "created",
                "updatedAt": "updated",
                **fields,
            },
        )
        self.conn.commit()

    def test_exact_names_aliases_order_and_mobile_then_telephone_without_writes(self):
        self.add("A", "张三", mobile="13800000001", telephone="020-12345678", alias="实验助手")
        self.add("B", "李四", telephone="020-87654321")
        before = list(self.conn.iterdump())
        result = contacts.resolve(self.conn, STAFF, {"names": [" 李四 ", "张三", "实验助手", "张三"]})
        self.assertEqual(
            result["items"],
            [
                {"name": "李四", "status": "matched", "phone": "020-87654321"},
                {"name": "张三", "status": "matched", "phone": "13800000001"},
                {"name": "实验助手", "status": "matched", "phone": "13800000001"},
            ],
        )
        self.assertEqual(list(self.conn.iterdump()), before)

    def test_duplicate_names_and_alias_collisions_never_choose_the_first_person(self):
        self.add("A", "同名", mobile="13800000001", alias="别名冲突")
        self.add("B", "同名", mobile="13800000002")
        self.add("C", "别名冲突", mobile="13800000003")
        self.add("D", "无电话")
        result = contacts.resolve(self.conn, STAFF, {"names": ["同名", "别名冲突", "无电话", "同", "不存在"]})
        self.assertEqual(
            result["items"],
            [
                {"name": "同名", "status": "ambiguous", "phone": ""},
                {"name": "别名冲突", "status": "ambiguous", "phone": ""},
                {"name": "无电话", "status": "missing_phone", "phone": ""},
                {"name": "同", "status": "not_found", "phone": ""},
                {"name": "不存在", "status": "not_found", "phone": ""},
            ],
        )

    def test_invalid_or_oversized_requests_are_rejected_before_querying(self):
        for body in (
            None,
            [],
            {},
            {"names": []},
            {"names": "张三"},
            {"names": [None]},
            {"names": [" "]},
            {"names": ["名" * 201]},
            {"names": ["张三"] * 201},
        ):
            with self.subTest(body=body), patch.object(repository, "contact_candidates") as query:
                with self.assertRaises(ValueError):
                    contacts.resolve(self.conn, STAFF, body)
                query.assert_not_called()

    def test_endpoint_allows_logged_in_readers_but_checks_login_before_body_or_database(self):
        path = "/api/researchers/contacts/resolve"
        handler = Mock(path=path)
        handler.require_user.return_value = None
        with patch.object(web, "connect_db", side_effect=AssertionError("anonymous access")):
            self.assertTrue(web.handle(handler, "POST", path))
        handler.read_json_body.assert_not_called()
        self.add("A", "张三", mobile="13800000001")
        before = list(self.conn.iterdump())
        for role in ("admin", "room_admin", "researcher"):
            handler = Mock(path=path)
            handler.require_user.return_value = {"id": role, "role": role}
            handler.read_json_body.return_value = {"names": ["张三"]}
            with patch.object(web, "connect_db", return_value=self.conn):
                self.assertTrue(web.handle(handler, "POST", path))
            self.assertEqual(
                handler.send_json.call_args.args,
                ({"items": [{"name": "张三", "status": "matched", "phone": "13800000001"}]},),
            )
        self.assertEqual(list(self.conn.iterdump()), before)
