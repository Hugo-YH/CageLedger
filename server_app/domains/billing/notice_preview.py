"""Small notification response from the same freshly validated settlement preview."""


def notice_preview(statement, source_versions=None):
    return {
        "statement": {key: statement[key] for key in ("pi", "month", "totalAmount")},
        "sourceVersions": source_versions if source_versions is not None else statement.get("sourceVersions", {}),
    }
