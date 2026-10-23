import type { InspectionAnswer, InspectionCatalogNode } from "../../api/contracts";
import { inspectionAnswerKey } from "./model";

export type InspectionAnswerMap = Record<string, InspectionAnswer>;

function defaultAnswer(node: InspectionCatalogNode): InspectionAnswer {
  return { nodeCode: node.code, moduleCode: node.moduleCode, outcome: "normal" };
}

export function applyInspectionAnswerPatch(
  answers: InspectionAnswerMap,
  node: InspectionCatalogNode,
  patch: Partial<InspectionAnswer>,
): InspectionAnswerMap {
  const key = inspectionAnswerKey(node.moduleCode, node.code);
  const current = answers[key];
  if (current && Object.entries(patch).every(([field, value]) => current[field as keyof InspectionAnswer] === value)) {
    return answers;
  }
  return { ...answers, [key]: { ...(current || defaultAnswer(node)), ...patch } };
}

/** Applies one outcome to a section without scheduling a state update for every item. */
export function applyInspectionOutcomeToNodes(
  answers: InspectionAnswerMap,
  nodes: InspectionCatalogNode[],
  outcome: NonNullable<InspectionAnswer["outcome"]>,
): InspectionAnswerMap {
  const updates: InspectionAnswerMap = {};
  let changed = false;
  for (const node of nodes) {
    const key = inspectionAnswerKey(node.moduleCode, node.code);
    const current = answers[key];
    if (current?.outcome === outcome) continue;
    updates[key] = { ...(current || defaultAnswer(node)), outcome };
    changed = true;
  }
  return changed ? { ...answers, ...updates } : answers;
}
