import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageSkeleton } from "./PageSkeleton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("honors live reduced-motion preferences while retaining the same loading region", () => {
  let reduced = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-reduced-motion: reduce)" && reduced;
    },
    media: query,
    onchange: null,
    addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      if (query === "(prefers-reduced-motion: reduce)") listeners.add(listener as () => void);
    },
    removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as () => void);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  const { container } = render(<PageSkeleton label="结算列表" variant="table" />);
  const region = screen.getByRole("status", { name: "结算列表正在加载" });
  expect(container.querySelector(".ant-skeleton-active")).not.toBeNull();
  act(() => {
    reduced = true;
    listeners.forEach((listener) => listener());
  });
  expect(screen.getByRole("status", { name: "结算列表正在加载" })).toBe(region);
  expect(region).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector(".ant-skeleton-active")).toBeNull();
});

it("keeps an accessible loading placeholder when media preferences are unavailable", () => {
  vi.stubGlobal("matchMedia", undefined);
  render(<PageSkeleton label="人员资料" variant="form" />);
  expect(screen.getByRole("status", { name: "人员资料正在加载" })).toHaveAttribute("aria-busy", "true");
});
