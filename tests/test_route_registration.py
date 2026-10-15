import inspect
import json
import re
import unittest
from collections import Counter
from unittest.mock import patch

from scripts.api_inventory import CATALOG, registered_routes
from server_app.web.handler_support import HandlerSupportMixin
from server_app.web.read_actions import ReadActionsMixin
from server_app.web.route_registration import DELEGATES, register_domain_routes
from server_app.web.route_specs import ROUTE_GROUPS
from server_app.web.router import HANDLED, Router
from server_app.web.router_registry import API_ROUTER
from server_app.web.write_actions import WriteActionsMixin
from server_app.web.write_routes import WriteRoutesMixin


class RoutingContext(HandlerSupportMixin):
    def __init__(self, path):
        self.path = path + "?findingId=finding-1"
        self.calls = []

    def __getattr__(self, name):
        def record(**params):
            self.calls.append((name, params))

        return record


class RouteRegistrationTests(unittest.TestCase):
    def test_runtime_registration_exactly_covers_catalog_without_duplicates(self):
        catalog = json.loads(CATALOG.read_text())
        expected = {(entry["method"], entry["path"]) for group in catalog["groups"] for entry in group["endpoints"]}
        actual = API_ROUTER.registered_paths()
        self.assertEqual(set(actual), expected)
        self.assertEqual(set(actual), set(registered_routes()))
        self.assertTrue(all(count == 1 for count in Counter(actual).values()))

    def test_each_domain_endpoint_reaches_its_own_action_before_generic_id_routes(self):
        router = Router()
        register_domain_routes(router, early=True)
        register_domain_routes(router)

        def delegate(name):
            def record(handler, *args):
                handler.calls.append((name, args))
                return True

            return record

        with patch.dict(DELEGATES, {name: delegate(name) for name in DELEGATES}):
            for specs in ROUTE_GROUPS.values():
                for spec in specs:
                    for template in spec["paths"]:
                        with self.subTest(method=spec["method"], path=template):
                            path = re.sub(r"\{\w+\}", "record-%E6%B5%8B%E8%AF%95", template)
                            context = RoutingContext(path)
                            self.assertIs(router.dispatch(spec["method"], path, context), HANDLED)
                            self.assertEqual(len(context.calls), 1)
                            self.assertEqual(context.calls[0][0], spec.get("delegate", spec.get("action")))
                            if "action" in spec:
                                cls = ReadActionsMixin if spec["method"] == "GET" else WriteActionsMixin
                                signature = inspect.signature(getattr(cls, spec["action"]))
                                signature.bind(context, **context.calls[0][1])

    def test_identifiers_keep_one_decode_and_reject_encoded_path_separators(self):
        for encoded, expected in (("%E6%B5%8B%E8%AF%95", "测试"), ("a%252Fb", "a%2Fb")):
            path = "/api/billing-workflows/attachments/" + encoded
            context = RoutingContext(path)
            self.assertIs(API_ROUTER.dispatch("GET", path, context), HANDLED)
            self.assertEqual(
                context.calls, [("get_billing_workflow_attachment_download", {"path": path, "attachment_id": expected})]
            )
        for suffix in ("", "a/b", "a%2Fb"):
            context = RoutingContext("/api/billing-workflows/attachments/" + suffix)
            self.assertIsNone(API_ROUTER.dispatch("GET", context.path.split("?")[0], context))
            self.assertEqual(context.calls, [])

    def test_actions_that_send_responses_never_fall_through_or_send_twice(self):
        context = RoutingContext("/api/quantity-sheets/print-data")
        self.assertTrue(API_ROUTER.handle("POST", "/api/quantity-sheets/print-data", context))
        self.assertEqual(
            context.calls, [("post_quantity_sheets_print_data", {"path": "/api/quantity-sheets/print-data"})]
        )
        self.assertFalse(API_ROUTER.handle("PATCH", "/api/quantity-sheets/print-data", context))
        self.assertFalse(API_ROUTER.handle("GET", "/api/no-such-endpoint", context))

    def test_original_regex_routes_keep_first_match_even_when_handler_returns_none(self):
        router = Router()
        calls = []
        router.add("GET", "/api/compat", lambda handler, params: calls.append("first"))
        router.add("GET", "/api/compat", lambda handler, params: calls.append("second"))
        self.assertIsNone(router.dispatch("GET", "/api/compat", object()))
        self.assertEqual(calls, ["first"])

    def test_all_writes_validate_origin_before_dispatch_and_keep_404(self):
        for method in ("POST", "PUT", "DELETE"):
            handler = WriteRoutesMixin()
            handler.path = "/api/no-such-endpoint?unused=1"
            handler.require_safe_origin = lambda: False
            with patch.object(API_ROUTER, "handle") as dispatch:
                getattr(handler, "do_" + method)()
                dispatch.assert_not_called()
            handler.require_safe_origin = lambda: True
            handler.send_error = lambda status: self.assertEqual(status, 404)
            with patch.object(API_ROUTER, "handle", return_value=False) as dispatch:
                getattr(handler, "do_" + method)()
                dispatch.assert_called_once_with(method, "/api/no-such-endpoint", handler)


if __name__ == "__main__":
    unittest.main()
