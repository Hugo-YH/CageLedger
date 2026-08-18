import { describe, expect, it } from "vitest";

import { defaultReimbursementFormNo } from "./reimbursementFormNo";

describe("defaultReimbursementFormNo", () => {
  it("按当前年月生成 BXD1001YYYYMM000", () => {
    expect(defaultReimbursementFormNo(new Date("2026-08-18T10:00:00+08:00"))).toBe("BXD1001202608000");
    expect(defaultReimbursementFormNo(new Date("2026-01-05T10:00:00+08:00"))).toBe("BXD1001202601000");
    expect(defaultReimbursementFormNo(new Date("2026-12-31T10:00:00+08:00"))).toBe("BXD1001202612000");
  });
});
