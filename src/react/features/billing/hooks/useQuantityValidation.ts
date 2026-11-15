import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { QuantitySheet } from "../../../api/contracts";
import { quantitySheetValidationIssues, type QuantitySheetValidationIssue } from "../../../../domain/quantitySheets";
import type { QuantityRowHandle } from "../components/quantityEntry";
import { focusQuantityValidationIssue } from "../quantityValidation";

/** Validation owns presentation and row errors; the editor keeps the draft and save flow. */
export function useQuantityValidation(rowRefs: MutableRefObject<Array<QuantityRowHandle | null>>) {
  const [validationIssues, setValidationIssues] = useState<QuantitySheetValidationIssue[]>([]);
  const [validationRowsExpanded, setValidationRowsExpanded] = useState(false);
  const focusFrame = useRef<number | null>(null);
  const cancelFocus = useCallback(() => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
  }, []);
  useEffect(() => cancelFocus, [cancelFocus]);

  const validateSheet = useCallback(
    (sheet: QuantitySheet, form?: HTMLFormElement) => {
      const issues = quantitySheetValidationIssues(sheet).map((issue) =>
        issue.field === "animalCount" && !issue.rowId
          ? { ...issue, rowId: rowRefs.current.find(Boolean)?.getRow().id }
          : issue,
      );
      setValidationIssues(issues.filter((issue) => !issue.rowId));
      rowRefs.current.forEach((handle) => {
        if (handle) handle.setValidationIssues?.(issues.filter((issue) => issue.rowId === handle.getRow().id));
      });
      // Keep mounted inputs until an explicit editor reset: native min/step errors
      // may remain after domain errors have been corrected.
      if (issues.some((issue) => issue.rowId)) setValidationRowsExpanded(true);
      cancelFocus();
      if (form && issues.length) {
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = null;
          focusQuantityValidationIssue(form, issues[0]);
        });
      }
      return issues;
    },
    [rowRefs, cancelFocus],
  );

  const resetValidation = useCallback(() => {
    cancelFocus();
    setValidationIssues([]);
    setValidationRowsExpanded(false);
  }, [cancelFocus]);

  return { validationIssues, setValidationIssues, validationRowsExpanded, validateSheet, resetValidation };
}
