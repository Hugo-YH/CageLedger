"""Conservative AI-only cropping; certificate evidence stays in its original colour."""

import hashlib
from io import BytesIO

from PIL import Image, ImageChops

from .certificate_cache import cache

VERSION = "white-margin-v2"


def prepare(preview):
    if not isinstance(preview, bytes) or not 0 < len(preview) <= 15 * 1024 * 1024:
        raise ValueError("合格证页面图片无效")
    processed, facts = cache.remember(
        "preprocess", [VERSION, hashlib.sha256(preview).hexdigest()], lambda: _prepare(preview)
    )
    return (processed if facts["applied"] else preview), facts


def _prepare(preview):
    with Image.open(BytesIO(preview)) as source:
        if source.format != "PNG" or not 0 < source.width <= 3000 or not 0 < source.height <= 3000:
            raise ValueError("合格证页面图片格式或尺寸无效")
        if "A" in source.getbands() or "transparency" in source.info:
            image = source.convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            image = background.convert("RGB")
        else:
            image = source.convert("RGB")
    width, height = image.size
    # Every non-near-white pixel counts, including stamps, faint text and margin notes.
    red, green, blue = image.split()
    minimum = ImageChops.darker(ImageChops.darker(red, green), blue)
    ink = minimum.point(lambda value: 255 if value < 250 else 0)
    bounds = ink.getbbox()
    crop = (0, 0, width, height)
    if bounds:
        padding = max(24, round(min(width, height) * 0.02))
        candidate = (
            max(0, bounds[0] - padding),
            max(0, bounds[1] - padding),
            min(width, bounds[2] + padding),
            min(height, bounds[3] + padding),
        )
        cropped_width, cropped_height = candidate[2] - candidate[0], candidate[3] - candidate[1]
        if (
            cropped_width >= max(200, width * 0.25)
            and cropped_height >= max(100, height * 0.10)
            and cropped_width * cropped_height <= width * height * 0.85
        ):
            crop = candidate
    processed = preview
    if crop != (0, 0, width, height):
        with BytesIO() as output:
            image.crop(crop).save(output, format="PNG", compress_level=3)
            processed = output.getvalue()
    return processed, {
        "version": VERSION,
        "applied": crop != (0, 0, width, height),
        "sourceSize": [width, height],
        "imageSize": [crop[2] - crop[0], crop[3] - crop[1]],
        "cropBox": list(crop),
        "sourceSha256": hashlib.sha256(preview).hexdigest(),
        "imageSha256": hashlib.sha256(processed).hexdigest(),
    }
