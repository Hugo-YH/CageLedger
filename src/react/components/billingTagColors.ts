import { tagColors } from "../../theme/visual-system.mjs";

export function workflowTagColor(status?: string) {
  return tagColors.workflow[status as keyof typeof tagColors.workflow] ?? tagColors.status.default;
}
