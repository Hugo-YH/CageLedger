import json
import unittest
from pathlib import Path
from unittest import mock

from server_app.domains.intake.ai_parse import _normalize_payload, ai_parse_intake_message
from server_app.domains.intake.strain_standard import abbreviate_supplier, standardize_strain
from server_app.services.ai import deepseek_chat_json
from server_app.web.intake_ai import intake_ai_parse_handler


class IntakeAiParseNormalizationTest(unittest.TestCase):
    def test_supplier_catalog_all_names_and_aliases_resolve_consistently(self):
        path = Path(__file__).resolve().parents[1] / "server_app/resources/intake/supplier-aliases.json"
        catalog = json.loads(path.read_text(encoding="utf-8"))
        for entry in catalog["entries"]:
            for name in [entry["shortName"], *entry["companyNames"], *entry["aliases"], *entry["exactAliases"]]:
                with self.subTest(name=name):
                    self.assertEqual(abbreviate_supplier(name), entry["shortName"])
                    self.assertEqual(_normalize_payload({"supplier": name})["supplier"], entry["shortName"])

    def test_supplier_matching_keeps_regional_entities_and_unknown_branches(self):
        cases = {
            "斯贝福（北京）生物技术有限公司": "北京斯贝福",
            " 斯贝福 ( 北京 ) 生物技术有限公司 ": "北京斯贝福",
            "北京维通利华实验动物技术有限公司湖北分公司": "湖北维通利华",
            "湖南斯莱克景达实验动物有限公司": "湖南斯莱克景达",
            "百奥赛图江苏基因生物技术有限公司": "江苏百奥赛图",
            "百奥赛图（上海）医药科技有限公司": "上海百奥赛图",
            "深圳百奥赛图生物科技有限公司": "深圳百奥赛图生物科技有限公司",
            "武汉斯莱克生物科技有限公司": "武汉斯莱克生物科技有限公司",
            "北京维通利华实验动物技术有限公司南京分公司": "北京维通利华实验动物技术有限公司南京分公司",
            "广东明珠集团股份有限公司": "广东明珠集团股份有限公司",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(abbreviate_supplier(raw), expected)

    def test_sex_is_normalized_to_three_options_with_mixed_default(self):
        cases = {
            "雌性": "雌性",
            "母鼠": "雌性",
            "female": "雌性",
            "F": "雌性",
            "♀": "雌性",
            "雄性": "雄性",
            "公鼠": "雄性",
            "male": "雄性",
            "M": "雄性",
            "♂": "雄性",
            "雌性/雄性": "雌性/雄性",
            "雌雄各半": "雌性/雄性",
            "公母混合": "雌性/雄性",
            "female/male": "雌性/雄性",
            "": "雌性/雄性",
            "未知": "雌性/雄性",
            None: "雌性/雄性",
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(_normalize_payload({"sex": value})["sex"], expected)
        self.assertEqual(_normalize_payload({})["sex"], "雌性/雄性")

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
        self.assertEqual(result["endDate"], "2026-06-12")
        self.assertEqual(result["husbandryDays"], 30)
        self.assertEqual(result["strainStandard"], "C57BL/6J")
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

    def test_derives_end_date_from_intake_date_and_days(self):
        result = _normalize_payload({"intakeDate": "2024-02-28", "husbandryDays": "2"})
        zero_day = _normalize_payload({"intakeDate": "2026-05-13", "husbandryDays": 0})
        self.assertEqual(result["intakeDate"], "2024-02-28")
        self.assertEqual(result["endDate"], "2024-03-01")
        self.assertEqual(result["husbandryDays"], 2)
        self.assertEqual(zero_day["endDate"], "2026-05-13")
        self.assertEqual(zero_day["husbandryDays"], 0)

    def test_derives_days_from_date_range_including_zero_and_across_year(self):
        same_day = _normalize_payload({"intakeDate": "2026-05-13", "endDate": "2026-05-13"})
        cross_year = _normalize_payload({"intakeDate": "2025-12-31", "endDate": "2026-01-01"})
        self.assertEqual(same_day["husbandryDays"], 0)
        self.assertEqual(cross_year["husbandryDays"], 1)

    def test_date_range_wins_when_ai_cycle_conflicts(self):
        result = _normalize_payload({"intakeDate": "2026-05-13", "endDate": "2026-05-20", "husbandryDays": "30"})
        self.assertEqual(result["husbandryDays"], 7)

    def test_does_not_invent_intake_date_or_negative_cycle(self):
        no_intake = _normalize_payload({"endDate": "2026-05-20", "husbandryDays": "7"})
        reverse_dates = _normalize_payload({"intakeDate": "2026-05-20", "endDate": "2026-05-13"})
        self.assertEqual(no_intake["intakeDate"], "")
        self.assertEqual(no_intake["endDate"], "2026-05-20")
        self.assertEqual(no_intake["husbandryDays"], 7)
        self.assertIsNone(reverse_dates["husbandryDays"])

    def test_invalid_dates_and_overlarge_days_are_safe(self):
        malformed = _normalize_payload({"intakeDate": "2026-xx-13", "endDate": "2026-02-30"})
        overlarge = _normalize_payload({"intakeDate": "9999-12-31", "husbandryDays": "999999999999999999999"})
        self.assertEqual(malformed["intakeDate"], "")
        self.assertEqual(malformed["endDate"], "")
        self.assertEqual(overlarge["endDate"], "")
        self.assertEqual(overlarge["husbandryDays"], 999999999999999999999)

    def test_direct_sampling_clears_housing_only_values(self):
        result = _normalize_payload(
            {"intakePurpose": "direct_sampling", "roomName": "8101", "endDate": "2026-05-20", "husbandryDays": 7}
        )
        self.assertEqual(result["intakePurpose"], "direct_sampling")
        self.assertEqual(result["roomName"], "")
        self.assertEqual(result["endDate"], "")
        self.assertIsNone(result["husbandryDays"])

    def test_invalid_or_missing_cycle_does_not_generate_end_date(self):
        for value in (None, "", -1, "1.5", "未知", True):
            with self.subTest(value=value):
                result = _normalize_payload({"intakeDate": "2026-10-21", "husbandryDays": value})
                self.assertEqual(result["endDate"], "")
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
        self.assertEqual(result["endDate"], "")


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
    def test_text_only_endpoint_returns_the_locally_computed_month(self, chat_mock):
        chat_mock.return_value = (
            {"intakeDate": "2026-10-28", "endDate": "2026-11-27", "husbandryDays": 30},
            {"total_tokens": 12},
        )
        handler = mock.Mock()
        handler.current_user.return_value = {"id": "test-admin"}
        handler.read_json_body.return_value = {
            "rawMessage": "接收日期2026-10-28，饲养周期1月",
            "roomNames": [],
            "images": [],
        }
        response = intake_ai_parse_handler(handler, {})
        self.assertEqual(response.status, 200)
        self.assertEqual(
            {key: response.payload["item"][key] for key in ("husbandryMonths", "husbandryDays", "endDate")},
            {"husbandryMonths": 1, "husbandryDays": 31, "endDate": "2026-11-28"},
        )
        self.assertEqual(response.payload["usage"], {"total_tokens": 12})

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_calendar_month_uses_original_text_instead_of_model_echo_or_day_conversion(self, chat_mock):
        cases = [
            {"husbandryMonths": 1, "husbandryPeriodRaw": "1月"},
            {"husbandryDays": 30, "endDate": "2026-11-27"},
            {"husbandryMonths": 1, "husbandryPeriodRaw": "饲养周期1月", "endDate": "2026-11-27"},
            {"husbandryMonths": 2, "husbandryPeriodRaw": "饲养周期2月", "husbandryDays": 60},
        ]
        for fields in cases:
            with self.subTest(fields=fields):
                chat_mock.return_value = ({"intakeDate": "2026-10-28", **fields}, {"total_tokens": 12})
                result, usage = ai_parse_intake_message("接收日期：2026-10-28\n饲养周期1月")
                self.assertEqual(
                    (result["husbandryMonths"], result["endDate"], result["husbandryDays"]), (1, "2026-11-28", 31)
                )
                self.assertEqual(usage, {"total_tokens": 12})

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_month_clamps_month_end_and_handles_leap_year_and_year_boundary(self, chat_mock):
        for start, end, days in [
            ("2026-01-31", "2026-02-28", 28),
            ("2024-01-31", "2024-02-29", 29),
            ("2026-12-31", "2027-01-31", 31),
        ]:
            with self.subTest(start=start):
                chat_mock.return_value = ({"intakeDate": start, "husbandryDays": 30}, {})
                result, _ = ai_parse_intake_message(f"接收日期：{start}，饲养周期一个月")
                self.assertEqual(
                    (result["husbandryMonths"], result["endDate"], result["husbandryDays"]), (1, end, days)
                )

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_month_preserves_stated_end_date_including_short_dates(self, chat_mock):
        for raw_end in ["2026-11-27", "2026年11月27日", "2026/11/27", "2026.11.27", "11月27日", "11/27"]:
            with self.subTest(raw_end=raw_end):
                chat_mock.return_value = ({"intakeDate": "2026-10-28", "endDate": "2026-11-27"}, {})
                result, _ = ai_parse_intake_message(f"接收日期：2026-10-28；饲养周期1月；结束日期：{raw_end}")
                self.assertIsNone(result["husbandryMonths"])
                self.assertEqual((result["endDate"], result["husbandryDays"]), ("2026-11-27", 30))

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_month_without_receipt_date_keeps_intent_without_invented_dates(self, chat_mock):
        chat_mock.return_value = ({"intakeDate": "2026-10-28", "endDate": "2026-11-27", "husbandryDays": 30}, {})
        result, _ = ai_parse_intake_message("饲养周期1月，批次号2026102801")
        self.assertEqual(
            (result["husbandryMonths"], result["intakeDate"], result["endDate"], result["husbandryDays"]),
            (1, "", "", None),
        )
        result, _ = ai_parse_intake_message("接收日期：2025年10月28日；饲养周期1月")
        self.assertEqual(result["intakeDate"], "")
        result, _ = ai_parse_intake_message("饲养周期1月；结束日期：2026-11-27")
        self.assertEqual(
            (result["husbandryMonths"], result["intakeDate"], result["endDate"], result["husbandryDays"]),
            (1, "", "", None),
        )

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_month_does_not_treat_procurement_date_as_receipt_or_end_date(self, chat_mock):
        for text in [
            "采购申请日期：2026-10-28；饲养周期1月",
            "采购申请日期：2026-10-28 接收日期：2026-11-01；饲养周期1月",
        ]:
            with self.subTest(text=text):
                chat_mock.return_value = ({"intakeDate": "2026-10-28", "endDate": "2026-11-27"}, {})
                result, _ = ai_parse_intake_message(text)
                self.assertEqual((result["husbandryMonths"], result["intakeDate"], result["endDate"]), (1, "", ""))
        chat_mock.return_value = ({"intakeDate": "2026-10-28", "endDate": "2026-11-27"}, {})
        result, _ = ai_parse_intake_message("接收日期：2026-10-28；饲养周期1月；采购交付期限：2026-11-27")
        self.assertEqual((result["endDate"], result["husbandryDays"]), ("2026-11-28", 31))

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_month_accepts_dates_before_actions_and_explicit_husbandry_ranges(self, chat_mock):
        for text in [
            "2026年10月28日接收，11月27日结束饲养；饲养周期1月",
            "饲养时间：2026-10-28至2026-11-27；饲养周期1月",
        ]:
            with self.subTest(text=text):
                chat_mock.return_value = ({"intakeDate": "2026-10-28", "endDate": "2026-11-27"}, {})
                result, _ = ai_parse_intake_message(text)
                self.assertIsNone(result["husbandryMonths"])
                self.assertEqual(
                    (result["intakeDate"], result["endDate"], result["husbandryDays"]), ("2026-10-28", "2026-11-27", 30)
                )

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_month_does_not_use_age_negated_period_or_conflicting_month_counts(self, chat_mock):
        for raw in ["动物月龄1月", "不是饲养周期1月", "饲养周期1月；饲养周期2月"]:
            with self.subTest(raw=raw):
                chat_mock.return_value = ({"husbandryMonths": 1, "husbandryPeriodRaw": "饲养周期1月"}, {})
                result, _ = ai_parse_intake_message(raw)
                self.assertNotIn("husbandryMonths", result)

    @mock.patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_without_a_stated_receipt_date_does_not_use_model_guesses(self, chat_mock):
        chat_mock.return_value = (
            {"intakeDate": "2026-10-28", "endDate": "2026-11-04", "husbandryDays": 7},
            {},
        )
        for text in (
            "采购完成，接收日期待定，饲养周期7天",
            "采购申请日期2026-10-28；接收时间另行通知；饲养周期7天",
            "批次号2026102801，饲养周期7天",
        ):
            with self.subTest(text=text):
                result, _ = ai_parse_intake_message(text)
                self.assertEqual((result["intakeDate"], result["endDate"], result["husbandryDays"]), ("", "", 7))
        result, _ = ai_parse_intake_message("接收日期待定，结束日期2026-11-04，饲养周期7天")
        self.assertEqual((result["intakeDate"], result["endDate"]), ("", "2026-11-04"))

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
                "endDate": "2026-06-12",
                "husbandryDays": "",
            },
            {"prompt_tokens": 120, "completion_tokens": 40, "total_tokens": 160},
        )
        result, usage = ai_parse_intake_message("接收日期2026-05-13，结束日期2026-06-12", ["8101"])
        self.assertEqual(result["iacuc"], "Z2025050")
        self.assertEqual(result["quantity"], 70)
        self.assertEqual(result["intakeDate"], "2026-05-13")
        self.assertEqual(result["endDate"], "2026-06-12")
        self.assertEqual(result["husbandryDays"], 30)
        self.assertEqual(result["strainStandard"], "C57BL/6J")
        self.assertEqual(usage["total_tokens"], 160)


