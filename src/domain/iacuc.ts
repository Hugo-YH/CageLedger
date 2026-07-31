import type { IacucIndexItem } from "../contracts/administration";

const IACUC_OPTION_LIMIT = 80;

/**
 * Match IACUC index entries for the entry-page datalist.
 *
 * Returns an empty list until the user types, then prioritizes prefix matches
 * over substring matches and caps the rendered options so the datalist stays
 * responsive with large indexes.
 */
export function matchIacucOptions(
  items: readonly IacucIndexItem[],
  query: string,
  limit = IACUC_OPTION_LIMIT,
): IacucIndexItem[] {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return [];
  const prefixMatches: IacucIndexItem[] = [];
  const substringMatches: IacucIndexItem[] = [];
  for (const item of items) {
    const iacuc = item.iacuc.trim().toUpperCase();
    if (!iacuc.includes(normalized)) continue;
    if (iacuc.startsWith(normalized)) {
      prefixMatches.push(item);
    } else {
      substringMatches.push(item);
    }
  }
  return [...prefixMatches, ...substringMatches].slice(0, limit);
}
