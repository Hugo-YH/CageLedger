import type { QuantitySheetValidationIssue } from "../../../../domain/quantitySheets";
import { quantityValidationId, quantityValidationMessages, type QuantityValidationTarget } from "../quantityValidation";

export function QuantityFieldError({
  issues,
  target,
}: {
  issues: QuantitySheetValidationIssue[];
  target: QuantityValidationTarget;
}) {
  const messages = quantityValidationMessages(issues, target);
  return messages.length ? (
    <div id={`${quantityValidationId(target)}-error`} className="quantity-field-error">
      {[...new Set(messages)].join("；")}
    </div>
  ) : null;
}
