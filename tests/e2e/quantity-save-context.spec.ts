import { ensureTestInfrastructure, expect, test } from "./fixtures";

test("quantity saves preserve cross-room permission, transfer mirrors and stale-write rejection", async ({ page }) => {
  const login = async (username: string, password: string) => {
    await page.request.post("/api/auth/logout");
    const response = await page.request.post("/api/auth/login", { data: { username, password } });
    expect(response.ok()).toBeTruthy();
  };
  await login("admin", "admin123");
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  const rooms = await (await page.request.get("/api/quantity-sheet-rooms")).json();
  const room = (rooms.items as Array<{ id: string; name: string }>).find((item) => item.id === "room-e2e-8014")!;
  const suffix = Date.now().toString();
  const username = `quantity-context-${suffix}`;
  const password = "quantity-context-test";
  const account = await page.request.post("/api/users", {
    data: { username, displayName: "数量表跨房间核对", password, role: "room_admin", roomIds: [] },
  });
  expect(account.ok()).toBeTruthy();
  const user = (await account.json()).user as { id: string };
  const savedIds: string[] = [];
  try {
    for (const actor of ["admin", username]) {
      await login(actor, actor === "admin" ? "admin123" : password);
      const id = `quantity-context-${actor}-${suffix}`;
      const targetCode = `TARGET-${actor}-${suffix}`;
      const sheet = {
        id,
        month: "2026-10",
        iacuc: `SOURCE-${actor}-${suffix}`,
        pi: `核对PI-${actor}-${suffix}`,
        roomId: room.id,
        roomName: room.name,
        billingUnit: "cage_day",
        rows: [2, 3].map((removedCount, index) => ({
          id: `row-${index}`,
          date: `2026-10-0${index + 1}`,
          removedCount,
          removedType: "转出",
          transferOutToIacuc: targetCode,
          cageCount: 10,
        })),
      };
      const created = await page.request.post("/api/quantity-sheets", { data: { sheet } });
      expect(created.status()).toBe(201);
      const initial = await created.json();
      savedIds.push(id, ...initial.affectedItems.map((item: { id: string }) => item.id));
      expect(initial.item.roomId).toBe(room.id);
      expect(initial.affectedItems).toHaveLength(1);
      expect(
        initial.affectedItems[0].rows.reduce((sum: number, row: { addedCount: number }) => sum + row.addedCount, 0),
      ).toBe(5);

      const revised = {
        ...initial.item,
        rows: initial.item.rows.map((row: object, index: number) => (index === 0 ? { ...row, removedCount: 4 } : row)),
      };
      const updated = await page.request.put(`/api/quantity-sheets/${id}`, {
        data: { sheet: revised, expectedUpdatedAt: initial.item.updatedAt },
      });
      expect(updated.status()).toBe(200);
      const current = await updated.json();
      expect(
        current.affectedItems[0].rows.reduce((sum: number, row: { addedCount: number }) => sum + row.addedCount, 0),
      ).toBe(7);
      const stale = await page.request.put(`/api/quantity-sheets/${id}`, {
        data: { sheet, expectedUpdatedAt: initial.item.updatedAt },
      });
      expect(stale.status()).toBe(409);
      const detail = await (await page.request.get(`/api/quantity-sheets/${id}`)).json();
      expect(detail.item).toEqual(current.item);
      const ids = await (
        await page.request.get(
          `/api/quantity-sheets?view=ids&limit=100&offset=0&columnFilters=${encodeURIComponent(JSON.stringify({ pi: [sheet.pi] }))}`,
        )
      ).json();
      expect(ids.items).toEqual([{ id }]);
    }
  } finally {
    await login("admin", "admin123");
    for (const id of savedIds) await page.request.delete(`/api/quantity-sheets/${id}`);
    await page.request.delete(`/api/users/${user.id}`);
  }
});
