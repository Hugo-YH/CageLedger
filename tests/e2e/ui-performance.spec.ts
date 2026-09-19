import { readFile, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, openNavigationEntry, test } from "./fixtures";

type Phase = "firstListEntry" | "searchResponse" | "saveFeedback";
type Sample = Record<Phase, { milliseconds: number; apiRequests: number }>;

const repetitions = 3;
const targetName = "性能基线目标批次";

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(samples: Sample[]) {
  return Object.fromEntries(
    (["firstListEntry", "searchResponse", "saveFeedback"] as const).map((phase) => [
      phase,
      {
        medianMilliseconds: median(samples.map((sample) => sample[phase].milliseconds)),
        medianApiRequests: median(samples.map((sample) => sample[phase].apiRequests)),
        samples: samples.map((sample) => sample[phase]),
      },
    ]),
  ) as Record<Phase, { medianMilliseconds: number; medianApiRequests: number; samples: Sample[Phase][] }>;
}

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
}

async function measure<T>(page: Page, action: () => Promise<T>) {
  let apiRequests = 0;
  const onRequest = (request: { url: () => string }) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests += 1;
  };
  page.on("request", onRequest);
  const started = performance.now();
  try {
    await action();
    return { milliseconds: Math.round(performance.now() - started), apiRequests };
  } finally {
    page.off("request", onRequest);
  }
}

test("records repeatable list, search and save UI performance evidence", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  for (let index = 0; index < 24; index += 1) {
    const response = await page.request.post("/api/quarantine/batches", {
      data: {
        item: {
          id: `ui-perf-batch-${index}`,
          name: index === 12 ? targetName : `性能基线批次 ${String(index).padStart(2, "0")}`,
          sources: [{ id: `ui-perf-source-${index}`, supplier: "性能测试供应商", species: "mouse" }],
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  const samples: Sample[] = [];
  for (let run = 0; run < repetitions; run += 1) {
    await login(page);
    const firstListEntry = await measure(page, async () => {
      await openNavigationEntry(page, "检疫管理", "检疫批次");
      await page.getByRole("tab", { name: "检疫批次列表", exact: true }).click();
      await expect(page.getByRole("row").filter({ hasText: targetName })).toBeVisible();
    });
    expect(firstListEntry.apiRequests).toBeGreaterThan(0);

    const search = page.getByRole("searchbox", { name: "搜索检疫批次", exact: true });
    const searchResponse = await measure(page, async () => {
      await search.fill(targetName);
      await search.press("Enter");
      await expect(page.getByRole("row").filter({ hasText: targetName })).toBeVisible();
    });
    expect(searchResponse.apiRequests).toBeGreaterThan(0);

    const row = page.getByRole("row").filter({ hasText: targetName });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑检疫批次", exact: true });
    const note = `性能保存反馈 ${run + 1}`;
    await dialog.getByRole("textbox", { name: "检疫批次备注", exact: true }).fill(note);
    const saveFeedback = await measure(page, async () => {
      await dialog.getByRole("button", { name: "保存检疫批次", exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole("tab", { name: "批次备注", exact: true }).click();
      await expect(page.getByText(note, { exact: true })).toBeVisible();
    });
    expect(saveFeedback.apiRequests).toBeGreaterThan(0);
    samples.push({ firstListEntry, searchResponse, saveFeedback });
  }

  const result = { repetitions, samples, summary: summarize(samples) };
  const evidencePath = testInfo.outputPath("ui-performance.json");
  await writeFile(evidencePath, JSON.stringify(result, null, 2));
  await testInfo.attach("ui-performance", { path: evidencePath, contentType: "application/json" });

  const baselinePath = process.env.CAGELEDGER_PERF_BASELINE_PATH;
  if (!baselinePath) return;
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as typeof result;
  for (const phase of ["firstListEntry", "searchResponse", "saveFeedback"] as const) {
    const current = result.summary[phase];
    const reference = baseline.summary[phase];
    expect(current.medianApiRequests).toBeLessThanOrEqual(reference.medianApiRequests + 3);
    expect(current.medianMilliseconds).toBeLessThanOrEqual(
      Math.max(reference.medianMilliseconds * 2.5, reference.medianMilliseconds + 1500),
    );
  }
});
