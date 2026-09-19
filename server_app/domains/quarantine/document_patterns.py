"""Resolve each result block against its retained laboratory form."""

import re
import unicodedata

from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


def project_name(value):
    value = unicodedata.normalize("NFKC", value)
    return re.sub(r"\s+", "", re.sub(r"^\d+-\d+", "", value))


def result_patterns(region, document):
    patterns, heading = [], None
    for element in region:
        if element.tag == qn("w:p") and Paragraph(element, document).text.strip():
            heading = element
        elif element.tag == qn("w:tbl") and heading is not None:
            patterns.append((heading, element))
    return patterns


def result_pattern(patterns, document, name):
    key = project_name(name)
    for heading, table in patterns:
        if project_name(Paragraph(heading, document).text) == key:
            return heading, table
    # Some historical mouse forms swap the parenthesized Toxo/MYco abbreviations.
    # Match their unambiguous full Chinese name without rewriting the current project.
    stem = re.sub(r"\([^)]*\)", "", key)
    matches = [
        pair for pair in patterns if re.sub(r"\([^)]*\)", "", project_name(Paragraph(pair[0], document).text)) == stem
    ]
    if len(matches) == 1:
        return matches[0]
    # A new project must not inherit the last, potentially rat-only, narrow table.
    return max(patterns, key=lambda pair: len(Table(pair[1], document).columns))


def result_prefix(patterns, document):
    return re.match(r"(\d+)-", Paragraph(patterns[0][0], document).text.strip()).group(1)


def sized_result_pattern(patterns, document, project, *, controls):
    heading, table = result_pattern(patterns, document, project["name"])
    required = len(project["sampleIds"]) + 1 + (2 if controls else 0)
    if len(Table(table, document).columns) < required:
        # Historical forms also contain wider tables for projects covering more samples.
        fitting = [pair[1] for pair in patterns if len(Table(pair[1], document).columns) >= required]
        table = (
            min(fitting, key=lambda element: len(Table(element, document).columns))
            if fitting
            else max((pair[1] for pair in patterns), key=lambda element: len(Table(element, document).columns))
        )
    return heading, table


def template_name(test, attachments):
    method, count = test["method"], len(test["samples"])
    if method == "parasite":
        return "parasite" if count <= 5 else "parasite_6" if count == 6 else "parasite_7"
    if method == "elisa_rat":
        return "elisa_rat_1" if count == 1 else "elisa_rat"
    if method == "pcr":
        return "pcr_small" if count <= 6 else "pcr" if count <= 8 else "pcr_9"
    image_count = sum(a["mime"].startswith("image/") and not a.get("removed") for a in attachments)
    if image_count == 1:
        return "elisa_mouse_4_single" if count <= 4 else "elisa_mouse_8_single"
    return "elisa_mouse" if count <= 3 else "elisa_mouse_4" if count == 4 else "elisa_mouse_7"
