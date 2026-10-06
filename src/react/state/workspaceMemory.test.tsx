import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { WorkspaceMemoryProvider } from "./WorkspaceMemoryProvider";
import { useWorkspaceMemory } from "./workspaceMemory";

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
