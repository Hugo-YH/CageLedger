import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { InspectionStandards } from "./InspectionStandards";

const api = vi.hoisted(() => ({ draftEnabled: vi.fn(), retry: vi.fn() }));
vi.mock("../../api/animalManagement", () => ({
  useAnimalInspectionCatalog: () => ({
    data: {
      version: { status: "active", version: "v1", imported_at: "2026-01-01", source: "test" },
      modules: [],
      nodes: [],
      reviewNotice: "",
    },
    isLoading: false,
    isError: false,
  }),
  useAnimalInspectionCatalogDraftStatus: () => ({ data: { hasDraft: true }, isError: false }),
  useAnimalInspectionCatalogDraft: (enabled: boolean) => {
    api.draftEnabled(enabled);
    return { isError: enabled, isLoading: false, data: undefined, refetch: api.retry };
  },
}));
vi.mock("../../hooks/useIsMobileLayout", () => ({ useIsMobileLayout: () => false }));
vi.mock("../../components/ui/MobilePage", () => ({
  MobilePage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/WorkspaceUi", () => ({
  PageSkeleton: () => <div>加载中</div>,
  PageState: ({ title, retry }: { title: string; retry: () => void }) => (
    <div>
      {title}
      <button onClick={retry}>重新加载</button>
    </div>
  ),
}));
vi.mock("../../components/ui", () => ({
  CommandBar: ({ primaryAction }: { primaryAction: ReactNode }) => <div>{primaryAction}</div>,
}));
vi.mock("./InspectionCatalogEditor", () => ({ InspectionCatalogEditor: () => <div>编辑器</div> }));
vi.mock("./InspectionVersionHistoryModal", () => ({ InspectionVersionHistoryModal: () => null }));
vi.mock("antd", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Alert: ({ title }: { title: ReactNode }) => <div>{title}</div>,
    Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Card: Container,
    Col: Container,
    Row: Container,
    Tag: Container,
    Descriptions: Object.assign(Container, { Item: Container }),
    Typography: { Text: Container, Title: Container, Paragraph: Container },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("loads only draft status until edit, then offers retry and return on draft failure", () => {
  render(
    <InspectionStandards
      user={{
        id: "admin",
        username: "admin",
        displayName: "管理员",
        phone: "",
        role: "admin",
        roomIds: [],
        active: true,
        updatedAt: "",
      }}
      navigate={vi.fn()}
    />,
  );
  expect(api.draftEnabled).toHaveBeenLastCalledWith(false);
  expect(screen.getByText("存在未发布的草稿")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑目录" }));
  expect(api.draftEnabled).toHaveBeenLastCalledWith(true);
  expect(screen.getByText("巡检编辑草稿加载失败")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(api.retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "返回标准目录" }));
  expect(api.draftEnabled).toHaveBeenLastCalledWith(false);
});
