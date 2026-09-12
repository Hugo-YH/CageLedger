export function normalizeCode(value: string) {
  const raw = value.trim();
  const pathCode = raw.match(/\/(?:c|scan\/cage-card)\/([^/?#]+)/i)?.[1];
  try {
    return decodeURIComponent(pathCode || raw).toUpperCase();
  } catch {
    return (pathCode || raw).toUpperCase();
  }
}
