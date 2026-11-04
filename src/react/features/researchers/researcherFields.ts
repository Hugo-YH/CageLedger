import type { Researcher, ResearcherEditable } from "../../../contracts/researchers";

export const RESEARCHER_FIELDS = [
  ["name", "姓名"],
  ["alias", "别名"],
  ["department", "部门"],
  ["position", "职务"],
  ["mobile", "手机"],
  ["telephone", "座机"],
  ["email", "邮箱"],
  ["enterpriseEmail", "企业邮箱"],
] as const;

export function researcherEditable(item: Researcher): ResearcherEditable {
  return {
    name: item.name,
    alias: item.alias,
    department: item.department,
    position: item.position,
    gender: item.gender,
    mobile: item.mobile,
    telephone: item.telephone,
    email: item.email,
    enterpriseEmail: item.enterpriseEmail,
    englishName: item.englishName,
    sourceDisabled: item.sourceDisabled,
    activationStatus: item.activationStatus,
  };
}

export function researcherError(error: unknown) {
  return error instanceof Error ? error.message : "请求未完成，请重试";
}

export function displayResearcherValue(value: string | boolean) {
  return typeof value === "boolean" ? (value ? "是" : "否") : value || "—";
}
