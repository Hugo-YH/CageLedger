import unittest
from unittest.mock import Mock

from server_app.web.monthly_summary import export_monthly_billing_summary


class MonthlySummaryPermissionTests(unittest.TestCase):
    def test_only_admin_or_lock_operator_can_reach_export_validation(self):
        for role, lock_allowed, expected_status in [
            ("admin", False, 400),
            ("admin", True, 400),
            ("room_admin", True, 400),
            ("room_admin", False, 403),
        ]:
            with self.subTest(role=role, lock_allowed=lock_allowed):
                handler = Mock()
                handler.require_user.return_value = {"role": role, "billingLockAllowed": lock_allowed}
                handler.read_json_body.return_value = {"month": "invalid"}
                connect = Mock()
                export_monthly_billing_summary(
                    handler,
                    connect_db=connect,
                    list_quantity_sheets_by_month=Mock(),
                    list_billing_workflows_by_month=Mock(),
                    read_rooms_for_quantity_sheets=Mock(),
                    read_principal_type_by_pi=Mock(),
                    read_applications_by_iacuc=Mock(),
                    audit_event=Mock(),
                    write_audit_events=Mock(),
                    now_iso=Mock(),
                    clean_text=lambda value: value,
                )
                self.assertEqual(handler.send_json.call_args.args[1], expected_status)
                connect.assert_not_called()
                if expected_status == 403:
                    handler.read_json_body.assert_not_called()


if __name__ == "__main__":
    unittest.main()
