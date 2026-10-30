import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiProvider, useNavigationGuard } from "../state/ui";
import { useUnsavedChanges } from "./useUnsavedChanges";

const feedback = vi.hoisted(() => ({ confirm: vi.fn(), info: vi.fn() }));
vi.mock("antd", () => ({
  App: { useApp: () => ({ modal: { confirm: feedback.confirm }, message: { info: feedback.info } }) },
}));

function unloadIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function useGuard({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  useUnsavedChanges(dirty, busy);
  return useNavigationGuard();
}

describe("document navigation draft protection", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    feedback.confirm.mockReset();
    feedback.info.mockReset();
    localStorage.clear();
  });

  it("blocks document actions while saving/uploading without opening a discard dialog", async () => {
    const { result } = renderHook(useGuard, { initialProps: { dirty: true, busy: true }, wrapper: UiProvider });
    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.current?.({ documentUnload: true });
    });
    expect(allowed).toBe(false);
    expect(feedback.info).toHaveBeenCalledOnce();
    expect(feedback.confirm).not.toHaveBeenCalled();
    expect(unloadIsBlocked()).toBe(true);
  });

  it("keeps protection after cancellation and shares one pending confirmation", async () => {
    let finish: (value: boolean) => void = () => {};
    feedback.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(useGuard, { initialProps: { dirty: true, busy: false }, wrapper: UiProvider });
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => {
      first = result.current.current?.({ documentUnload: true });
      second = result.current.current?.({ documentUnload: true });
    });
    expect(feedback.confirm).toHaveBeenCalledOnce();
    await act(async () => {
      finish(false);
      await Promise.all([first, second]);
    });
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(unloadIsBlocked()).toBe(true);
  });

  it("allows one approved document unload and protects later native refreshes", async () => {
    feedback.confirm.mockResolvedValue(true);
    const { result } = renderHook(useGuard, { initialProps: { dirty: true, busy: false }, wrapper: UiProvider });
    await act(async () => {
      expect(await result.current.current?.({ documentUnload: true })).toBe(true);
    });
    expect(unloadIsBlocked()).toBe(false);
    expect(unloadIsBlocked()).toBe(true);
  });

  it("does not treat an in-app confirmation as permission for a native unload", async () => {
    feedback.confirm.mockResolvedValue(true);
    const { result, unmount } = renderHook(useGuard, {
      initialProps: { dirty: true, busy: false },
      wrapper: UiProvider,
    });
    await act(async () => {
      expect(await result.current.current?.()).toBe(true);
    });
    expect(unloadIsBlocked()).toBe(true);
    unmount();
    expect(result.current.current).toBe(null);
    expect(unloadIsBlocked()).toBe(false);
  });
});
