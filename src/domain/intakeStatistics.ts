import type { IacucIndexItem } from "../contracts/administration";
import type { IntakeBatch, IntakeStatisticsPrincipal } from "../contracts/intake";
import { isDirectSampling } from "./intake";

export interface IntakeStatisticsTotals {
  batches: number;
  cages: number;
  unknownCages: number;
  samplingBatches: number;
  animals: number;
  unknownAnimals: number;
}

export interface IntakeStatisticsPerson extends IntakeStatisticsTotals {
  key: string;
  pi: string;
  iacucs: string[];
}

export interface IntakeStatisticsRoom extends IntakeStatisticsTotals {
  name: string;
  people: IntakeStatisticsPerson[];
}

export interface IntakeStatisticsDay extends IntakeStatisticsTotals {
  date: string;
  rooms: IntakeStatisticsRoom[];
  sampling: IntakeStatisticsPerson[];
}

export interface IntakeStatistics extends IntakeStatisticsTotals {
  days: IntakeStatisticsDay[];
  issues: { id: string; batchNo: string; iacuc: string; reasons: string[] }[];
}

export const intakeStatisticsCode = (value: string) => value.trim().toUpperCase();
const cleanName = (value: string) => (value || "").replace(/[\t\r\n]+/g, "").trim();
const compare = (left: string, right: string) => left.localeCompare(right, "zh-CN", { numeric: true });
const totals = (): IntakeStatisticsTotals => ({
  batches: 0,
  cages: 0,
  unknownCages: 0,
  samplingBatches: 0,
  animals: 0,
  unknownAnimals: 0,
});

