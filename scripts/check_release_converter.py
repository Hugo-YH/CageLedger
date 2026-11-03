"""Exercise the real Writer converter using a synthetic document and temporary profile."""

import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server_app.domains.quarantine.pdf import convert_docx


def main():
    document = io.BytesIO()
    with zipfile.ZipFile(document, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        archive.writestr(
            "_rels/.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>',
        )
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>CageLedger release converter verification</w:t></w:r></w:p>"
            "<w:sectPr/></w:body></w:document>",
        )
    content = convert_docx(document.getvalue())
    if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-1024:]:
        raise RuntimeError("Converter smoke produced an incomplete PDF")
    print(f"Synthetic DOCX to PDF passed ({len(content)} bytes); temporary profile and files removed")


if __name__ == "__main__":
    main()
