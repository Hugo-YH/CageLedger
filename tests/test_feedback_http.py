"""Feedback HTTP authentication and immutable-route tests."""

import unittest
from unittest.mock import patch

from server_app.web import feedback as web
from tests.feedback_fixtures import ACTOR, ADMIN, FeedbackFixture, submission


class FeedbackHttpTests(FeedbackFixture, unittest.TestCase):
    def test_http_authentication_admin_guard_and_immutable_routes(self):
        class Handler:
            path = "/api/feedback"
            user = ACTOR
            status = None
            payload = None

            def require_user(self):
                if not self.user:
                    self.send_json({"error": "请登录"}, 401)
                return self.user

            def send_json(self, payload, status=200):
                self.status, self.payload = status, payload

            def read_json_body(self):
                return submission()

        handler = Handler()
        with patch.object(web, "connect_db", self.connect):
            handler.user = None
            self.assertTrue(web.handle(handler, "GET", "/api/feedback"))
            self.assertEqual(handler.status, 401)
            handler.user = ACTOR
            web.handle(handler, "GET", "/api/feedback/integration")
            self.assertEqual(handler.status, 403)
            web.handle(handler, "POST", "/api/feedback")
            item = handler.payload["item"]
            web.handle(handler, "PUT", "/api/feedback/" + item["id"])
            self.assertEqual(handler.status, 404)
            handler.user = ADMIN
            handler.path = "/api/feedback/" + item["id"]
            web.handle(handler, "GET", handler.path)
            self.assertEqual(handler.payload["item"]["description"], "详细描述")