class StrainStandardTest(unittest.TestCase):
    def test_mgi_standard_names(self):
        cases = {
            "c57": "C57BL/6J",
            "c57bl/6j": "C57BL/6J",
            "C57/B6J": "C57BL/6J",
            "C57BL/6JGpt": "C57BL/6J",
            "c57bl/6jGpt，3w": "C57BL/6J",
            "C57BL/6J，40只": "C57BL/6J",
            "3w": "C57BL/6J",
            "c57小鼠": "C57BL/6J",
            "c57bl/6小鼠": "C57BL/6",
            "转基因小鼠": "基因工程小鼠",
            "基因鼠": "基因工程小鼠",
            "c57基因小鼠": "基因工程小鼠",
            "基因工程小鼠": "基因工程小鼠",
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

    def test_full_mgi_index_fallback(self):
        cases = {
            "BALB/cAnN-Foxn1<nu>": "BALB/cAnN-Foxn1<nu>",
            "NOD.CB17-Prkdc<scid>/NcrCrl": "NOD.CB17-Prkdc<scid>/NcrCrl",
            "B6.Cg-Foxn1<nu>/J": "B6.Cg-Foxn1<nu>/J",
            "101": "101",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(standardize_strain(raw), expected)

    def test_curated_aliases_win_over_full_index(self):
        self.assertEqual(standardize_strain("NOD.Cg-Prkdc<scid> Il2rg<tm1Wjl>/SzJ"), "NSG")
        self.assertEqual(standardize_strain("B6.129S7-Rag1<tm1Mom>/J"), "Rag1-KO")

    def test_supplier_abbreviation(self):
        cases = {
            "广东南模生物科技股份有限公司": "广东南模",
            "上海南方模式生物科技股份有限公司": "上海南模",
            "江苏集萃药康生物科技股份有限公司": "江苏集萃",
            "广东维通利华实验动物技术有限公司": "广东维通利华",
            "广东维通利华": "广东维通利华",
            "广东维通利": "广东维通利华",
            "北京百奥赛图": "北京百奥赛图",
            "未收录供应商": "未收录供应商",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(abbreviate_supplier(raw), expected)
        self.assertEqual(
            _normalize_payload({"supplier": "广东维通利华实验动物技术有限公司"})["supplier"], "广东维通利华"
        )


if __name__ == "__main__":
    unittest.main()
