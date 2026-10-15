"""Extract mirror references without changing quantities or legacy sheet JSON."""

from server_app.shared import as_int, clean_text


def extract_links(sheet):
    links = {}
    for position, row in enumerate(sheet.get("rows") or []):
        if not isinstance(row, dict):
            continue
        row_id = clean_text(row.get("id", "")) or f"@row-{position}"
        source = clean_text(row.get("transferSourceSheetId", ""))
        if source:
            direction = (
                "out_to_in"
                if row.get("addedType") == "转入"
                else "in_to_out"
                if row.get("removedType") == "转出"
                else "legacy"
            )
            prefix = f"xfer-{source}-"
            suffix = f"-{sheet.get('iacuc', '')}-{direction}"
            source_row = (
                row_id[len(prefix) : -len(suffix)] if row_id.startswith(prefix) and row_id.endswith(suffix) else ""
            )
            count = as_int(row.get("addedCount" if direction == "out_to_in" else "removedCount")) or 0
            links[(row_id, "@mirror")] = (row_id, "@mirror", source, source_row, direction, count)
        contrib = row.get("transferMirrorContrib")
        if isinstance(contrib, dict):
            for key, value in contrib.items():
                parts = str(key).rsplit(":", 3)
                if len(parts) != 4 or not parts[0] or parts[3] not in ("out_to_in", "in_to_out"):
                    continue  # Preserve noncanonical historical keys in the JSON.
                links[(row_id, str(key))] = (row_id, str(key), parts[0], parts[1], parts[3], as_int(value) or 0)
    return list(links.values())
