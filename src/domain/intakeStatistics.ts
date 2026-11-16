import type { IacucIndexItem } from "../contracts/administration";
import type { IntakeBatch, IntakeStatisticsPrincipal } from "../contracts/intake";
import { isDirectSampling } from "./intake";
import { formatPersonNames } from "./personNames";

export interface IntakeStatisticsTotals {
  batches: number;
  cages: number;
  unknownCages: number;
  samplingBatches: number;
  animals: number;
  unknownAnimals: number;
  housingAnimals: number;
  unknownHousingAnimals: number;
}

interface IntakeStatisticsStrain extends IntakeStatisticsTotals {
  name: string;
}

interface IntakeStatisticsProject extends IntakeStatisticsTotals {
  code: string;
  strains: IntakeStatisticsStrain[];
}

export interface IntakeStatisticsPerson extends IntakeStatisticsTotals {
  key: string;
  pi: string;
  iacucs: string[];
  projects: IntakeStatisticsProject[];
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
  housingAnimals: 0,
  unknownHousingAnimals: 0,
});

export function resolveStatisticsPrincipal(
  code: string,
  response: { items: Pick<IacucIndexItem, "iacuc" | "pi">[]; count?: number },
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
  for (const key of Object.keys(totals()) as (keyof IntakeStatisticsTotals)[]) target[key] += source[key];
}

function addToDay(
  days: IntakeStatisticsDay[],
  item: { date: string; roomName: string; pi: string; iacuc: string; strain: string; direct: boolean },
  amount: IntakeStatisticsTotals,
) {
  const { date, roomName, pi, iacuc, strain, direct } = item;
  let day = days.find((entry) => entry.date === date);
  if (!day) days.push((day = { ...totals(), date, rooms: [], sampling: [] }));
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
  if (!person) people.push((person = { ...totals(), key, pi, iacucs: [], projects: [] }));
  if (iacuc && !person.iacucs.includes(iacuc)) person.iacucs.push(iacuc);
  let project = person.projects.find((entry) => entry.code === iacuc);
  if (!project) person.projects.push((project = { ...totals(), code: iacuc, strains: [] }));
  let strainGroup = project.strains.find((entry) => entry.name === strain);
  if (!strainGroup) project.strains.push((strainGroup = { ...totals(), name: strain }));
  for (const entry of [day, person, project, strainGroup, ...(room ? [room] : [])]) add(entry, amount);
}

function sortDays(days: IntakeStatisticsDay[]) {
  days.sort((a, b) => (a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : b.date ? 1 : 0));
  for (const day of days) {
    day.rooms.sort((a, b) => compare(a.name, b.name));
    for (const people of [day.sampling, ...day.rooms.map((room) => room.people)]) {
      people.sort((a, b) => (a.pi ? (b.pi ? compare(a.pi, b.pi) : -1) : b.pi ? 1 : compare(a.key, b.key)));
      for (const person of people) {
        person.iacucs.sort(compare);
        person.projects.sort((a, b) => (a.code ? (b.code ? compare(a.code, b.code) : -1) : b.code ? 1 : 0));
        for (const project of person.projects)
          project.strains.sort((a, b) => (a.name ? (b.name ? compare(a.name, b.name) : -1) : b.name ? 1 : 0));
      }
    }
  }
}

