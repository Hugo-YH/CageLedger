import unittest
from unittest import mock

from server_app.domains.intake.ai_parse import _normalize_payload, ai_parse_intake_message
from server_app.domains.intake.strain_standard import abbreviate_supplier, standardize_strain
from server_app.services.ai import deepseek_chat_json


class IntakeAiParseNormalizationTest(unittest.TestCase):
    def test_normalizes_deepseek_payload(self):
        result = _normalize_payload(
            {
                "purchaseOrderNo": "C2026043035083",
                "batchNo": "（Z2025050）2026042903",
                "iacuc": "",
                "supplier": "广东南模生物科技有限公司",
                "strainRaw": "c57",
                "species": "mouse",
                "sex": "雌性",
                "quantity": "70",
                "roomName": "8101",
                "intakeDate": "2026-05-13",
                "husbandryDays": "30",
            }
        )
        self.assertEqual(result["iacuc"], "Z2025050")
        self.assertEqual(result["batchNo"], "（Z2025050）2026042903")
        self.assertEqual(result["quantity"], 70)
        self.assertEqual(result["roomName"], "8101")
        self.assertEqual(result["intakeDate"], "2026-05-13")
        self.assertEqual(result["husbandryDays"], 30)
        self.assertEqual(result["strainStandard"], "C57BL/6")
        self.assertEqual(result["supplier"], "广东南模")

    def test_keeps_explicit_iacuc_and_cleans_fields(self):
        result = _normalize_payload(
            {
                "batchNo": "B2026001",
                "iacuc": "z2026001",
                "quantity": "0",
                "intakeDate": "5月13日",
                "husbandryDays": "",
            }
        )
        self.assertEqual(result["iacuc"], "Z2026001")
        self.assertIsNone(result["quantity"])
        self.assertEqual(result["intakeDate"], "")
        self.assertIsNone(result["husbandryDays"])

    def test_deterministic_strain_wins_over_ai_value(self):
        result = _normalize_payload(
            {
                "strainRaw": "c57bl/6J",
                "strainStandard": "C57",
                "supplier": "上海南方模式生物科技股份有限公司",
            }
        )
        self.assertEqual(result["strainStandard"], "C57BL/6J")
        self.assertEqual(result["supplier"], "上海南模")

    def test_unknown_strain_keeps_ai_value_then_raw(self):
        result = _normalize_payload({"strainRaw": "XYZ新品系", "strainStandard": "XYZ新品系"})
        self.assertEqual(result["strainStandard"], "XYZ新品系")
        result = _normalize_payload({"strainRaw": "XYZ新品系", "strainStandard": ""})
        self.assertEqual(result["strainStandard"], "XYZ新品系")

    def test_missing_fields_become_empty(self):
        result = _normalize_payload({})
        self.assertEqual(result["iacuc"], "")
        self.assertEqual(result["supplier"], "")
        self.assertIsNone(result["quantity"])
        self.assertEqual(result["intakeDate"], "")


class DeepSeekChatJsonTest(unittest.TestCase):
    @mock.patch("server_app.services.ai.DEEPSEEK_API_KEY", "test-key")
    @mock.patch("server_app.services.ai.urlopen")
    def test_parses_choices_content(self, urlopen_mock):
        response_mock = mock.Mock()
        response_mock.read.return_value = b'{"choices": [{"message": {"content": "{\\"ok\\": true}"}}]}'
        urlopen_mock.return_value.__enter__.return_value = response_mock
        result, usage = deepseek_chat_json("system rules", "user text")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(usage, {})
        request = urlopen_mock.call_args.args[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.headers["Authorization"], "Bearer test-key")

    def test_missing_key_raises(self):
        with mock.patch("server_app.services.ai.DEEPSEEK_API_KEY", ""):
            with self.assertRaises(ValueError):
                deepseek_chat_json("system", "user")


class IntakeAiParseMessageTest(unittest.TestCase):
    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_ai_parse_message(self, chat_mock):
        chat_mock.return_value = (
            {
                "purchaseOrderNo": "C2026043035083",
                "batchNo": "（Z2025050）2026042903",
                "iacuc": "Z2025050",
                "supplier": "广东南模生物科技有限公司",
                "strainRaw": "c57",
                "strainStandard": "C57BL/6",
                "species": "mouse",
                "sex": "",
                "quantity": "70",
                "roomName": "8101",
                "intakeDate": "2026-05-13",
                "husbandryDays": "",
            },
            {"prompt_tokens": 120, "completion_tokens": 40, "total_tokens": 160},
        )
        result, usage = ai_parse_intake_message("sample", ["8101"])
        self.assertEqual(result["iacuc"], "Z2025050")
        self.assertEqual(result["quantity"], 70)
        self.assertEqual(result["intakeDate"], "2026-05-13")
        self.assertEqual(result["strainStandard"], "C57BL/6")
        self.assertEqual(usage["total_tokens"], 160)


class StrainStandardTest(unittest.TestCase):
    def test_mgi_standard_names(self):
        cases = {
            "c57": "C57BL/6",
            "c57bl/6j": "C57BL/6J",
            "C57BL/6N小鼠": "C57BL/6N",
            "balb/c": "BALB/c",
            "BALB/c-nu": "BALB/c裸鼠",
            "icr": "ICR",
            "CD-1（ICR）": "ICR",
            "km": "KM",
            "昆明鼠": "KM",
            "裸鼠": "裸鼠",
            "nude": "裸鼠",
            "NOD/SCID": "NOD/SCID",
            "NSG小鼠": "NSG",
            "NCG": "NCG",
            "NOG": "NOG",
            "C３H": "C3H/HeJ",
            "dba/2": "DBA/2J",
            "129S1/SvImJ": "129S1/SvImJ",
            "615": "615",
            "B6D2F1": "B6D2F1",
            "Swiss Webster": "Swiss Webster",
            "Rag2-/-": "Rag2-KO",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(standardize_strain(raw), expected)

    def test_unknown_strain_returns_empty(self):
        self.assertEqual(standardize_strain("某新品系"), "")
        self.assertEqual(standardize_strain(""), "")

    def test_supplier_abbreviation(self):
        cases = {
            "广东南模生物科技股份有限公司": "广东南模",
            "上海南方模式生物科技股份有限公司": "上海南模",
            "江苏集萃药康生物科技股份有限公司": "江苏集萃",
            "北京百奥赛图": "北京百奥赛图",
            "未收录供应商": "未收录供应商",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(abbreviate_supplier(raw), expected)


if __name__ == "__main__":
    unittest.main()
