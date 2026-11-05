import base64
import hashlib
import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image, ImageChops, ImageDraw

from server_app.domains.intake.ai_parse import ai_parse_intake_images
from server_app.domains.intake.recognition_evidence import sanitize_evidence
from server_app.domains.intake.recognition_image_copy import prepare
from server_app.domains.intake.recognition_images import RecognitionImage
from tests.test_intake_recognition_images import sample_result


def screenshot(mode="RGB", background="white", *, fmt="PNG"):
    image = Image.new(mode, (1000, 900), background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((300, 300, 700, 500), fill="black")
    draw.text((310, 320), "C2026102648086 DC202610264808601 27 + 3", fill="red")
    draw.point((140, 310), fill=(254, 254, 254))  # Even this faint margin pixel must survive.
    output = BytesIO()
    image.save(output, format=fmt)
    return RecognitionImage("original.png", "image/png" if fmt == "PNG" else "image/jpeg", output.getvalue())


class RecognitionCopyTests(unittest.TestCase):
    def test_lossless_crop_preserves_every_nonwhite_pixel_and_original_bytes(self):
        original = screenshot()
        digest = hashlib.sha256(original.body).hexdigest()
        processed, facts = prepare(original)
        self.assertIsNotNone(facts)
        self.assertLess(len(processed.body), len(original.body))
        self.assertLess(facts["imageSize"][0] * facts["imageSize"][1], 1000 * 900 * 0.85)
        with Image.open(BytesIO(original.body)) as source, Image.open(BytesIO(processed.body)) as copy:
            reconstructed = Image.new("RGB", source.size, "white")
            reconstructed.paste(copy, facts["cropBox"][:2])
            self.assertIsNone(ImageChops.difference(source, reconstructed).getbbox())
        self.assertEqual(hashlib.sha256(original.body).hexdigest(), digest)
        self.assertEqual(
            (facts["sourceSha256"], facts["imageSha256"]), (digest, hashlib.sha256(processed.body).hexdigest())
        )

    def test_uncertain_background_transparency_and_jpeg_preserve_original_bytes(self):
        for original in (
            screenshot(background=(254, 254, 254)),
            screenshot(fmt="JPEG"),
            screenshot("RGBA", (255, 255, 255, 128)),
        ):
            with self.subTest(mime=original.mime):
                processed, facts = prepare(original)
                self.assertIs(processed, original)
                self.assertIsNone(facts)

    def test_ai_uses_copy_while_evidence_and_saved_input_hashes_refer_to_original(self):
        original = screenshot()
        expected, _ = prepare(original)
        raw = [{"name": original.name, "dataUrl": original.data_url}]
        with patch("server_app.domains.intake.ai_parse.deepseek_chat_json", return_value=(sample_result(), {})) as ai:
            _, _, evidence = ai_parse_intake_images("", [], raw)
        sent = base64.b64decode(ai.call_args.kwargs["image_urls"][0].split(",", 1)[1])
        self.assertEqual(sent, expected.body)
        self.assertEqual(evidence["inputImages"][0]["sha256"], hashlib.sha256(original.body).hexdigest())
        self.assertEqual(sanitize_evidence(evidence)["imageProcessing"], evidence["imageProcessing"])
        invalid = {**evidence, "imageProcessing": [{**evidence["imageProcessing"][0], "cropBox": [0, 0, "unsafe", 5]}]}
        self.assertNotIn("imageProcessing", sanitize_evidence(invalid))
