import { useState, type PropsWithChildren } from "react";
import { WorkspaceMemory } from "./workspaceMemory";

/** Account-scoped session UI memory; unmounted at logout. */
export function WorkspaceMemoryProvider({ children }: PropsWithChildren) {
  const [memory] = useState(() => new Map<string, unknown>());
  return <WorkspaceMemory.Provider value={memory}>{children}</WorkspaceMemory.Provider>;
}
