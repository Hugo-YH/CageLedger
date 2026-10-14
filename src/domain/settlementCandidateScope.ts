import type { SettlementCandidate } from "../contracts/billing";

export function settlementCandidateScope(candidate: SettlementCandidate, fallback: "quantity_sheet" | "cage_map") {
  return { month: candidate.month, pi: candidate.pi, sourceType: candidate.sourceType || fallback };
}
