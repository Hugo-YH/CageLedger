import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import type * as AntdModule from "antd";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { DashboardOverviewResponse } from "../../api/dashboardOverview";
import { DashboardView } from "./DashboardView";

const state = vi.hoisted(() => ({
  query: {
    data: undefined as DashboardOverviewResponse | undefined,
    isPending: false,
    isSuccess: true,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  renders: [] as Array<{ kind: "area" | "rose"; config: Record<string, unknown> }>,
  mounts: vi.fn(),
  unmounts: vi.fn(),
}));
vi.mock("../../api/dashboardOverview", () => ({ useDashboardOverview: () => state.query }));
vi.mock("./PiFeeSummary", () => ({ PiFeeSummary: () => null }));
vi.mock("antd", async (original) => ({
  ...(await original<typeof AntdModule>()),
  Select: ({
    options,
    value,
    onChange,
    "aria-label": label,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
    "aria-label": string;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option, index) => (
        <option key={index} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@ant-design/plots/es/components/area", () => ({
  default: function Plot(config: Record<string, unknown>) {
    state.renders.push({ kind: "area", config });
    useEffect(() => {
      state.mounts("area");
      return () => state.unmounts("area");
    }, []);
    return <div role="img" aria-label="面积图" />;
  },
}));
vi.mock("@ant-design/plots/es/components/rose", () => ({
  default: function Plot(config: Record<string, unknown>) {
    state.renders.push({ kind: "rose", config });
    useEffect(() => {
      state.mounts("rose");
      return () => state.unmounts("rose");
    }, []);
    return <div role="img" aria-label="品系图" />;
  },
}));

const navigate = vi.fn();
function overview(): DashboardOverviewResponse {
  return {
    month: "2026-09",
    availableMonths: ["2026-09", "2026-08"],
    intake: {
      month: "2026-09",
      batches: 1,
      animals: 9,
      trendUnit: "day",
      trend: [{ day: 1, batches: 1, animals: 9 }],
      strains: [{ strain: "合成品系", animals: 9 }],
      species: [],
    },
    rooms: [
      {
        roomName: "房间A",
        species: "mouse",
        cageDays: 9,
        amount: 1,
        unitPrice: 1,
        firstDay: 1,
        lastDay: 30,
        days: 30,
        trendUnit: "day",
        trend: [{ day: 1, cages: 9 }],
      },
    ],
    pi: [],
  };
}
function emptyOverview(): DashboardOverviewResponse {
  const result = overview();
  return { ...result, intake: { ...result.intake, batches: 0, animals: 0, trend: [], strains: [] }, rooms: [] };
}
function latest(kind: "area" | "rose", yField?: string) {
  const value = [...state.renders]
    .reverse()
    .find((entry) => entry.kind === kind && (!yField || entry.config.yField === yField));
  expect(value).toBeDefined();
  return value!.config;
}
function content(fontSize = 12) {
  return (
    <ConfigProvider theme={{ token: { fontSizeSM: fontSize } }}>
      <DashboardView navigate={navigate} />
    </ConfigProvider>
  );
}

beforeEach(() => {
  state.query = {
    data: overview(),
    isPending: false,
    isSuccess: true,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  };
  state.renders.length = 0;
  state.mounts.mockClear();
  state.unmounts.mockClear();
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps stable chart inputs isolated from fetch/error state and unrelated overview changes", async () => {
  const view = render(content());
  await waitFor(() => expect(state.mounts).toHaveBeenCalledTimes(3));
  const initialRenders = state.renders.length;
  const intake = latest("area", "animals");
  const rooms = latest("area", "cages");
  const strain = latest("rose");
  state.query.isFetching = true;
  view.rerender(content());
  expect(state.renders).toHaveLength(initialRenders);
  state.query.isFetching = false;
  state.query.isError = true;
  view.rerender(content());
  expect(screen.getByText("运营数据更新失败，暂显示上次结果")).toBeVisible();
  expect(state.renders).toHaveLength(initialRenders);
  state.query.isError = false;
  state.query.data = { ...state.query.data!, quantitySheetIacucCount: 5 };
  view.rerender(content());
  expect(state.renders).toHaveLength(initialRenders);
  expect(latest("area", "animals")).toBe(intake);
  expect(latest("area", "cages")).toBe(rooms);
  expect(latest("rose")).toBe(strain);
  const before = state.query.data;
  state.query.data = { ...before, intake: { ...before.intake, trend: [{ day: 1, animals: 13, batches: 1 }] } };
  view.rerender(content());
  expect(latest("area", "animals").data).toEqual([{ label: "1日", animals: 13, batches: 1 }]);
  expect(state.renders).toHaveLength(initialRenders + 1);
  expect(state.mounts).toHaveBeenCalledTimes(3);
});

it("reserves empty geometry without constructing plots and retains initialized plots through later empty results", async () => {
  state.query.data = emptyOverview();
  const view = render(content());
  expect(screen.getByText("当前统计范围暂无接收记录")).toBeVisible();
  expect(screen.getByText("当前统计范围暂无品系统计")).toBeVisible();
  expect(screen.getByText("当前统计范围暂无笼位统计")).toBeVisible();
  expect(state.mounts).not.toHaveBeenCalled();
  expect(
    Array.from(
      view.container.querySelectorAll<HTMLElement>(".ant-dashboard-chart-frame"),
      (element) => element.style.minHeight,
    ),
  ).toEqual(["180px", "280px", "220px"]);
  state.query.data = overview();
  view.rerender(content());
  await waitFor(() => expect(state.mounts).toHaveBeenCalledTimes(3));
  state.query.data = emptyOverview();
  view.rerender(content());
  expect(screen.getByText("当前统计范围暂无接收记录")).toBeVisible();
  expect(view.container.querySelectorAll(".ant-dashboard-chart-empty-plot[inert]")).toHaveLength(3);
  expect(state.unmounts).not.toHaveBeenCalled();
  state.query.data = overview();
  view.rerender(content());
  expect(state.mounts).toHaveBeenCalledTimes(3);
  expect(state.unmounts).not.toHaveBeenCalled();
});

it("preserves real zero trends and their distinct explanations", async () => {
  const value = overview();
  state.query.data = {
    ...value,
    intake: {
      ...value.intake,
      animals: 0,
      trend: [{ day: 1, animals: 0, batches: 1 }],
      strains: [{ strain: "零值品系", animals: 0 }],
    },
    rooms: [{ ...value.rooms[0], cageDays: 0, trend: [{ day: 1, cages: 0 }] }],
  };
  render(content());
  await waitFor(() => expect(state.mounts).toHaveBeenCalledTimes(2));
  expect(state.mounts.mock.calls).toEqual([["area"], ["area"]]);
  expect(screen.getByText(/已记录 1 批接收，接收只数为 0/)).toBeVisible();
  expect(screen.getByText("已记录品系，接收只数均为 0")).toBeVisible();
  expect(screen.queryByText("当前统计范围暂无笼位统计")).not.toBeInTheDocument();
  expect(latest("area", "cages").data).toEqual([{ day: "1日", cages: 0, roomName: "房间A" }]);
});

it("preserves strain totals/log values, room color order and selection while responding to theme tokens", async () => {
  const value = overview();
  value.intake.strains = [9, 8, 7, 6, 5, 4, 3].map((animals, index) => ({ strain: `品系${index}`, animals }));
  value.rooms = [
    value.rooms[0],
    { ...value.rooms[0] },
    { ...value.rooms[0], roomName: "房间B", trend: [{ day: 2, cages: 3 }] },
  ];
  state.query.data = value;
  const view = render(content());
  await waitFor(() => expect(state.mounts).toHaveBeenCalledTimes(3));
  const strain = latest("rose");
  const data = strain.data as Array<{ type: string; value: number; animals: number; percent: number }>;
  expect(data.map((row) => row.animals)).toEqual([9, 8, 7, 6, 5, 7]);
  expect(data.at(-1)).toEqual({ type: "其他", value: Math.log1p(7), animals: 7, percent: (7 / 42) * 100 });
  const tooltip = strain.tooltip as { items: Array<(value: (typeof data)[number]) => { name: string; value: string }> };
  expect(tooltip.items[0](data[0])).toEqual({ name: "接收只数", value: "9（21%）" });
  const allRooms = latest("area", "cages");
  const allStyle = allRooms.style as { fill: (value: Array<{ roomName: string }>) => string };
  expect(allStyle.fill([{ roomName: "房间A" }])).toContain("rgba(56, 114, 255");
  fireEvent.change(screen.getByLabelText("选择饲养间"), { target: { value: "房间B" } });
  const selected = latest("area", "cages");
  expect(selected.stack).toBe(false);
  expect(selected.colorField).toBeUndefined();
  expect(selected.data).toEqual([{ day: "2日", cages: 3 }]);
  expect((selected.style as { fill: (value: unknown[]) => string }).fill([])).toContain("rgba(250, 173, 20");
  expect((selected.tooltip as { items: Array<(value: { cages: number }) => unknown> }).items[0]({ cages: 3 })).toEqual({
    name: "房间B",
    value: 3,
  });
  view.rerender(content(18));
  await waitFor(() => expect((latest("rose").label as { fontSize: number }).fontSize).toBe(18));
  expect(latest("rose").data).toBe(data);
  expect(state.mounts).toHaveBeenCalledTimes(3);
});
