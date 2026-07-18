import type { SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
import { InspectionEntry } from "./InspectionEntry";
import { InspectionFindings, InspectionRecords } from "./InspectionLists";
import { InspectionStandards } from "./InspectionStandards";

export type AnimalManagementMode = "entry" | "findings" | "records" | "standards";

export function AnimalManagementView({
  mode,
  user,
  navigate,
}: {
  mode: AnimalManagementMode;
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
}) {
  if (mode === "findings") return <InspectionFindings navigate={navigate} />;
  if (mode === "records") return <InspectionRecords user={user} navigate={navigate} />;
  if (mode === "standards") return <InspectionStandards user={user} navigate={navigate} />;
  return <InspectionEntry navigate={navigate} />;
}
