import type { CageRack, RackPlacement } from "../contracts/infrastructure";

const maxGridSize = 256;

export function rackFootprint(rotation: RackPlacement["rotation"]) {
  return rotation === 90 ? { columns: 2, rows: 4 } : { columns: 4, rows: 2 };
}

export function rackPlacementFits(placement: RackPlacement, layout: readonly RackPlacement[]) {
  const size = rackFootprint(placement.rotation);
  const right = placement.column + size.columns;
  const bottom = placement.row + size.rows;
  if (placement.column < 0 || placement.row < 0 || right > maxGridSize || bottom > maxGridSize) return false;
  return layout.every((other) => {
    if (placement.rackId === other.rackId) return true;
    const otherSize = rackFootprint(other.rotation);
    return (
      right <= other.column ||
      placement.column >= other.column + otherSize.columns ||
      bottom <= other.row ||
      placement.row >= other.row + otherSize.rows
    );
  });
}

/** Put new racks into open positions without changing saved coordinates. */
export function arrangeRoomRacks(racks: readonly CageRack[], existing: readonly RackPlacement[]) {
  const byRack = new Map(existing.map((placement) => [placement.rackId, placement]));
  const layout = racks.flatMap((rack) => byRack.get(rack.id) ?? []);
  const racksPerRow = Math.max(2, Math.min(42, Math.ceil(Math.sqrt(racks.length))));
  let candidateIndex = 0;
  for (const rack of racks) {
    if (byRack.has(rack.id)) continue;
    for (;;) {
      const candidate: RackPlacement = {
        rackId: rack.id,
        column: 1 + (candidateIndex % racksPerRow) * 6,
        row: 1 + Math.floor(candidateIndex / racksPerRow) * 3,
        rotation: 0,
      };
      candidateIndex += 1;
      if (candidate.row >= maxGridSize - 1) break;
      if (!rackPlacementFits(candidate, layout)) continue;
      layout.push(candidate);
      break;
    }
  }
  return layout;
}

export function rackLayoutSize(layout: readonly RackPlacement[]) {
  let columns = 12;
  let rows = 5;
  for (const { column, row, rotation } of layout) {
    const footprint = rackFootprint(rotation);
    columns = Math.max(columns, column + footprint.columns + 1);
    rows = Math.max(rows, row + footprint.rows + 1);
  }
  return { columns: Math.min(maxGridSize, columns), rows: Math.min(maxGridSize, rows) };
}

export function rackOverviewBounds(layout: readonly RackPlacement[]) {
  if (!layout.length) return { column: 0, row: 0, ...rackLayoutSize(layout) };
  let left = Infinity;
  let top = Infinity;
  let right = 0;
  let bottom = 0;
  for (const placement of layout) {
    const size = rackFootprint(placement.rotation);
    left = Math.min(left, placement.column);
    top = Math.min(top, placement.row);
    right = Math.max(right, placement.column + size.columns);
    bottom = Math.max(bottom, placement.row + size.rows);
  }
  return { column: left - 1, row: top - 1, columns: right - left + 2, rows: bottom - top + 2 };
}
