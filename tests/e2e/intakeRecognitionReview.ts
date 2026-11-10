import type { Page } from "@playwright/test";
import type { IntakeReviewPreview } from "../../src/contracts/intake";
import { expect } from "./fixtures";

/** Finish the existing read-only review before a test continues editing its draft. */
export async function recognizeKeepingDraft(page: Page, action: "本地识别" | "AI识别") {
  const checked = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/intake-batches/recognition-preview") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: action, exact: true }).click();
  const response = await checked;
  expect(response.ok()).toBe(true);
  const preview = (await response.json()) as IntakeReviewPreview;
  expect(preview.reviewVersion).toBe(2);
  const review = page.getByRole("dialog", { name: "核对已有预约", exact: true });
  if (preview.total > 0 || preview.outcome !== "unmatched" || preview.sourceIssues.length > 0) {
    await expect(review).toBeVisible();
    await review.getByRole("button", { name: "返回本次录入", exact: true }).click();
  }
  await expect(review).toBeHidden();
  return preview;
}
