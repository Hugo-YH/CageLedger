import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiProvider, useResolvedTheme, useUiDispatch } from "./ui";
import { readStoredThemePreference } from "./uiStorage";

const renders = vi.fn();

function ThemeProbe() {
  const theme = useResolvedTheme();
  renders();
  return <output aria-label="当前主题">{theme}</output>;
}

function Controls() {
  const dispatch = useUiDispatch();
  return (
    <>
      <button onClick={() => dispatch({ type: "navigate", view: "rooms" })}>切换房间页面</button>
      <button onClick={() => dispatch({ type: "set-theme", theme: "light" })}>浅色</button>
      <button onClick={() => dispatch({ type: "set-theme", theme: "system" })}>跟随系统</button>
    </>
  );
}

describe("resolved theme context", () => {
  let dark = false;
  let listeners: Set<() => void>;
  beforeEach(() => {
    localStorage.clear();
    dark = false;
    listeners = new Set();
    renders.mockClear();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return dark;
      },
      addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function setSystemDark(value: boolean) {
    act(() => {
      dark = value;
      for (const listener of listeners) listener();
    });
  }

  it("updates CSS and context together without navigation and cleans up the subscription", () => {
    const { unmount } = render(
      <UiProvider>
        <Controls />
        <ThemeProbe />
      </UiProvider>,
    );
    expect(screen.getByLabelText("当前主题")).toHaveTextContent("light");
    expect(listeners.size).toBe(1);
    setSystemDark(true);
    expect(screen.getByLabelText("当前主题")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    setSystemDark(false);
    expect(screen.getByLabelText("当前主题")).toHaveTextContent("light");
    unmount();
    expect(listeners.size).toBe(0);
  });

  it("does not broadcast navigation changes to theme-only consumers", () => {
    render(
      <UiProvider>
        <Controls />
        <ThemeProbe />
      </UiProvider>,
    );
    const before = renders.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "切换房间页面" }));
    expect(renders).toHaveBeenCalledTimes(before);
    expect(listeners.size).toBe(1);
  });

  it("honors and persists an explicit choice until following the system again", () => {
    render(
      <UiProvider>
        <Controls />
        <ThemeProbe />
      </UiProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "浅色" }));
    setSystemDark(true);
    expect(screen.getByLabelText("当前主题")).toHaveTextContent("light");
    expect(readStoredThemePreference()).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "跟随系统" }));
    expect(screen.getByLabelText("当前主题")).toHaveTextContent("dark");
    expect(readStoredThemePreference()).toBe("system");
  });
});
