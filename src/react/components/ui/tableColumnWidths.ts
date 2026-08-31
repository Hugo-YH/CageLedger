export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 640;
const WIDTH_STORAGE_KEY = "cageledger:table-column-widths:v1";

type Widths = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readAllWidths(): Record<string, Widths> {
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (!isRecord(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      if (!isRecord(value)) return [];
      const entries = Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]) &&
          entry[1] >= MIN_COLUMN_WIDTH &&
          entry[1] <= MAX_COLUMN_WIDTH,
      );
      return [[key, Object.fromEntries(entries)]];
    }),
  );
}

export function loadStoredWidths(key?: string): Widths {
  if (!key) return {};
  try {
    const all = readAllWidths();
    return Object.hasOwn(all, key) ? all[key] : {};
  } catch {
    return {};
  }
}

export function persistColumnWidths(key: string, widths: Widths) {
  try {
    let all: Record<string, Widths> = {};
    try {
      all = readAllWidths();
    } catch {
      // A broken preference should be repairable by the next successful resize.
    }
    window.localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify({ ...all, [key]: widths }));
  } catch {
    // Width persistence is optional; in-session resizing must keep working.
  }
}

export function pixelWidth(value: number | string | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:px)?$/.test(value.trim())) return undefined;
  const width = Number.parseFloat(value);
  return Number.isFinite(width) && width > 0 ? width : undefined;
}
