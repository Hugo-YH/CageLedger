import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { WorkspaceMemoryProvider } from "./WorkspaceMemoryProvider";
import { WorkspaceMemory, useWorkspaceMemory, useWorkspaceScroll } from "./workspaceMemory";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function List({ scope }: { scope: string }) {
  const [page, setPage] = useWorkspaceMemory(`${scope}:page`, 1);
  return <button onClick={() => setPage((value) => value + 1)}>第{page}页</button>;
}
function Workspace() {
  const [scope, setScope] = useState("billing");
  const [actor, setActor] = useState("first");
  return (
    <>
      <button onClick={() => setScope(scope === "billing" ? "workflow" : "billing")}>切换业务</button>
      <button onClick={() => setActor("second")}>切换账号</button>
      <WorkspaceMemoryProvider key={actor}>
        <List key={scope} scope={scope} />
      </WorkspaceMemoryProvider>
    </>
  );
}
describe("workspace UI memory", () => {
  it("remembers each unmounted list independently and clears on account change", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByRole("button", { name: "第1页" }));
    fireEvent.click(screen.getByText("切换业务"));
    expect(screen.getByRole("button", { name: "第1页" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("切换业务"));
    expect(screen.getByRole("button", { name: "第2页" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("切换账号"));
    expect(screen.getByRole("button", { name: "第1页" })).toBeInTheDocument();
  });
});

function scrollHarness() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const owner = document.createElement("main");
  owner.dataset.ui = "workspace";
  owner.style.overflowY = "auto";
  document.body.append(owner);
  const memory = new Map<string, unknown>([["list:scroll", 180]]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WorkspaceMemory.Provider value={memory}>{children}</WorkspaceMemory.Provider>
  );
  function frame() {
    const current = [...frames];
    frames.clear();
    act(() => {
      current.forEach(([, callback]) => callback(0));
    });
  }
  return { owner, wrapper, frame, frames };
}

it("restores once after the measurement frame and keeps later user scrolling", () => {
  const { owner, wrapper, frame, frames } = scrollHarness();
  const { rerender, unmount } = renderHook(({ ready }) => useWorkspaceScroll("list", ready), {
    wrapper,
    initialProps: { ready: true },
  });
  frame();
  expect(owner.scrollTop).toBe(0);
  expect(frames.size).toBe(1);
  frame();
  expect(owner.scrollTop).toBe(180);
  owner.scrollTop = 55;
  rerender({ ready: false });
  rerender({ ready: true });
  frame();
  expect(owner.scrollTop).toBe(55);
  unmount();
  owner.remove();
});

it("cancels a pending restore when the list is unmounted", () => {
  const { owner, wrapper, frame, frames } = scrollHarness();
  const { unmount } = renderHook(() => useWorkspaceScroll("list", true), { wrapper });
  frame();
  unmount();
  expect(frames.size).toBe(0);
  owner.scrollTop = 55;
  frame();
  expect(owner.scrollTop).toBe(55);
  owner.remove();
});
