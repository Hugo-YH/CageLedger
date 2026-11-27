import type { CageRack, RackPlacement } from "../contracts/infrastructure";

const maxGridSize = 256;
export const rackLayoutGridDivisions = 4;

type RackSize = Pick<CageRack, "cols" | "rows">;
type RackSizes = ReadonlyMap<string, RackSize>;

export function rackFootprint(rotation: RackPlacement["rotation"], rack?: RackSize) {
  let columns = 4;
  let rows = 2;
  if (rack && Number.isFinite(rack.cols) && Number.isFinite(rack.rows) && rack.cols >= 1 && rack.rows >= 1) {
    // Fit the rack into the legacy footprint so saved positions remain valid.
    const scale = Math.min(16 / rack.cols, 8 / rack.rows);
    const width = Math.max(5, Math.floor(rack.cols * scale + 0.5));
    const height = Math.max(4, Math.floor(rack.rows * scale + 0.5));
    // Allow one alignment step for the side padding and two for the header.
    const cell = Math.min((width - 1) / rack.cols, (height - 2) / rack.rows);
    columns = Math.max(5, Math.min(width, Math.ceil(1 + cell * rack.cols))) / rackLayoutGridDivisions;
    rows = Math.max(4, Math.min(height, Math.ceil(2 + cell * rack.rows))) / rackLayoutGridDivisions;
  }
  return rotation === 90 ? { columns: rows, rows: columns } : { columns, rows };
}

export function rackPlacementFits(placement: RackPlacement, layout: readonly RackPlacement[], racks: RackSizes) {
  const size = rackFootprint(placement.rotation, racks.get(placement.rackId));
  const right = placement.column + size.columns;
  const bottom = placement.row + size.rows;
  if (
    !Number.isInteger(placement.column * rackLayoutGridDivisions) ||
    !Number.isInteger(placement.row * rackLayoutGridDivisions) ||
    placement.column < 0 ||
    placement.row < 0 ||
    right > maxGridSize ||
    bottom > maxGridSize
  )
    return false;
  return layout.every((other) => {
    if (placement.rackId === other.rackId) return true;
    const otherSize = rackFootprint(other.rotation, racks.get(other.rackId));
    return (
      right <= other.column ||
      placement.column >= other.column + otherSize.columns ||
      bottom <= other.row ||
      placement.row >= other.row + otherSize.rows
    );
  });
}

/** Keep saved positions that fit the current rack sizes, then fill open space. */
export function arrangeRoomRacks(racks: readonly CageRack[], existing: readonly RackPlacement[]) {
  if (!racks.length) return [];
  const byRack = new Map(existing.map((placement) => [placement.rackId, placement]));
  const sizes = new Map(racks.map((rack) => [rack.id, rack]));
  const layout: RackPlacement[] = [];
  const placed = new Set<string>();
  let columnStep = 0;
  let rowStep = 0;
  for (const rack of racks) {
    const saved = byRack.get(rack.id);
    if (saved && rackPlacementFits(saved, layout, sizes)) {
      layout.push(saved);
      placed.add(rack.id);
    }
    const size = rackFootprint(saved?.rotation ?? 0, rack);
    columnStep = Math.max(columnStep, size.columns + 2);
    rowStep = Math.max(rowStep, size.rows + 1);
  }
  const racksPerRow = Math.max(2, Math.min(Math.floor(maxGridSize / columnStep), Math.ceil(Math.sqrt(racks.length))));
  let candidateIndex = 0;
  for (const rack of racks) {
    if (placed.has(rack.id)) continue;
    const rotation = byRack.get(rack.id)?.rotation ?? 0;
    for (;;) {
      const candidate: RackPlacement = {
        rackId: rack.id,
        column: 1 + (candidateIndex % racksPerRow) * columnStep,
        row: 1 + Math.floor(candidateIndex / racksPerRow) * rowStep,
        rotation,
      };
      candidateIndex += 1;
      if (candidate.row >= maxGridSize - 1) break;
      if (!rackPlacementFits(candidate, layout, sizes)) continue;
      layout.push(candidate);
      break;
    }
  }
  return layout;
}

export function rackLayoutSize(layout: readonly RackPlacement[], racks: RackSizes) {
  let columns = 12;
  let rows = 5;
  for (const placement of layout) {
    const { column, row } = placement;
    const footprint = rackFootprint(placement.rotation, racks.get(placement.rackId));
    columns = Math.max(columns, column + footprint.columns + 1);
    rows = Math.max(rows, row + footprint.rows + 1);
  }
  return { columns: Math.min(maxGridSize, columns), rows: Math.min(maxGridSize, rows) };
}

export function rackOverviewBounds(layout: readonly RackPlacement[], racks: RackSizes) {
  if (!layout.length) return { column: 0, row: 0, ...rackLayoutSize(layout, racks) };
  let left = Infinity;
  let top = Infinity;
  let right = 0;
  let bottom = 0;
  for (const placement of layout) {
    const size = rackFootprint(placement.rotation, racks.get(placement.rackId));
    left = Math.min(left, placement.column);
    top = Math.min(top, placement.row);
    right = Math.max(right, placement.column + size.columns);
    bottom = Math.max(bottom, placement.row + size.rows);
  }
  return { column: left - 1, row: top - 1, columns: right - left + 2, rows: bottom - top + 2 };
}
