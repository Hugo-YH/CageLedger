export type IacucValidityColor = "blue" | "warning" | "error";

function dateValue(value?: string) {
  const parts = value?.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T ])/);
  if (!parts) return undefined;
  const [year, month, day] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Shared with the saved-sheet tag: expired red, within 90 days amber, otherwise blue. */
export function iacucExpiryStatus(endDate: string, today = localToday()) {
  const end = dateValue(endDate);
  if (!end) return { color: "error" as const, label: "有效期异常，请确认" };
  const days = Math.round((Date.parse(end) - Date.parse(today)) / 86_400_000);
  const color: IacucValidityColor = days < 0 ? "error" : days <= 90 ? "warning" : "blue";
  return { color, label: `${end} ${days < 0 ? "已到期" : days <= 90 ? "即将到期" : "到期"}` };
}

export function iacucValidityStatus(
  application: { projectStartDate?: string; projectEndDate?: string } | undefined,
  month: string,
  today = localToday(),
) {
  const start = dateValue(application?.projectStartDate);
  const end = dateValue(application?.projectEndDate);
  if (!start || !end) {
    return { color: "error" as const, label: "未获取完整有效期，请确认", detail: "请核对 IACUC 编号及项目起止日期。" };
  }
  const detail = `有效期：${start} 至 ${end}。`;
  if (start > end) return { color: "error" as const, label: "有效期异常，请确认", detail };
  if (/^\d{4}-\d{2}$/.test(month) && month < start.slice(0, 7)) {
    return { color: "error" as const, label: "统计月份早于伦理开始日期，请确认", detail };
  }
  if (today < start) return { color: "error" as const, label: `${start} 开始，尚未生效，请确认`, detail };
  if (/^\d{4}-\d{2}$/.test(month) && month > end.slice(0, 7)) {
    return { color: "error" as const, label: "统计月份晚于伦理结束日期，请确认", detail };
  }
  return { ...iacucExpiryStatus(end, today), detail };
}
