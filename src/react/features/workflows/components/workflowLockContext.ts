import { createContext } from "react";
import type { WorkflowAdvancePayload } from "../../../api/workflows";

/** Shared write guard; only controls that need it subscribe to its transient state. */
export const WorkflowLockContext = createContext<{
  pending: boolean;
  activeId: string;
  onAdvance: (payload: WorkflowAdvancePayload) => Promise<void>;
} | null>(null);
