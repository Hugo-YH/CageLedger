import type { IntakeRecognitionEvidence } from "../../../contracts/intake";
import { buildLegacyRecognitionReview } from "./legacyRecognitionReview";

/** Current recognitions carry explicit rule outcomes; older evidence retains its renderer. */
export function buildRecognitionReview(evidence: IntakeRecognitionEvidence) {
  if (evidence.review?.version === 1) {
    return {
      comparisons: evidence.review.comparisons.map((row) => ({ ...row })),
      reminders: [...evidence.review.reminders],
    };
  }
  return buildLegacyRecognitionReview(evidence);
}
