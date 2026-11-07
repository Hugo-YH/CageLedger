import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { DataQualityDetail as Detail } from "../../../../contracts/dataQuality";
import { DataQualityDetail } from "./DataQualityDetail";

const state = vi.hoisted(() => ({
  query: {
    data: undefined as Detail | undefined,
    isPending: false,
    isError: false,
    error: { message: "" },
    refetch: vi.fn(),
  },
}));
vi.mock("../../../api/dataQuality", () => ({ useDataQualityIssue: () => state.query }));
vi.mock("../../../components/WorkspaceUi", () => ({
  formatDateTime: (value: string) => value,
  ModalShell: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  PageSkeleton: () => <div>加载中</div>,
  PageState: ({ title, detail }: { title: string; detail?: string }) => (
    <div role="alert">
      {title} {detail}
    </div>
  ),
}));
vi.mock("../../../components/ui", () => ({
  ActionButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

function detail(evidence: unknown, id = "issue"): Detail {
  return {
    scan: {
      id: "scan",
      scannedAt: "2026-11-07",
      detectorVersion: "v1",
      latestBusinessAt: "",
      scope: "合成范围",
      trigger: "manual",
      actorName: "管理员",
      sourceSha256: "source-hash",
      sourceSnapshot: null,
      findingCount: 1,
      needsReview: 1,
      retainedHistory: 0,
      categories: [],
    },
    item: {
      id,
      code: "missing",
      codeLabel: "缺失关联",
      summary: "关联留档",
      reviewStatus: "needs_review",
      reviewStatusLabel: "待核对",
      entityType: "record",
      entityTypeLabel: "记录",
      entityId: "entity",
      referenceId: "",
    },
    evidence,
    evidenceSha256: "evidence-hash",
  };
}

beforeEach(() => {
  state.query = { data: undefined, isPending: false, isError: false, error: { message: "" }, refetch: vi.fn() };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const selection = { scanId: "scan", issueId: "issue" };

it("does not parse a closed snapshot and parses it once for both fields and complete text when opened", async () => {
  const record = { id: "snapshot-record", iacuc: "Z2026001", notes: "完整原文".repeat(2000) };
  const source = JSON.stringify(record);
  const pretty = JSON.stringify(record, null, 2);
  state.query.data = detail({ occupancyPayloadText: source });
  const parse = vi.spyOn(JSON, "parse");
  const view = render(<DataQualityDetail selection={selection} onClose={vi.fn()} />);
  const snapshotParses = () => parse.mock.calls.filter(([value]) => value === source).length;
  expect(snapshotParses()).toBe(0);
  expect(document.querySelector(".data-quality-evidence")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /占用记录快照/ }));
  await screen.findByText("snapshot-record");
  expect(document.querySelector(".data-quality-evidence")?.textContent).toBe(pretty);
  expect(snapshotParses()).toBe(1);
  state.query.data = { ...state.query.data, scan: { ...state.query.data.scan, actorName: "另一位管理员" } };
  view.rerender(<DataQualityDetail selection={selection} onClose={vi.fn()} />);
  expect(snapshotParses()).toBe(1);
  expect(screen.getByText("Z2026001")).toBeInTheDocument();
});

it("keeps malformed evidence as original text and switches issues without displaying or parsing the new closed snapshot", async () => {
  const malformed = '{ "id": "bad-json", incomplete';
  state.query.data = detail({ occupancyPayloadText: malformed });
  const parse = vi.spyOn(JSON, "parse");
  const view = render(<DataQualityDetail key="issue" selection={selection} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /占用记录快照/ }));
  await waitFor(() => expect(document.querySelector(".data-quality-evidence")?.textContent).toBe(malformed));
  expect(parse.mock.calls.filter(([value]) => value === malformed)).toHaveLength(1);
  const next = JSON.stringify({ id: "next-snapshot", month: "2026-11" });
  state.query.data = detail({ occupancyPayloadText: next }, "next");
  view.rerender(<DataQualityDetail key="next" selection={{ scanId: "scan", issueId: "next" }} onClose={vi.fn()} />);
  expect(document.querySelector(".data-quality-evidence")).toBeNull();
  expect(parse.mock.calls.filter(([value]) => value === next)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /占用记录快照/ }));
  await screen.findByText("next-snapshot");
  expect(document.querySelector(".data-quality-evidence")?.textContent).not.toContain("bad-json");
  expect(parse.mock.calls.filter(([value]) => value === next)).toHaveLength(1);
});

it("keeps a failed evidence check above cached content instead of rendering a verified snapshot", () => {
  const source = JSON.stringify({ id: "unverified-record" });
  state.query = {
    ...state.query,
    data: detail({ occupancyPayloadText: source }),
    isError: true,
    error: { message: "证据SHA-256校验失败" },
  };
  const parse = vi.spyOn(JSON, "parse");
  render(<DataQualityDetail selection={selection} onClose={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("证据SHA-256校验失败");
  expect(screen.queryByText("证据校验通过")).not.toBeInTheDocument();
  expect(document.querySelector(".data-quality-evidence")).toBeNull();
  expect(parse.mock.calls.filter(([value]) => value === source)).toHaveLength(0);
});
