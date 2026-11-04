"""Structured review output; human warning text is never a control protocol."""

FIELDS = {
    "purchaseOrderNo": "采购单号",
    "orderNo": "订单编号",
    "strain": "品系/商品名",
    "specification": "体重/日龄（规格）",
    "quantity": "数量",
    "supplier": "供应商",
}


def sanitize_review(raw):
    if not isinstance(raw, dict) or type(raw.get("version")) is not int or raw["version"] != 1:
        return None
    rows, reminders = raw.get("comparisons"), raw.get("reminders")
    if not isinstance(rows, list) or not isinstance(reminders, list):
        return None
    return {
        "version": 1,
        "comparisons": [
            {
                "key": row["key"],
                "label": FIELDS[row["key"]],
                "husbandry": row["husbandry"][:8000],
                "purchase": row["purchase"][:8000],
            }
            for row in rows[:6]
            if isinstance(row, dict)
            and isinstance(row.get("key"), str)
            and row["key"] in FIELDS
            and isinstance(row.get("husbandry"), str)
            and isinstance(row.get("purchase"), str)
        ],
        "reminders": list(
            dict.fromkeys(value[:1000] for value in reminders[:40] if isinstance(value, str) and value.strip())
        ),
    }


def _value(source, field):
    if field == "strain":
        return str(source.get("strainRaw") or source.get("productName") or "").strip()
    if field != "quantity":
        return str(source.get(field) or "").strip()
    quantity = source.get("quantity")
    if quantity is None:
        return ""
    gift = (source.get("quantityFacts") or {}).get("giftQuantity") if source.get("kind") == "purchase" else None
    return f"{quantity} 只" + (f"（赠送 {gift} 只）" if gift is not None else "")


def _source_values(sources, kind, field):
    values = [(row["imageIndex"], _value(row, field)) for row in sources if row.get("kind") == kind]
    values = [(index, value) for index, value in values if value]
    return "；".join(f"图片 {index}：{value}" if len(values) > 1 else value for index, value in values)


class RecognitionReview:
    """Record explicit rule outcomes while facts are merged; format only once."""

    def __init__(self):
        self.comparisons = {}

    def compare(self, field, warning, reminder=""):
        self.comparisons.setdefault(field, []).append((warning, reminder))

    def build(self, evidence, sources):
        rows, handled, extra = [], set(), []
        for field, label in FIELDS.items():
            annotations = self.comparisons.get(field)
            if not annotations:
                continue
            husbandry, purchase = (
                _source_values(sources, "husbandry", field),
                _source_values(sources, "purchase", field),
            )
            if not husbandry or not purchase:
                continue
            calculation = evidence.get("quantityCalculation") or {}
            if (
                field == "quantity"
                and calculation.get("status") == "calculated"
                and calculation.get("actualQuantity") is not None
            ):
                purchase += f"；本次实际 {calculation['actualQuantity']} 只"
            rows.append({"key": field, "label": label, "husbandry": husbandry, "purchase": purchase})
            for warning, reminder in annotations:
                handled.add(warning)
                if reminder:
                    extra.append(reminder)
        reminders = [warning for warning in evidence["warnings"] if warning not in handled]
        return {"version": 1, "comparisons": rows, "reminders": list(dict.fromkeys([*reminders, *extra]))}
