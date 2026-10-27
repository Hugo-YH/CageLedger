import type { IntakeRecognitionEvidence, IntakeRecognitionSource } from "../../../contracts/intake";

type ReviewField = "strain" | "specification" | "quantity" | "supplier";

type Comparison = { key: string; label: string; husbandry: string; purchase: string };

const fields: Array<{ key: ReviewField; label: string; pattern: RegExp }> = [
  { key: "strain", label: "品系/商品名", pattern: /品系|商品名|商品名称/ },
  { key: "specification", label: "体重/日龄（规格）", pattern: /规格|体重|日龄|周龄|月龄/ },
  { key: "quantity", label: "数量", pattern: /数量|只数/ },
  { key: "supplier", label: "供应商", pattern: /供应商|供货商/ },
];

function valueFor(source: IntakeRecognitionSource, field: ReviewField): string {
  if (field === "strain") return (source.strainRaw || source.productName || "").trim();
  if (field === "specification") return (source.specification || "").trim();
  if (field === "supplier") return (source.supplier || "").trim();
  if (source.quantity == null) return "";
  const gift = source.kind === "purchase" ? source.quantityFacts?.giftQuantity : null;
  return `${source.quantity} 只${gift != null ? `（赠送 ${gift} 只）` : ""}`;
}

function sourceValues(sources: IntakeRecognitionSource[], kind: "husbandry" | "purchase", field: ReviewField): string {
  const entries = sources
    .filter((source) => source.kind === kind)
    .map((source) => ({
      index: source.imageIndex,
      value: valueFor(source, field),
    }))
    .filter((entry) => entry.value);
  return entries.map((entry) => (entries.length > 1 ? `图片 ${entry.index}：${entry.value}` : entry.value)).join("；");
}

/** Groups only conflicts explicitly reported by recognition; raw values alone do not imply a conflict. */
export function buildRecognitionReview(evidence: IntakeRecognitionEvidence): {
  comparisons: Comparison[];
  reminders: string[];
} {
  const sources = evidence.sources ?? [];
  const warnings = [...new Set(evidence.warnings.filter((warning) => warning.trim()))];
  const comparisons: Comparison[] = [];
  const handled = new Set<string>();
  const additionalReminders: string[] = [];

  for (const field of fields) {
    const matching = warnings.filter(
      (warning) =>
        field.pattern.test(warning) &&
        /差异|不一致|冲突/.test(warning) &&
        !/同类|单方面|雌雄|性别|笼数|笼卡|原规格与|采购明细数量与逐图/.test(warning.split(/[；;，,。]/)[0]),
    );
    if (!matching.length) continue;
    const husbandry = sourceValues(sources, "husbandry", field.key);
    let purchase = sourceValues(sources, "purchase", field.key);
    if (!husbandry || !purchase) continue;
    const calculation = evidence.quantityCalculation;
    if (field.key === "quantity" && calculation?.status === "calculated" && calculation.actualQuantity != null) {
      purchase += `；本次实际 ${calculation.actualQuantity} 只`;
    }
    comparisons.push({ key: field.key, label: field.label, husbandry, purchase });
    for (const warning of matching) {
      // The table replaces repeated comparison prose; source warnings remain in the raw evidence.
      const firstPart = warning.split(/[；;]/)[0];
      const extra = warning.split(/[；;]/).slice(1).join("；").trim();
      const standard =
        /^(动物品系|体重\/日龄（规格）)差异：饲养需求为“[^”]*”，采购信息为“[^”]*”，已采用采购信息。$/.test(firstPart);
      const standardQuantity = /^本批数量差异：饲养需求为\d+只，本次采购实际数量为\d+只，已按采购信息回填$/.test(
        firstPart,
      );
      if (extra && (standard || standardQuantity)) {
        additionalReminders.push(extra);
        handled.add(warning);
        continue;
      }
      const lastDifference = [...warning.matchAll(/差异|不一致|冲突/g)].at(-1);
      const tail = lastDifference
        ? warning.slice(lastDifference.index + lastDifference[0].length).replace(/^[：:，,\s]+/, "")
        : "";
      if (
        (standard && !extra) ||
        /^(?:已(?:优先)?采用采购(?:信息|规格|数量)[，,]?)?(?:(?:需|请)(?:人工)?核对)?[。！!\s]*$/.test(tail)
      ) {
        handled.add(warning);
      } else if (lastDifference && !tail.includes("饲养需求") && !tail.includes("采购信息为")) {
        // Preserve unfamiliar instructions instead of assuming the comparison table replaces them.
        additionalReminders.push(tail);
        handled.add(warning);
      }
    }
  }
  return {
    comparisons,
    reminders: [...new Set([...warnings.filter((warning) => !handled.has(warning)), ...additionalReminders])],
  };
}
