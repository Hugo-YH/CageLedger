import re

from server_app.shared import clean_text


def normalize_iacuc_number(value):
    text = clean_text(value)
    text = re.sub(r"（.*?）", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    return text.strip()


def is_valid_iacuc_number(value):
    return bool(re.search(r"\d", value))
