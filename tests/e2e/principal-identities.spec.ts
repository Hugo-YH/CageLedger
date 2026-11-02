import type { AuditEvent, IacucIndexItem, PrincipalIdentity } from "../../src/contracts/administration";
import { expect, openSettingsView, test } from "./fixtures";

test("principal identities split source names without changing saved personal allowances or source records", async ({
  page,
}, testInfo) => {
  const healthResponse = await page.request.get("/api/health");
  expect(healthResponse.ok()).toBe(true);
  const health = (await healthResponse.json()) as { database: string };
  expect(health.database).toContain("cageledger-e2e-");

  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok(), await login.text()).toBe(true);
  const prefix = `身份回归${Date.now()}`;
  const people = [`${prefix}丁小虎`, `${prefix}林浩添`, `${prefix}蔡雯嘉`];
  const identityUrl = (pi: string) => `/api/principal-identities/${encodeURIComponent(pi)}`;
  const personalSave = await page.request.put(identityUrl(people[0]), { data: { principalType: "pi" } });
  expect(personalSave.ok(), await personalSave.text()).toBe(true);
  const { item: savedIdentity } = (await personalSave.json()) as { item: PrincipalIdentity };
  expect(savedIdentity).toMatchObject({ pi: people[0], principalType: "pi", freeCageAllowance: 20 });

  const sources = [
    { iacuc: "Z2099801", pi: `${people[0]}、${people[1]}` },
    { iacuc: "Z2099802", pi: `${people[0]}、${people[2]}、${people[1]}` },
    { iacuc: "Z2099803", pi: `${people[0]} / ${people[1]}；${people[0]}` },
  ];
  const csv = [
    "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源",
    ...sources.map((source) => `${source.iacuc},${prefix}项目,${source.pi},${prefix}实验负责人,${prefix}经费`),
  ].join("\n");
  const upload = await page.request.post("/api/iacuc-index/upload", {
    multipart: { file: { name: "principal-identities.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
  });
  expect(upload.ok(), await upload.text()).toBe(true);

  const readIdentities = async () => {
    const response = await page.request.get("/api/principal-identities");
    expect(response.ok(), await response.text()).toBe(true);
    const { items } = (await response.json()) as { items: PrincipalIdentity[] };
    return items.filter((item) => item.pi.startsWith(prefix));
  };
  const readSources = async () => {
    const response = await page.request.get("/api/iacuc-index?q=Z20998&limit=20");
    expect(response.ok(), await response.text()).toBe(true);
    const { items } = (await response.json()) as { items: IacucIndexItem[] };
    return items;
  };
  const identitiesBefore = await readIdentities();
  expect(identitiesBefore.map((item) => item.pi).sort()).toEqual([...people].sort());
  expect(identitiesBefore.find((item) => item.pi === people[0])).toEqual(savedIdentity);
  for (const person of people.slice(1))
    expect(identitiesBefore.find((item) => item.pi === person)).toMatchObject({
      principalType: "independent",
      freeCageAllowance: 10,
    });
  const sourcesBefore = await readSources();
  expect(sourcesBefore.map(({ iacuc, pi }) => ({ iacuc, pi }))).toEqual(sources);

  await page.goto("/app");
  await openSettingsView(page, "数据管理");
  await page.getByRole("searchbox", { name: "检索项目负责人", exact: true }).fill(prefix);
  const rows = page.getByRole("row").filter({ hasText: prefix });
  await expect(rows).toHaveCount(3);
  for (const person of people) await expect(rows.getByRole("cell", { name: person, exact: true })).toHaveCount(1);
  const personalRow = rows.filter({ has: page.getByRole("cell", { name: people[0], exact: true }) });
  await expect(personalRow.getByText("PI", { exact: true })).toBeVisible();
  await expect(personalRow.getByRole("cell", { name: "20", exact: true })).toBeVisible();
  for (const source of sources) await expect(rows.getByRole("cell", { name: source.pi, exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("individual-principal-identities.png"), animations: "disabled" });

  const readAudits = async () => {
    const response = await page.request.get("/api/audit-events?limit=100&offset=0");
    expect(response.ok(), await response.text()).toBe(true);
    return ((await response.json()) as { items: AuditEvent[] }).items;
  };
  const auditsBefore = await readAudits();
  for (const source of sources.slice(0, 2)) {
    const rejected = await page.request.put(identityUrl(source.pi), { data: { principalType: "pi" } });
    expect(rejected.status(), await rejected.text()).toBe(400);
  }
  // Encoded slashes are rejected by the single-segment router before identity validation.
  const slashRejected = await page.request.put(identityUrl(sources[2].pi), { data: { principalType: "pi" } });
  expect(slashRejected.status(), await slashRejected.text()).toBe(404);
  expect((await readAudits()).map((event) => event.id)).toEqual(auditsBefore.map((event) => event.id));
  expect(await readIdentities()).toEqual(identitiesBefore);
  expect(await readSources()).toEqual(sourcesBefore);
});
