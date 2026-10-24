import type { FindingStatus, InspectionModuleCode } from "../../api/contracts";

export const pageSize = 10;

export function moduleLabel(code: InspectionModuleCode) {
  return code === "basicAssessment" ? "基础" : code === "advancedAssessment" ? "进阶" : "异常小鼠";
}

export function findingStatusColor(status: FindingStatus) {
  return status === "resolved" ? "green" : status === "pending" ? "gold" : "blue";
}

export function formatDate(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}
