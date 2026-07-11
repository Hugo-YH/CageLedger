import io
import zipfile


def build_pdf_zip(entries):
    """Package named PDF byte payloads into a deterministic ZIP download."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        used_names = set()
        for filename, body in entries:
            resolved = unique_name(filename, used_names)
            archive.writestr(resolved, body)
    return output.getvalue()


def unique_name(filename, used_names):
    if filename not in used_names:
        used_names.add(filename)
        return filename
    stem, extension = filename.rsplit(".", 1) if "." in filename else (filename, "")
    index = 2
    while True:
        candidate = f"{stem} ({index}){'.' + extension if extension else ''}"
        if candidate not in used_names:
            used_names.add(candidate)
            return candidate
        index += 1
