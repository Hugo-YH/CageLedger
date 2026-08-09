import unittest

from server_app.web import route_matchers


class RouteMatcherTests(unittest.TestCase):
    def test_decodes_single_segment_and_rejects_nested_values(self):
        self.assertEqual(route_matchers.quantity_sheet_route("/api/quantity-sheets/%E7%AC%BC%201"), "笼 1")
        self.assertIsNone(route_matchers.quantity_sheet_route("/api/quantity-sheets/a%2Fb"))
        self.assertIsNone(route_matchers.quantity_sheet_route("/api/quantity-sheets/"))

    def test_matches_composite_routes_without_accepting_other_suffixes(self):
        self.assertEqual(route_matchers.billing_workflow_lines_route("/api/billing-workflows/w1/lines"), "w1")
        self.assertIsNone(route_matchers.billing_workflow_lines_route("/api/billing-workflows/w1/events"))
        self.assertEqual(route_matchers.placement_task_action_route("/api/placement-tasks/t1/move-in", "move-in"), "t1")

    def test_matches_inspection_attachment_with_explicit_query_value(self):
        self.assertEqual(
            route_matchers.animal_inspection_attachment_upload_route("/api/animal-inspections/i1/attachments", "f1"),
            ("i1", "f1"),
        )
        self.assertEqual(
            route_matchers.animal_inspection_attachment_upload_route("/api/animal-inspections/i%2F1/attachments", "f1"),
            (None, None),
        )
        self.assertEqual(
            route_matchers.animal_inspection_attachment_upload_route("/api/animal-inspections/i1/attachments", ""),
            (None, None),
        )

    def test_matches_reimbursement_and_inspection_actions(self):
        self.assertEqual(
            route_matchers.reimbursement_claim_attachment_upload_route(
                "/api/reimbursement-ledger/claims/c1/attachments"
            ),
            "c1",
        )
        self.assertEqual(
            route_matchers.animal_inspection_finding_action_route(
                "/api/animal-inspection-findings/f1/resolve", "resolve"
            ),
            "f1",
        )
