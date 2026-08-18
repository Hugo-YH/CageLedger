/**
 * 生成默认报销单号前缀：BXD1001 + 当前年月 + 000。
 * 工作人员只需在末尾补充三位编号，最终形如 BXD1001202608000123。
 */
export function defaultReimbursementFormNo(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `BXD1001${year}${month}000`;
}