export function resolveStatisticsPrincipal(
  code: string,
  response: { items: IacucIndexItem[]; count?: number },
): IntakeStatisticsPrincipal {
  const matches = response.items.filter((item) => intakeStatisticsCode(item.iacuc) === code);
  if (!matches.length) return { pi: "", issue: "项目汇总表未找到该 IACUC" };
  const names = matches.map((item) => cleanName(item.pi));
  if (names.some((name) => !name || name === "-")) return { pi: "", issue: "项目汇总表未填写项目负责人" };
  if (new Set(names).size !== 1 || (response.count ?? response.items.length) > response.items.length) {
    return { pi: "", issue: "项目汇总表的项目负责人匹配不唯一" };
  }
  return { pi: names[0] };
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function add(target: IntakeStatisticsTotals, source: IntakeStatisticsTotals) {
  for (const key of Object.keys(source) as (keyof IntakeStatisticsTotals)[]) target[key] += source[key];
}

export function buildIntakeStatistics(
  items: IntakeBatch[],
  principals: Record<string, IntakeStatisticsPrincipal>,
): IntakeStatistics {
  const result: IntakeStatistics = { ...totals(), days: [], issues: [] };
  for (const item of new Map(items.map((item) => [item.id, item])).values()) {
    const direct = isDirectSampling(item);
    const iacuc = intakeStatisticsCode(item.iacuc);
    const principal = principals[iacuc];
    const pi = principal?.pi || "";
    const date = validDate(item.intakeDate) ? item.intakeDate : "";
    const roomName = item.roomName.trim();
    const reasons: string[] = [];
    if (!date) reasons.push("接收日期未填写或无效");
    if (!pi) reasons.push(!iacuc ? "IACUC 未填写" : principal?.issue || "项目负责人尚未匹配");
    if (!direct && !roomName) reasons.push("饲养间未填写");
    const count = direct ? item.quantity : item.finalCardCount;
    const determined = typeof count === "number" && Number.isSafeInteger(count) && count > 0;
    if (!determined) reasons.push(direct ? "动物数量待确认" : "最终笼卡张数未确定，笼数待确认");
    const amount: IntakeStatisticsTotals = {
      ...totals(),
      batches: 1,
      cages: !direct && determined ? count : 0,
      unknownCages: !direct && !determined ? 1 : 0,
      samplingBatches: direct ? 1 : 0,
      animals: direct && determined ? count : 0,
      unknownAnimals: direct && !determined ? 1 : 0,
    };
    let day = result.days.find((entry) => entry.date === date);
    if (!day) result.days.push((day = { ...totals(), date, rooms: [], sampling: [] }));
    let people = day.sampling;
    let room: IntakeStatisticsRoom | undefined;
    if (!direct) {
      const name = roomName || "饲养间未填写";
      room = day.rooms.find((entry) => entry.name === name);
      if (!room) day.rooms.push((room = { ...totals(), name, people: [] }));
      people = room.people;
    }
    const key = pi ? `pi:${pi}` : `unknown:${iacuc}`;
    let person = people.find((entry) => entry.key === key);
    if (!person) people.push((person = { ...totals(), key, pi, iacucs: [] }));
    if (iacuc && !person.iacucs.includes(iacuc)) person.iacucs.push(iacuc);
    for (const entry of [result, day, person, ...(room ? [room] : [])]) add(entry, amount);
    if (reasons.length) result.issues.push({ id: item.id, batchNo: item.batchNo || item.id, iacuc, reasons });
  }
  result.days.sort((a, b) => (a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : b.date ? 1 : 0));
  for (const day of result.days) {
    day.rooms.sort((a, b) => compare(a.name, b.name));
    for (const people of [day.sampling, ...day.rooms.map((room) => room.people)]) {
      people.sort((a, b) => (a.pi ? (b.pi ? compare(a.pi, b.pi) : -1) : b.pi ? 1 : compare(a.key, b.key)));
      people.forEach((person) => person.iacucs.sort(compare));
    }
  }
  return result;
}

export function intakeStatisticsDate(date: string) {
  if (!date) return "接收日期待确认";
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function intakeStatisticsCages(value: IntakeStatisticsTotals) {
  return `${value.cages} 笼${value.unknownCages ? `（另有 ${value.unknownCages} 批笼数待确认）` : ""}`;
}

export function intakeStatisticsAnimals(value: IntakeStatisticsTotals) {
  return `${value.animals} 只${value.unknownAnimals ? `（另有 ${value.unknownAnimals} 批数量待确认）` : ""}`;
}

export function intakeStatisticsPersonName(value: IntakeStatisticsPerson) {
  return value.pi || `项目负责人待确认（${value.iacucs.join("、") || "IACUC 未填写"}）`;
}

export function intakeStatisticsText(report: IntakeStatistics) {
  const lines = ["接收批次统计", `已选 ${report.batches} 批｜饲养 ${intakeStatisticsCages(report)}`];
  if (report.samplingBatches)
    lines.push(`直接取材 ${report.samplingBatches} 批｜${intakeStatisticsAnimals(report)}（不计笼数）`);
  for (const day of report.days) {
    lines.push("", `${intakeStatisticsDate(day.date)}　${intakeStatisticsCages(day)}`);
    for (const room of day.rooms) {
      lines.push("", `${room.name}　${intakeStatisticsCages(room)}`);
      for (const person of room.people)
        lines.push(`- ${intakeStatisticsPersonName(person)}　${intakeStatisticsCages(person)}（${person.batches} 批）`);
    }
    if (day.samplingBatches) {
      lines.push("", `直接取材　${day.samplingBatches} 批｜${intakeStatisticsAnimals(day)}（不计笼数）`);
      for (const person of day.sampling)
        lines.push(`- ${intakeStatisticsPersonName(person)}　${person.batches} 批｜${intakeStatisticsAnimals(person)}`);
    }
  }
  if (report.issues.length) {
    lines.push("", "待确认信息");
    for (const issue of report.issues)
      lines.push(`- ${issue.batchNo}（${issue.iacuc || "IACUC 未填写"}）：${issue.reasons.join("；")}`);
  }
  return lines.join("\n");
}
