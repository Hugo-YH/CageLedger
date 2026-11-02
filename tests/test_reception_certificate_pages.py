"""Multi-page selection/rendering without any model calls or user-data writes."""

import json
import shutil
import subprocess
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from PIL import Image

from server_app.domains.reception import certificate_ai as ai
from server_app.domains.reception import certificate_files as files
from server_app.domains.reception import certificate_pages as pages


def pdf(dimensions):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    kids = []
    for width, height in dimensions:
        page_id = len(objects) + 1
        kids.append(f"{page_id} 0 R")
        objects += [
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << >> /Contents {page_id + 1} 0 R >>".encode(),
            b"<< /Length 0 >>\nstream\n\nendstream",
        ]
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    result = b"%PDF-1.4\n"
    offsets = [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{index} 0 obj\n".encode() + value + b"\nendobj\n"
    start = len(result)
    result += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    result += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return result + f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()


def png():
    with BytesIO() as out:
        Image.new("RGB", (595, 842), "white").save(out, format="PNG")
        return out.getvalue()


class CertificatePagesTests(unittest.TestCase):
    def test_selects_all_paper_and_uncertain_frames_even_after_a_photo(self):
        selection = pages.select_pages(
            [
                (1, 595, 842),
                (2, 4032, 2268),
                (3, 596, 842),
                (4, 842, 595),
                (5, 420, 595),
                (6, 297, 105),
                (7, 3927, 2845),
                (8, 3024, 4032),
                (9, 600, 800),
            ]
        )
        self.assertEqual(selection["selectedPages"], [1, 3, 4, 5, 6, 7, 9])
        self.assertEqual(selection["skippedPhotoPages"], [2, 8])
        self.assertEqual(
            pages.select_pages([(1, 4032, 2268), (2, 4032, 2268)], include_all=True)["selectedPages"], [1, 2]
        )
        for value in (0, -1, float("nan"), float("inf"), 100001):
            with self.subTest(value=value), self.assertRaises(ValueError):
                pages.select_pages([(1, value, 595)])

    @unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftoppm"), "Poppler required")
    def test_real_pdf_stage_logs_are_bounded_and_do_not_contain_document_values(self):
        original = pdf([(595, 842), (595, 842)])
        with self.assertLogs("cageledger.runtime", level="INFO") as logs:
            metadata, preview = files.prepare("private-certificate-filename.pdf", original)
            images, _ = pages.prepare(original, metadata["page_count"], preview)
        self.assertEqual(len(images), 2)
        diagnostics = [record.diagnostics for record in logs.records]
        self.assertEqual(
            [item["stage"] for item in diagnostics], ["pdf_parse", "preview_render", "pdf_parse", "page_render"]
        )
        self.assertTrue(all(item["durationMs"] >= 0 for item in diagnostics))
        self.assertNotIn("private-certificate", json.dumps(diagnostics))
        self.assertNotIn("PDF-1.4", json.dumps(diagnostics))

    @unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftoppm"), "Poppler required")
    def test_real_renderer_keeps_second_certificate_and_later_paper_page(self):
        original = pdf([(595, 842), (595, 842), (4032, 2268), (596, 842)])
        images, selection = pages.prepare(original, 4, png())
        self.assertEqual(selection["selectedPages"], [1, 2, 4])
        self.assertEqual(selection["skippedPhotoPages"], [3])
        self.assertEqual([item["pageNumber"] for item in images], [1, 2, 4])
        self.assertEqual(images[0]["image"], png())
        for item in images:
            with Image.open(BytesIO(item["image"])) as image:
                self.assertEqual(image.format, "PNG")
                self.assertLessEqual(max(image.size), 3000)
        all_images, all_selection = pages.prepare(original, 4, png(), include_all=True)
        self.assertEqual([item["pageNumber"] for item in all_images], [1, 2, 3, 4])
        self.assertEqual(all_selection["mode"], "all")

    def test_refuses_missing_page_metadata_oversize_and_timeout_without_a_partial_result(self):
        dimensions = [(i, 595, 842) for i in range(1, 22)]
        with patch.object(pages, "_info", return_value=dimensions), patch.object(pages.subprocess, "run") as render:
            with self.assertRaisesRegex(ValueError, "超过20页"):
                pages.prepare(pdf([]), len(dimensions), png())
            render.assert_not_called()

        def info(_command, **kwargs):
            kwargs["stdout"].write(b"Pages: 2\nPage 1 size: 595 x 842 pts\n")
            return Mock(returncode=0)

        with patch.object(pages.subprocess, "run", side_effect=info), self.assertRaisesRegex(ValueError, "每页画幅"):
            pages.prepare(pdf([]), 2, png())
        with (
            patch.object(pages.subprocess, "run", side_effect=subprocess.TimeoutExpired("pdfinfo", 15)),
            self.assertRaises(pages.files.CertificateUnavailableError),
        ):
            pages.prepare(pdf([]), 2, png())
        with (
            patch.object(pages, "MAX_IMAGES_BYTES", 1),
            patch.object(pages, "_info", return_value=[(1, 595, 842)]),
            self.assertRaisesRegex(ValueError, "合计超过"),
        ):
            pages.prepare(pdf([]), 1, png())

    def test_all_images_reach_one_provider_request_and_keep_distinct_certificate_facts(self):
        payload = {
            "certificates": [
                {
                    "pageNumber": number,
                    "certificateNo": f"CERT-{number}",
                    "certificateStrain": "C57BL/6",
                    "grade": "SPF",
                    "supplier": "供应商",
                    "lines": [{"sex": "雄性", "quantity": number * 10}],
                }
                for number in (1, 2)
            ]
        }
        images = [{"pageNumber": number, "image": png()} for number in (1, 2)]
        with patch.object(ai, "deepseek_chat_json", return_value=(payload, {})) as provider:
            result, raw, _ = ai.recognize(images, "attachment", "run", {"species": "mouse", "quantity": 30})
        self.assertEqual(len(provider.call_args.kwargs["image_urls"]), 2)
        self.assertIn("第1、2页", provider.call_args.args[1])
        self.assertEqual([row["quantity"] for row in result["lines"]], [10, 20])
        self.assertEqual([row["certificateIndex"] for row in result["lines"]], [1, 2])
        self.assertEqual([item["pageNumber"] for item in raw["pages"]], [1, 2])
        self.assertNotIn("data:image", json.dumps(raw))
        payload["certificates"][1]["pageNumber"] = 3
        with (
            patch.object(ai, "deepseek_chat_json", return_value=(payload, {})),
            self.assertRaisesRegex(ValueError, "页码"),
        ):
            ai.recognize(images, "attachment", "run", {})
