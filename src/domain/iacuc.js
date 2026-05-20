export function normalizeIacucNumber(value = "") {
  return String(value).trim().replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").trim();
}

