import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SystemFeatureFlags, SystemFeatures } from "../../../contracts/systemFeatures";
import { AntdProvider } from "../../components/ui";
import { UiProvider } from "../../state/ui";
import { SystemFeaturesView } from "./SystemFeaturesView";

const api = vi.hoisted(() => ({
  query: {} as {
    data?: SystemFeatures;
    isError: boolean;
    isFetching: boolean;
    isPending: boolean;
    refetch: ReturnType<typeof vi.fn>;
  },
  save: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../../api/systemFeatures", () => ({
  useSystemFeatures: () => api.query,
  useSaveSystemFeatures: () => api.save,
}));
vi.mock("../../hooks/useUnsavedChanges", () => ({ useUnsavedChanges: vi.fn() }));

const enabled: SystemFeatureFlags = {
  intake: true,
  reception: true,
  quarantine: true,
  cages: true,
  animal: true,
  billing: true,
  "technical-services": true,
  settlement: true,
};

function item(overrides: Partial<SystemFeatureFlags> = {}, updatedAt = "2026-10-15T00:00:00Z"): SystemFeatures {
  return { enabled: { ...enabled, ...overrides }, updatedAt };
}

function view() {
  return (
    <UiProvider>
      <AntdProvider>
        <SystemFeaturesView />
      </AntdProvider>
    </UiProvider>
  );
}

beforeEach(() => {
  api.query = {
    data: item(),
    isError: false,
    isFetching: false,
    isPending: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  };
  api.save.isPending = false;
  api.save.mutateAsync.mockReset();
  vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, matches: false, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("retains an unsaved draft through a background server update and discards to the latest server version", () => {
  const rendered = render(view());
  const intake = screen.getByRole("switch", { name: "笼卡管理" });
  const quarantine = screen.getByRole("switch", { name: "检疫管理" });
  fireEvent.click(quarantine);
  expect(quarantine).toHaveAttribute("aria-checked", "false");

  api.query = { ...api.query, data: item({ intake: false }, "2026-10-15T01:00:00Z") };
  rendered.rerender(view());
  expect(intake).toHaveAttribute("aria-checked", "true");
  expect(quarantine).toHaveAttribute("aria-checked", "false");

  fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(screen.getByRole("switch", { name: "笼卡管理" })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("switch", { name: "检疫管理" })).toHaveAttribute("aria-checked", "true");
});

it("retains the draft after a 409 save failure and does not retry the write", async () => {
  api.save.mutateAsync.mockRejectedValue(new Error("系统功能已被其他管理员更新，请刷新后重新设置"));
  render(view());
  const quarantine = screen.getByRole("switch", { name: "检疫管理" });
  fireEvent.click(quarantine);
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

  await waitFor(() => expect(api.save.mutateAsync).toHaveBeenCalledTimes(1));
  expect(api.save.mutateAsync).toHaveBeenCalledWith({
    enabled: { ...enabled, quarantine: false },
    expectedUpdatedAt: "2026-10-15T00:00:00Z",
  });
  expect(quarantine).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("button", { name: "保存设置" })).toBeEnabled();
});

it("adopts the returned version after saving and leaves a clean draft unsaveable", async () => {
  const saved = item({ quarantine: false }, "2026-10-15T02:00:00Z");
  api.save.mutateAsync.mockResolvedValue({ item: saved });
  render(view());
  fireEvent.click(screen.getByRole("switch", { name: "检疫管理" }));
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

  await waitFor(() => expect(api.save.mutateAsync).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled());
  expect(screen.getByRole("switch", { name: "检疫管理" })).toHaveAttribute("aria-checked", "false");
});
