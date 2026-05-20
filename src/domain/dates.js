export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function monthOf(dateText) {
  return String(dateText || "").slice(0, 7);
}

