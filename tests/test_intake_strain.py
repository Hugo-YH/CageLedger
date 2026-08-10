import unittest

from server_app.web.intake_strain import intake_strain_standardize_handler


class FakeHandler:
    def __init__(self, user, body=None, error=None):
        self.user = user
        self.body = body or {}
        self.error = error

    def current_user(self):
        return self.user

    def read_json_body(self):
        if self.error:
            raise self.error
        return self.body


class IntakeStrainHandlerTests(unittest.TestCase):
    def test_requires_login(self):
        response = intake_strain_standardize_handler(FakeHandler(None), {})
        self.assertEqual(response.status, 401)
        self.assertEqual(response.payload, {"error": "请先登录"})

    def test_resolves_full_mgi_index_server_side(self):
        response = intake_strain_standardize_handler(FakeHandler({"id": "user-1"}, {"strain": "B6.Cg-Foxn1<nu>/J"}), {})
        self.assertEqual(response.status, 200)
        self.assertEqual(response.payload, {"item": "B6.Cg-Foxn1<nu>/J"})

    def test_rejects_invalid_json(self):
        response = intake_strain_standardize_handler(
            FakeHandler({"id": "user-1"}, error=ValueError("请求体必须是 JSON")), {}
        )
        self.assertEqual(response.status, 400)
        self.assertEqual(response.payload, {"error": "请求体必须是 JSON"})


if __name__ == "__main__":
    unittest.main()
