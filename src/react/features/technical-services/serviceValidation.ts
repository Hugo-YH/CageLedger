import dayjs from "dayjs";
import type { TechnicalServiceSheet } from "../../../contracts/technicalServices";

/** Mirror the existing server constraints; never silently round billable quantities. */
export function serviceRowErrors(sheet: Pick<TechnicalServiceSheet, "month" | "rows">, unit: string) {
  const counts = new Map<string, number>();
  for (const row of sheet.rows) counts.set(row.date, (counts.get(row.date) || 0) + 1);
  return sheet.rows.map((row) => {
    const date =
      !row.date || !dayjs(row.date).isValid() || dayjs(row.date).format("YYYY-MM-DD") !== row.date
        ? "请选择有效的服务日期"
        : row.date.slice(0, 7) !== sheet.month
          ? "日期须属于所选月份"
          : (counts.get(row.date) || 0) > 1
            ? "服务日期不能重复"
            : "";
    const quantity =
      !Number.isFinite(row.quantity) || row.quantity < 0 || row.quantity > 1_000_000
        ? "数量须为 0 至 100 万之间的有效数字"
        : unit === "小时" && row.quantity > 0 && row.quantity < 1
          ? "不足 1 小时按 1 小时计费，请填写已确认的计费小时数"
          : unit && unit !== "小时" && !Number.isInteger(row.quantity)
            ? "此服务的计费数量须为整数"
            : "";
    return { date, quantity };
  });
}
