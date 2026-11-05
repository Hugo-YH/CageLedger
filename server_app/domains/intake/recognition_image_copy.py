"""Lossless AI-only white-margin copies; every nonwhite original pixel is retained."""

import hashlib
from io import BytesIO

from PIL import Image, ImageChops

from .recognition_images import RecognitionImage

VERSION = "intake-white-margin-v1"


def prepare(image):
    if image.mime != "image/png":
        return image, None
    with Image.open(BytesIO(image.body)) as source:
        width, height = source.size
        # Avoid an extra large decode on a small NAS. Never change transparency or palette rendering.
        if width * height > 12_000_000 or source.mode not in {"RGB", "RGBA"}:
            return image, None
        if source.mode == "RGBA" and source.getchannel("A").getextrema() != (255, 255):
            return image, None
        rgb = source.convert("RGB")
        red, green, blue = rgb.split()
        minimum = ImageChops.darker(ImageChops.darker(red, green), blue)
        bounds = minimum.point(lambda value: 0 if value == 255 else 255).getbbox()
        if not bounds:
            return image, None
        padding = max(32, round(min(width, height) * 0.02))
        crop = (
            max(0, bounds[0] - padding),
            max(0, bounds[1] - padding),
            min(width, bounds[2] + padding),
            min(height, bounds[3] + padding),
        )
        cropped_width, cropped_height = crop[2] - crop[0], crop[3] - crop[1]
        if cropped_width < 200 or cropped_height < 100 or cropped_width * cropped_height > width * height * 0.85:
            return image, None
        output = BytesIO()
        source.crop(crop).save(output, format="PNG", compress_level=6)
        content = output.getvalue()
        if len(content) >= len(image.body):
            return image, None
    return RecognitionImage(image.name, image.mime, content), {
        "version": VERSION,
        "applied": True,
        "sourceSize": [width, height],
        "imageSize": [cropped_width, cropped_height],
        "cropBox": list(crop),
        "sourceSha256": hashlib.sha256(image.body).hexdigest(),
        "imageSha256": hashlib.sha256(content).hexdigest(),
    }


def sanitize_processing(raw):
    if not isinstance(raw, list):
        return []
    result = []
    for item in raw[:4]:
        if not isinstance(item, dict) or item.get("version") != VERSION or item.get("applied") is not True:
            continue
        if type(item.get("imageIndex")) is not int or not 1 <= item["imageIndex"] <= 4:
            continue
        if any(
            not isinstance(item.get(key), list)
            or len(item[key]) != length
            or any(type(value) is not int or not 0 <= value <= 8192 for value in item[key])
            for key, length in (("sourceSize", 2), ("imageSize", 2), ("cropBox", 4))
        ):
            continue
        if any(
            not isinstance(item.get(key), str)
            or len(item[key]) != 64
            or any(char not in "0123456789abcdef" for char in item[key])
            for key in ("sourceSha256", "imageSha256")
        ):
            continue
        result.append(
            {
                key: list(item[key]) if isinstance(item[key], list) else item[key]
                for key in (
                    "version",
                    "applied",
                    "imageIndex",
                    "sourceSize",
                    "imageSize",
                    "cropBox",
                    "sourceSha256",
                    "imageSha256",
                )
            }
        )
    return result
