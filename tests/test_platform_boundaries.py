import sqlite3
import unittest

from server_app.persistence import SchemaRegistry, SchemaStep
from server_app.web import JsonResponse, Router


class SchemaRegistryTests(unittest.TestCase):
    def test_schema_steps_run_in_registration_order(self):
        events = []
        registry = SchemaRegistry(
            [
                SchemaStep("base", lambda conn: events.append("base")),
                SchemaStep("indexes", lambda conn: events.append("indexes")),
            ]
        )
        with sqlite3.connect(":memory:") as conn:
            registry.apply(conn)
        self.assertEqual(events, ["base", "indexes"])

    def test_schema_step_names_are_unique(self):
        with self.assertRaisesRegex(ValueError, "must be unique"):
            SchemaRegistry([SchemaStep("base", lambda conn: None), SchemaStep("base", lambda conn: None)])


class RouterTests(unittest.TestCase):
    def test_router_matches_method_and_named_path_parameters(self):
        router = Router()
        router.add("GET", r"/api/items/(?P<item_id>[^/]+)", lambda context, params: JsonResponse(params))
        response = router.dispatch("GET", "/api/items/item-1", object())
        self.assertEqual(response.payload, {"item_id": "item-1"})
        self.assertIsNone(router.dispatch("POST", "/api/items/item-1", object()))


if __name__ == "__main__":
    unittest.main()
