"""AI image preparation preserves all visible evidence and never alters stored originals."""

import base64
import hashlib
import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image, ImageDraw

from server_app.domains.reception import certificate_ai, certificate_image


def png(image):
    with BytesIO() as output:
        image.save(output, format="PNG")
        return output.getvalue()


class CertificateImageTests(unittest.TestCase):
    def test_crop_retains_both_certificates_coloured_stamp_and_faint_margin_note(self):
        image = Image.new("RGB", (1000, 1400), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((250, 200, 750, 400), outline="black", width=2)
        draw.rectangle((250, 450, 750, 650), outline="black", width=2)
        draw.ellipse((600, 550, 720, 630), fill=(190, 20, 40))
        draw.line((50, 750, 200, 750), fill=(249, 249, 249))
        original = png(image)
        processed, facts = certificate_image.prepare(original)
        self.assertTrue(facts["applied"])
        self.assertEqual(facts["sourceSha256"], hashlib.sha256(original).hexdigest())
        with Image.open(BytesIO(processed)) as result:
            box = facts["cropBox"]
            self.assertEqual(result.tobytes(), image.crop(box).tobytes())
            self.assertEqual(result.getpixel((650 - box[0], 590 - box[1])), (190, 20, 40))
            self.assertEqual(result.getpixel((80 - box[0], 750 - box[1])), (249, 249, 249))
            self.assertLess(box[0], 50)
            self.assertGreater(box[3], 750)
        self.assertEqual(original, png(image))

    def test_ambiguous_background_and_small_content_remain_byte_identical(self):
        for image in (
            Image.new("RGB", (500, 800), (248, 248, 248)),
            Image.new("RGB", (500, 800), "white"),
            Image.new("RGB", (500, 800), "black"),
        ):
            with self.subTest(pixel=image.getpixel((0, 0))):
                original = png(image)
                processed, facts = certificate_image.prepare(original)
                self.assertIs(processed, original)
                self.assertFalse(facts["applied"])
        image = Image.new("RGB", (500, 800), "white")
        ImageDraw.Draw(image).rectangle((250, 400, 260, 410), fill="black")
        original = png(image)
        self.assertEqual(certificate_image.prepare(original)[0], original)

    def test_near_full_page_is_not_reencoded_and_transparency_is_white(self):
        image = Image.new("RGB", (500, 800), "white")
        ImageDraw.Draw(image).rectangle((10, 10, 490, 790), outline="black")
        original = png(image)
        self.assertIs(certificate_image.prepare(original)[0], original)
        transparent = Image.new("RGBA", (600, 900), (0, 0, 0, 0))
        ImageDraw.Draw(transparent).rectangle((200, 200, 450, 450), fill=(200, 20, 20, 255))
        processed, facts = certificate_image.prepare(png(transparent))
        self.assertTrue(facts["applied"])
        with Image.open(BytesIO(processed)) as result:
            self.assertEqual(result.mode, "RGB")
            self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))

    def test_invalid_dimensions_format_and_size_are_rejected(self):
        for content in (b"", "not bytes", b"x" * (15 * 1024 * 1024 + 1), png(Image.new("RGB", (3001, 10)))):
            with self.subTest(length=len(content)), self.assertRaises(ValueError):
                certificate_image.prepare(content)
        with BytesIO() as output:
            Image.new("RGB", (100, 100)).save(output, format="JPEG")
            with self.assertRaises(ValueError):
                certificate_image.prepare(output.getvalue())

    def test_ai_receives_prepared_image_and_records_trace_without_image_data(self):
        image = Image.new("RGB", (700, 1000), "white")
        ImageDraw.Draw(image).rectangle((150, 100, 550, 400), outline="black")
        original = png(image)
        response = {
            "certificates": [
                {
                    "certificateNo": "CERT-01",
                    "certificateStrain": "C57BL/6J",
                    "grade": "SPF",
                    "supplier": "测试出售单位",
                    "lines": [{"sex": "雄性", "quantity": 2, "ageRaw": "6周"}],
                }
            ]
        }
        with patch.object(certificate_ai, "deepseek_chat_json", return_value=(response, {})) as provider:
            result, raw, _usage = certificate_ai.recognize(original, "attachment", "run", {"species": "mouse"})
        transmitted = base64.b64decode(provider.call_args.kwargs["image_urls"][0].split(",", 1)[1])
        self.assertNotEqual(transmitted, original)
        self.assertEqual(raw["imageProcessing"]["imageSha256"], hashlib.sha256(transmitted).hexdigest())
        self.assertEqual(raw["imageProcessing"]["sourceSha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(result["lines"][0]["quantity"], 2)
        self.assertNotIn("image_urls", raw)