function knownCount(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function buildIntakeStatistics(
  items: Pick<
    IntakeBatch,
    | "id"
    | "batchNo"
    | "iacuc"
    | "intakeDate"
    | "roomName"
    | "intakePurpose"
    | "quantity"
    | "finalCardCount"
    | "strainStandard"
    | "strainRaw"
  >[],
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
    const animalCount = knownCount(item.quantity) ? item.quantity : 0;
    const animalsDetermined = animalCount > 0;
    const cagesDetermined = knownCount(item.finalCardCount);
    if (!animalsDetermined) reasons.push("动物数量待确认");
    if (!direct && !cagesDetermined) reasons.push("最终笼卡张数未确定，笼数待确认");
    const amount: IntakeStatisticsTotals = {
      ...totals(),
      batches: 1,
      cages: !direct && cagesDetermined ? item.finalCardCount : 0,
      unknownCages: !direct && !cagesDetermined ? 1 : 0,
      samplingBatches: direct ? 1 : 0,
      animals: direct ? animalCount : 0,
      unknownAnimals: direct && !animalsDetermined ? 1 : 0,
      housingAnimals: !direct ? animalCount : 0,
      unknownHousingAnimals: !direct && !animalsDetermined ? 1 : 0,
    };
    const strain = [item.strainStandard, item.strainRaw].map(cleanName).find((name) => name && name !== "-") || "";
    addToDay(result.days, { date, roomName, pi, iacuc, strain, direct }, amount);
    add(result, amount);
    if (reasons.length) result.issues.push({ id: item.id, batchNo: item.batchNo || item.id, iacuc, reasons });
  }
  sortDays(result.days);
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

export function intakePlannedTransferDate(date: string) {
  if (!validDate(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() + (weekday === 0 ? 1 : 8 - weekday));
  return parsed.toISOString().slice(0, 10);
}

function briefingCount(value: number, unknown: number, unit: string, label: string) {
  if (!unknown) return `${value} ${unit}`;
  return value > 0 ? `已知 ${value} ${unit}（另有${label}待确认）` : `${label}待确认`;
}

function briefingTotals(value: IntakeStatisticsTotals, sampling = false) {
  const unknownAnimals = sampling ? value.unknownAnimals : value.unknownHousingAnimals;
  const animals = briefingCount(sampling ? value.animals : value.housingAnimals, unknownAnimals, "只", "只数");
  if (sampling) return `${unknownAnimals ? "" : "共 "}${animals}`;
  const cages = briefingCount(value.cages, value.unknownCages, "笼", "笼数");
  return `${unknownAnimals || value.unknownCages ? "" : "共 "}${animals}，${cages}`;
}

function briefingPeople(people: IntakeStatisticsPerson[], sampling = false) {
  return people.flatMap((person) => {
    const name = person.pi ? formatPersonNames(person.pi) : intakeStatisticsPersonName(person);
    const lines = [`- ${name}　${briefingTotals(person, sampling)}`];
    for (const project of person.projects) {
      const code = project.code ? `伦理 ${project.code}` : "伦理待确认";
      if (project.strains.length === 1) {
        const strain = project.strains[0];
        lines.push(
          `  · ${code}｜${strain.name ? `品系 ${strain.name}` : "品系待确认"}　${briefingTotals(strain, sampling)}`,
        );
      } else {
        lines.push(`  · ${code}　${briefingTotals(project, sampling)}`);
        for (const strain of project.strains)
          lines.push(
            `    - ${strain.name ? `品系 ${strain.name}` : "品系待确认"}　${briefingTotals(strain, sampling)}`,
          );
      }
    }
    return lines;
  });
}

export function intakeStatisticsText(report: IntakeStatistics) {
  const days: IntakeStatisticsDay[] = [];
  for (const day of report.days) {
    for (const room of day.rooms) {
      for (const person of room.people) {
        for (const project of person.projects) {
          for (const strain of project.strains)
            addToDay(
              days,
              {
                date: intakePlannedTransferDate(day.date),
                roomName: room.name,
                pi: person.pi,
                iacuc: project.code,
                strain: strain.name,
                direct: false,
              },
              strain,
            );
        }
      }
    }
  }
  sortDays(days);
  const lines = ["饲养间接收简报"];
  if (days.length) lines.push("以下动物预计由检疫间转入各饲养间。", `饲养合计：${briefingTotals(report)}`);
  else lines.push("本次未选择转入饲养间的动物。");
  for (const day of days) {
    lines.push("", day.date ? `预计转入：${intakeStatisticsDate(day.date)}` : "预计转入日期待确认");
    for (const room of day.rooms)
      lines.push(
        "",
        `${room.name}${room.name === "饲养间未填写" ? "" : " 饲养间"}　${briefingTotals(room)}`,
        ...briefingPeople(room.people),
      );
  }
  if (report.samplingBatches) {
    lines.push("", "直接取材（不转入饲养间）", `合计：${briefingTotals(report, true)}`);
    for (const day of report.days) {
      if (day.samplingBatches)
        lines.push("", `预约接收：${intakeStatisticsDate(day.date)}`, ...briefingPeople(day.sampling, true));
    }
  }
  if (report.issues.length) {
    lines.push("", "待确认信息");
    const issues = new Map<string, Set<string>>();
    for (const issue of report.issues) {
      const reasons = issues.get(issue.iacuc) ?? new Set<string>();
      issue.reasons.forEach((reason) => reasons.add(reason));
      issues.set(issue.iacuc, reasons);
    }
    for (const [code, reasons] of issues)
      lines.push(`- ${code ? `伦理 ${code}` : "伦理待确认（IACUC 未填写）"}：${[...reasons].join("；")}`);
  }
  return lines.join("\n");
}
