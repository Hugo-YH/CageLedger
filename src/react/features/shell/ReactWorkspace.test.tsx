import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SessionUser } from "../../api/contracts";
import { DEFAULT_SYSTEM_FEATURE_FLAGS } from "../../../contracts/systemFeatures";
import { UiProvider, type WorkspaceView } from "../../state/ui";
import { useWorkspaceMemory } from "../../state/workspaceMemory";
import { ReactWorkspace } from "./ReactWorkspace";

const metrics = vi.hoisted(() => ({ renders: 0, mounts: 0 }));
vi.mock("../../api/administration", () => ({ useSystemInfo: () => ({ data: { build: 275 } }) }));
vi.mock("../../api/systemFeatures", () => ({
  useSystemFeatures: () => ({ data: { enabled: DEFAULT_SYSTEM_FEATURE_FLAGS } }),
}));
vi.mock("../../api/session", () => ({ useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("../../hooks/useIsMobileLayout", () => ({ useIsMobileLayout: () => false }));
vi.mock("./ReleaseAnnouncementGate", () => ({ ReleaseAnnouncementGate: () => null }));
vi.mock("../dashboard/DashboardView", () => ({
  DashboardView: function Dashboard({ navigate }: { navigate: (view: WorkspaceView) => void }) {
    metrics.renders += 1;
    const [draft, setDraft] = useState("");
    const [remembered, setRemembered] = useWorkspaceMemory("dashboard:test-context", "");
    useEffect(() => {
      metrics.mounts += 1;
    }, []);
    return (
      <section aria-label="测试业务页面">
        <input aria-label="当前草稿" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <input aria-label="页面记忆" value={remembered} onChange={(event) => setRemembered(event.target.value)} />
        <button onClick={() => navigate("technical-service-saved")}>打开技术服务</button>
      </section>
    );
  },
}));
vi.mock("../technical-services/TechnicalServiceView", () => ({
  TechnicalServiceView: ({ navigate, canExport }: { navigate: (view: WorkspaceView) => void; canExport: boolean }) => (
    <section aria-label="技术服务页面">
      <span>{canExport ? "允许导出" : "禁止导出"}</span>
      <button onClick={() => navigate("dashboard")}>返回业务首页</button>
    </section>
  ),
}));

const user: SessionUser = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  phone: "",
  role: "admin",
  roomIds: [],
  active: true,
  updatedAt: "v1",
};

beforeEach(() => {
  localStorage.clear();
  metrics.renders = 0;
  metrics.mounts = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function workspace(account = user) {
  return (
    <UiProvider>
      <ReactWorkspace user={account} />
    </UiProvider>
  );
}

it("keeps sidebar changes outside the active business tree and preserves its draft and focus", async () => {
  render(workspace());
  const input = await screen.findByRole("textbox", { name: "当前草稿" });
  fireEvent.change(input, { target: { value: "未保存的草稿" } });
  input.focus();
  const renders = metrics.renders;
  const mounts = metrics.mounts;
  fireEvent.click(screen.getByRole("button", { name: "隐藏导航栏" }));
  expect(screen.getByRole("button", { name: "展开导航栏" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "当前草稿" })).toBe(input);
  expect(input).toHaveValue("未保存的草稿");
  expect(input).toHaveFocus();
  expect(metrics.renders).toBe(renders);
  expect(metrics.mounts).toBe(mounts);
  fireEvent.click(screen.getByRole("button", { name: "展开导航栏" }));
  expect(metrics.renders).toBe(renders);
});

it("still navigates through the current callback and restores account-scoped list context", async () => {
  const view = render(workspace());
  fireEvent.change(await screen.findByRole("textbox", { name: "页面记忆" }), { target: { value: "已选筛选" } });
  fireEvent.click(screen.getByRole("button", { name: "打开技术服务" }));
  await screen.findByRole("region", { name: "技术服务页面" });
  expect(screen.getByText("允许导出")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("cageledger.ui.v2") || "{}").activeView).toBe("technical-service-saved");
  fireEvent.click(screen.getByRole("button", { name: "返回业务首页" }));
  expect(await screen.findByRole("textbox", { name: "页面记忆" })).toHaveValue("已选筛选");
  view.rerender(workspace({ ...user, id: "next-account" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "页面记忆" })).toHaveValue(""));
});

it("updates business permissions when the current account changes", async () => {
  const view = render(workspace());
  fireEvent.click(await screen.findByRole("button", { name: "打开技术服务" }));
  await screen.findByText("允许导出");
  view.rerender(workspace({ ...user, role: "room_admin", billingLockAllowed: false }));
  expect(await screen.findByText("禁止导出")).toBeInTheDocument();
});
