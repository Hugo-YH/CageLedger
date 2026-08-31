import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenProvider(): never {
  throw new Error("Provider initialization failed");
}

describe("AppErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves healthy children unchanged", () => {
    render(
      <AppErrorBoundary>
        <main>工作区</main>
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("工作区");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a named recovery action if a provider or page crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <BrokenProvider />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("页面未能加载");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeEnabled();
  });
});
