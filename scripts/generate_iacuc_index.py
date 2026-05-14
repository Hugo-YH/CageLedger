import json
import os
import re
import sys
import csv
from pathlib import Path

import openpyxl


OUTPUT = Path("src/iacuc-data.local.json")


def clean(value):
    if value is None:
        return ""
    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    if text.endswith(" 00:00:00"):
        text = text[: -len(" 00:00:00")]
    return text


def normalize_iacuc(value):
    text = clean(value)
    text = re.sub(r"（.*?）", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    return text.strip()


def main():
    source_arg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("IACUC_SOURCE_XLSX")
    if not source_arg:
      raise SystemExit("Usage: python3 scripts/generate_iacuc_index.py /path/to/iacuc-summary.xlsx|csv")

    source = Path(source_arg)
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT

    required = {
        "iacuc": "动物伦理编号",
        "project": "动物实验名称",
        "pi": "项目负责人",
        "owner": "实验负责人",
    }
    records = []

    if source.suffix.lower() == ".csv":
        text = source.read_text(encoding="utf-8-sig")
        reader = csv.DictReader(text.splitlines())
        field_by_name = {clean(name): name for name in reader.fieldnames or [] if clean(name)}
        missing = [label for label in required.values() if label not in field_by_name]
        if missing:
            raise SystemExit(f"Missing required columns: {', '.join(missing)}")
        funding_field = field_by_name.get("项目来源")
        for index, row in enumerate(reader, start=1):
            raw_iacuc = clean(row.get(field_by_name[required["iacuc"]]))
            iacuc = normalize_iacuc(raw_iacuc)
            if not iacuc:
                continue
            records.append({
                "id": f"app-{index:06d}",
                "iacuc": raw_iacuc,
                "rawIacuc": raw_iacuc,
                "project": clean(row.get(field_by_name[required["project"]])),
                "pi": clean(row.get(field_by_name[required["pi"]])),
                "owner": clean(row.get(field_by_name[required["owner"]])),
                "funding": clean(row.get(funding_field)) if funding_field else "",
            })
    else:
        workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
        sheet = workbook.active
        headers = [clean(cell.value) for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
        column_by_name = {name: index for index, name in enumerate(headers) if name}
        missing = [label for label in required.values() if label not in column_by_name]
        if missing:
            raise SystemExit(f"Missing required columns: {', '.join(missing)}")
        funding_column = column_by_name.get("项目来源")

        for index, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=1):
            raw_iacuc = clean(row[column_by_name[required["iacuc"]]])
            iacuc = normalize_iacuc(raw_iacuc)
            if not iacuc:
                continue

            records.append({
                "id": f"app-{index:06d}",
                "iacuc": raw_iacuc,
                "rawIacuc": raw_iacuc,
                "project": clean(row[column_by_name[required["project"]]]),
                "pi": clean(row[column_by_name[required["pi"]]]),
                "owner": clean(row[column_by_name[required["owner"]]]),
                "funding": clean(row[funding_column]) if funding_column is not None else "",
            })

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(records)} IACUC records to {output}")


if __name__ == "__main__":
    main()
