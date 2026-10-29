import type { IntakeBatch } from "../contracts/intake";

/** Re-recognizing the same project must retain the operator's people fields. */
export function intakePeople(
  current: Pick<IntakeBatch, "iacuc" | "pi" | "owner">,
  parsed: Pick<IntakeBatch, "iacuc" | "pi" | "owner">,
  matched?: { pi?: string; owner?: string },
) {
  const code = parsed.iacuc.trim().toUpperCase();
  const sameProject = Boolean(code) && current.iacuc.trim().toUpperCase() === code;
  return {
    pi: (sameProject && current.pi) || matched?.pi || parsed.pi,
    owner: (sameProject && current.owner) || matched?.owner || parsed.owner,
  };
}
