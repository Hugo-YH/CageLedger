import type { GlobalToken } from "antd";
import type { Occupancy } from "../../../api/contracts";
import { splitPersonNames } from "../../../../domain/personNames";

const families = ["blue", "cyan", "purple", "green", "geekblue", "magenta", "volcano", "lime"] as const;

export interface RoomProjectColor {
  iacuc: string;
  principal: string;
  fill: string;
}

export function cageProjectKey(iacuc: string | undefined) {
  return (iacuc ?? "").normalize("NFKC").trim().toUpperCase();
}

function hash(text: string) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function roomProjectColors(occupancies: Iterable<Occupancy>, token: GlobalToken) {
  const principals = new Map<string, string>();
  for (const occupancy of occupancies) {
    const iacuc = cageProjectKey(occupancy.iacuc);
    if (!iacuc) continue;
    const principal = splitPersonNames(occupancy.pi).sort().join("、");
    const current = principals.get(iacuc);
    if (!current || (principal && principal < current)) principals.set(iacuc, principal);
  }
  const familyByPrincipal = new Map<string, (typeof families)[number]>();
  const usedFamilies = new Set<(typeof families)[number]>();
  const colors = new Map<string, RoomProjectColor>();
  const shadeByPrincipal = new Map<string, number>();
  const ordered = [...principals].sort(
    ([leftId, left], [rightId, right]) => left.localeCompare(right, "zh-CN") || leftId.localeCompare(rightId),
  );
  for (const [iacuc, principal] of ordered) {
    const group = principal || iacuc;
    let family = familyByPrincipal.get(group);
    if (!family) {
      const start = hash(group) % families.length;
      const preferred = [...families.slice(start), ...families.slice(0, start)];
      family = preferred.find((candidate) => !usedFamilies.has(candidate)) ?? families[start];
      familyByPrincipal.set(group, family);
      usedFamilies.add(family);
    }
    const shade = shadeByPrincipal.get(group) ?? 0;
    shadeByPrincipal.set(group, shade + 1);
    const level = ([1, 2, 3] as const)[shade % 3];
    colors.set(iacuc, { iacuc, principal, fill: token[`${family}${level}`] });
  }
  return colors;
}
