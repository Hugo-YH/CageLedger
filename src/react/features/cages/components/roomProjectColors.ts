import type { GlobalToken } from "antd";
import type { CageSlot, Occupancy } from "../../../api/contracts";
import { splitPersonNames } from "../../../../domain/personNames";

// Ant color families in hue order. Use the same assignments in both themes.
const families = ["volcano", "gold", "green", "cyan", "blue", "purple", "magenta"] as const;
const shades = [2, 3] as const;
const swatches = families.flatMap((_, hue) => shades.map((shade) => ({ hue, shade })));
type Swatch = (typeof swatches)[number];

export function cageProjectKey(iacuc: string | undefined) {
  return (iacuc ?? "").normalize("NFKC").trim().toUpperCase();
}

function hash(text: string) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

function neighboringProjects(slots: readonly CageSlot[], occupancyBySlot: ReadonlyMap<string, Occupancy>) {
  const positions = new Map<string, string>();
  for (const { id, rackId, row, col } of slots) {
    const iacuc = cageProjectKey(occupancyBySlot.get(id)?.iacuc);
    if (iacuc) positions.set(`${rackId}:${row}:${col}`, iacuc);
  }
  const neighbors = new Map<string, Set<string>>();
  for (const { rackId, row, col } of slots) {
    const iacuc = positions.get(`${rackId}:${row}:${col}`);
    if (!iacuc) continue;
    for (const adjacent of [
      positions.get(`${rackId}:${row + 1}:${col}`),
      positions.get(`${rackId}:${row}:${col + 1}`),
    ]) {
      if (!adjacent || adjacent === iacuc) continue;
      const current = neighbors.get(iacuc) ?? new Set<string>();
      const other = neighbors.get(adjacent) ?? new Set<string>();
      current.add(adjacent);
      other.add(iacuc);
      neighbors.set(iacuc, current);
      neighbors.set(adjacent, other);
    }
  }
  return neighbors;
}

function separation(left: Swatch, right: Swatch) {
  const distance = Math.abs(left.hue - right.hue);
  return Math.min(distance, families.length - distance) * shades.length + Number(left.shade !== right.shade);
}

export function roomProjectColors(
  slots: readonly CageSlot[],
  occupancyBySlot: ReadonlyMap<string, Occupancy>,
  token: GlobalToken,
) {
  const principals = new Map<string, string>();
  for (const occupancy of occupancyBySlot.values()) {
    const iacuc = cageProjectKey(occupancy.iacuc);
    if (!iacuc) continue;
    const principal = splitPersonNames(occupancy.pi).sort().join("、");
    const current = principals.get(iacuc);
    if (!current || (principal && principal < current)) principals.set(iacuc, principal);
  }
  const ordered = [...principals].sort(
    ([leftId, left], [rightId, right]) => left.localeCompare(right, "zh-CN") || leftId.localeCompare(rightId),
  );
  const neighbors = neighboringProjects(slots, occupancyBySlot);
  // Start with projects that touch the most other projects.
  const priority = [...ordered].sort(
    ([left], [right]) => (neighbors.get(right)?.size ?? 0) - (neighbors.get(left)?.size ?? 0),
  );
  const chosen = new Map<string, Swatch>();
  const firstHueByPrincipal = new Map<string, number>();
  const usedHues = new Set<number>();
  const usedSwatches = new Set<Swatch>();
  for (const [iacuc, principal] of priority) {
    const group = principal || iacuc;
    const groupHue = firstHueByPrincipal.get(group);
    const startHue = groupHue ?? hash(group) % families.length;
    const adjacent = [...(neighbors.get(iacuc) ?? [])].map((key) => chosen.get(key)).filter((swatch) => swatch != null);
    const [best] = swatches
      .map((swatch) => ({
        swatch,
        distance: adjacent.length ? Math.min(...adjacent.map((other) => separation(swatch, other))) : 0,
        used: Number(usedSwatches.has(swatch)),
        groupHue: Number(swatch.hue === groupHue),
        usedHue: Number(usedHues.has(swatch.hue)),
        offset: (swatch.hue - startHue + families.length) % families.length,
      }))
      .sort(
        (left, right) =>
          right.distance - left.distance ||
          left.used - right.used ||
          right.groupHue - left.groupHue ||
          left.usedHue - right.usedHue ||
          left.offset - right.offset,
      );
    const swatch = best.swatch;
    chosen.set(iacuc, swatch);
    firstHueByPrincipal.set(group, groupHue ?? swatch.hue);
    usedHues.add(swatch.hue);
    usedSwatches.add(swatch);
  }
  return new Map(
    ordered.map(([iacuc]) => {
      const { hue, shade } = chosen.get(iacuc)!;
      return [iacuc, token[`${families[hue]}${shade}`]];
    }),
  );
}
