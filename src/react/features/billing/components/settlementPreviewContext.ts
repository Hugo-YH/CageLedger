import { createContext } from "react";
import type { SettlementCandidate, SessionUser } from "../../../api/contracts";

export const SettlementPreviewContext = createContext<{
  pending: boolean;
  previewingId: string;
  open: (candidate: SettlementCandidate, trigger?: HTMLElement) => void;
} | null>(null);

export function canWithdrawCandidate(candidate: SettlementCandidate, user: SessionUser) {
  return Boolean(
    candidate.hasWorkflow &&
    (candidate.workflowStatus === "statement_generated" || candidate.workflowStatus === "statement_sent") &&
    (candidate.canWithdraw ?? user.role === "admin"),
  );
}
