import unittest

from server_app.web.dashboard import send_overview


class Handler:
    def __init__(self, validator=""):
        self.headers = {"If-None-Match": validator}
        self.response_headers = {}
        self.payload = None
        self.status = None

    def send_json(self, payload, extra_headers):
        self.payload = payload
        self.status = 200
        self.response_headers.update(extra_headers)

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers[name] = value

    def end_headers(self):
        pass


class DashboardConditionalTests(unittest.TestCase):
    def test_existing_json_and_changed_data_keep_200_response(self):
        payload = {"month": "2026-09", "feedingFeeTotal": {"amount": 0.01}}
        first = Handler()
        send_overview(first, payload)
        self.assertEqual(first.payload, payload)
        self.assertEqual(first.status, 200)
        changed = Handler(first.response_headers["ETag"])
        send_overview(changed, {**payload, "month": "2026-08"})
        self.assertEqual(changed.status, 200)
        self.assertNotEqual(changed.response_headers["ETag"], first.response_headers["ETag"])

    def test_same_payload_revalidates_without_json_body_and_handles_tag_lists(self):
        payload = {"month": "2026-09", "amount": 123.45}
        first = Handler()
        send_overview(first, payload)
        tag = first.response_headers["ETag"]
        for validator in (tag, f'"other", {tag}', tag.removeprefix("W/"), "*"):
            with self.subTest(validator=validator):
                cached = Handler(validator)
                send_overview(cached, dict(reversed(list(payload.items()))))
                self.assertEqual(cached.status, 304)
                self.assertIsNone(cached.payload)
                self.assertEqual(cached.response_headers, {"ETag": tag, "Cache-Control": "no-store"})
