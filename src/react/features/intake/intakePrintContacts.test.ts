import { beforeEach, expect, it, vi } from "vitest";
import { createIntakeDraft } from "../../../domain/intake";
import { resolveResearcherContacts } from "../../api/researchers";
import { prepareIntakePrintContacts } from "./intakePrintContacts";

vi.mock("../../api/researchers", () => ({ resolveResearcherContacts: vi.fn() }));
beforeEach(() => {
  vi.mocked(resolveResearcherContacts).mockReset();
});
const batch = (id: string, owner: string) => ({ ...createIntakeDraft("接收人员"), id, owner, vetPhone: "13999999999" });

it("deduplicates the query but keeps each batch's owner order and never changes the batch", async () => {
  vi.mocked(resolveResearcherContacts).mockResolvedValue({
    items: [
      { name: "甲", status: "matched", phone: "13800000001" },
      { name: "乙", status: "matched", phone: "020-12345678" },
    ],
  });
  const items = [batch("a", "甲/乙"), batch("b", "乙、甲")];
  const before = structuredClone(items);
  expect(await prepareIntakePrintContacts(items)).toEqual({
    contactPhones: { a: "13800000001 / 020-12345678", b: "020-12345678 / 13800000001" },
    warning: "",
  });
  expect(resolveResearcherContacts).toHaveBeenCalledExactlyOnceWith(["甲", "乙"]);
  expect(items).toEqual(before);
});

it("leaves the whole phone row blank for unresolved names rather than mispairing a known phone", async () => {
  vi.mocked(resolveResearcherContacts).mockResolvedValue({
    items: [
      { name: "甲", status: "ambiguous", phone: "" },
      { name: "乙", status: "matched", phone: "13800000002" },
      { name: "丙", status: "missing_phone", phone: "" },
    ],
  });
  const result = await prepareIntakePrintContacts([batch("a", "甲/乙"), batch("b", "丙"), batch("c", "未找到")]);
  expect(result.contactPhones).toEqual({ a: "", b: "", c: "" });
  expect(result.warning).toContain("甲、丙、未找到");
  expect(JSON.stringify(result)).not.toContain("13999999999");
  expect(JSON.stringify(result)).not.toContain("13800000002");
});

it("does not split an English name on spaces and skips an empty directory request", async () => {
  vi.mocked(resolveResearcherContacts).mockResolvedValue({
    items: [{ name: "John Smith", status: "matched", phone: "+1 123456789" }],
  });
  const result = await prepareIntakePrintContacts([batch("a", "John Smith"), batch("b", "")]);
  expect(resolveResearcherContacts).toHaveBeenCalledExactlyOnceWith(["John Smith"]);
  expect(result.contactPhones).toEqual({ a: "+1 123456789", b: "" });
  vi.mocked(resolveResearcherContacts).mockClear();
  expect((await prepareIntakePrintContacts([batch("empty", "")])).warning).not.toBe("");
  expect(resolveResearcherContacts).not.toHaveBeenCalled();
});

it("chunks large cross-page selections within the endpoint's bound", async () => {
  vi.mocked(resolveResearcherContacts).mockImplementation((names) =>
    Promise.resolve({ items: names.map((name) => ({ name, status: "matched", phone: "13800000001" })) }),
  );
  const result = await prepareIntakePrintContacts(
    Array.from({ length: 201 }, (_, index) => batch(`${index}`, `人员${index}`)),
  );
  expect(resolveResearcherContacts).toHaveBeenCalledTimes(2);
  expect(vi.mocked(resolveResearcherContacts).mock.calls.map(([names]) => names.length)).toEqual([200, 1]);
  expect(Object.keys(result.contactPhones)).toHaveLength(201);
  expect(result.warning).toBe("");
});

it("forwards the owned print signal and stops queued contact reads after cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(resolveResearcherContacts).mockImplementation((_names, signal) => {
    expect(signal).toBe(controller.signal);
    controller.abort();
    return Promise.resolve({ items: [] });
  });
  await expect(
    prepareIntakePrintContacts(
      Array.from({ length: 201 }, (_, index) => batch(String(index), `人员${index}`)),
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(resolveResearcherContacts).toHaveBeenCalledOnce();
});
