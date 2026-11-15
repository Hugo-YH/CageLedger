import type { QuantitySheetValidationIssue } from "../../../domain/quantitySheets";

export type QuantityValidationTarget = Omit<QuantitySheetValidationIssue, "message">;

export function quantityValidationId(target: QuantityValidationTarget) {
  if (target.rowId) return `quantity-row-${encodeURIComponent(target.rowId)}-${target.field}`;
  if (target.segmentId)
    return `quantity-segment-${encodeURIComponent(target.segmentId)}-${target.segmentField ?? "section"}`;
  return target.field === "customBillingSegments"
    ? "quantity-custom-billing-segments"
    : `quantity-sheet-${target.field === "roomId" ? "room" : target.field}`;
}

function matches(issue: QuantitySheetValidationIssue, target: QuantityValidationTarget) {
  return (
    issue.field === target.field &&
    issue.rowId === target.rowId &&
    issue.segmentId === target.segmentId &&
    issue.segmentField === target.segmentField
  );
}

export function quantityValidationProps(issues: QuantitySheetValidationIssue[], target: QuantityValidationTarget) {
  const invalid = issues.some((issue) => matches(issue, target));
  const id = quantityValidationId(target);
  return {
    id,
    status: invalid ? ("error" as const) : undefined,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? `${id}-error` : undefined,
  };
}

export function quantityValidationMessages(issues: QuantitySheetValidationIssue[], target: QuantityValidationTarget) {
  return issues.filter((issue) => matches(issue, target)).map((issue) => issue.message);
}

export function focusQuantityValidationIssue(form: HTMLFormElement, issue: QuantitySheetValidationIssue) {
  const element = form.ownerDocument.getElementById(quantityValidationId(issue));
  if (!(element instanceof HTMLElement) || !form.contains(element)) return;
  const control = element.matches("input,button,[tabindex]")
    ? element
    : element.querySelector<HTMLElement>("input,button,[tabindex]");
  (control ?? element).focus({ preventScroll: true });
  (element.closest<HTMLElement>(".ant-select,.ant-picker") ?? element).scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "instant",
  });
}
