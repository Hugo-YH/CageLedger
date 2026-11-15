import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createQuantitySheet } from "../../../../domain/quantitySheets";
import type { QuantitySheetEditor } from "../hooks/useQuantitySheetEditor";
import type { SessionUser } from "../../../api/contracts";
import { QuantitySheetEditorForm } from "./QuantitySheetEditorForm";
import { focusQuantityValidationIssue } from "../quantityValidation";

vi.mock("./QuantityEditorPages", () => ({ QuantityEditorPages: () => null }));
vi.mock("./QuantityBillingOptions", () => ({ QuantityBillingOptions: () => null }));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const user = { displayName: "当前登记人员" } as SessionUser;
function editorFixture() {
  return {
    draft: createQuantitySheet("2026-10"),
    setDraft: vi.fn(),
    setEditorRows: vi.fn(),
    editorRows: [],
    notice: "",
    noticeKind: "info",
    iacucLookup: { error: "", apply: vi.fn() },
    iacucOptions: [],
    iacucMatch: undefined,
    piHistory: {},
    previousPi: "",
    piHint: false,
    rooms: [],
    selectedRoom: undefined,
    chooseRoom: vi.fn(),
    setField: vi.fn(),
    requestSave: vi.fn(),
    rowRefs: { current: [] },
    recalculate: vi.fn(),
    animalDetails: false,
    validationIssues: [],
    validationRowsExpanded: false,
    validateEditor: vi.fn(),
    restoreSourceField: vi.fn(),
  } as unknown as QuantitySheetEditor;
}
function form(editor: QuantitySheetEditor) {
  return <QuantitySheetEditorForm editor={editor} user={user} mode="entry" />;
}
function sourceField(label: string) {
  const wrapper = screen.getByLabelText(label).closest<HTMLElement>(".quantity-auto-field");
  if (!wrapper) throw new Error(`缺少字段 ${label}`);
  return within(wrapper);
}

it("distinguishes matching, missing sources and manual values and exposes restore only for a differing current source", () => {
  const editor = editorFixture();
  const view = render(form(editor));
  expect(sourceField("项目名称").getByText("待匹配")).toBeInTheDocument();
  editor.draft = { ...editor.draft, project: "人工项目" };
  view.rerender(form(editor));
  expect(sourceField("项目名称").getByText("手动填写")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "恢复项目名称来源值" })).not.toBeInTheDocument();

  editor.draft = { ...editor.draft, iacuc: "Z1", pi: "甲；乙", owner: "", funding: "" };
  editor.iacucMatch = { iacuc: "Z1", project: "来源项目", pi: "甲、乙", owner: "", funding: "" };
  view.rerender(form(editor));
  expect(sourceField("项目名称").getByText("已手动调整")).toBeInTheDocument();
  expect(sourceField("项目负责人").getByText("自动带入")).toBeInTheDocument();
  expect(sourceField("支撑经费").getByText("来源未提供")).toBeInTheDocument();
  const restore = screen.getByRole("button", { name: "恢复项目名称来源值" });
  expect(restore).toHaveAttribute("type", "button");
  expect(restore.closest("label")).toBeNull();
  fireEvent.click(restore);
  expect(editor.restoreSourceField).toHaveBeenCalledExactlyOnceWith("project");
  expect(editor.requestSave).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "恢复项目负责人来源值" })).not.toBeInTheDocument();

  editor.draft = { ...editor.draft, iacuc: "Z2" };
  view.rerender(form(editor));
  expect(sourceField("项目名称").getByText("手动填写")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "恢复项目名称来源值" })).not.toBeInTheDocument();
});

it("distinguishes an unselected room from a selected room without an administrator", () => {
  const editor = editorFixture();
  const view = render(form(editor));
  expect(screen.getByLabelText("房间管理员")).toHaveAttribute("placeholder", "请先选择房间");
  editor.draft = { ...editor.draft, roomId: "room" };
  editor.selectedRoom = { id: "room", name: "未配置管理员的房间" };
  view.rerender(form(editor));
  expect(screen.getByLabelText("房间管理员")).toHaveAttribute("placeholder", "该房间未配置管理员");
});

it("associates root errors, focuses the first field and keeps browser constraints enabled", () => {
  const editor = editorFixture();
  editor.draft = { ...editor.draft, month: "" };
  editor.validationIssues = [
    { field: "month", message: "请选择月份" },
    { field: "roomId", message: "请选择房间" },
    { field: "iacuc", message: "请填写 IACUC 编号" },
  ];
  const { container } = render(form(editor));
  const element = container.querySelector("form")!;
  expect(element.noValidate).toBe(false);
  for (const label of ["月份", "房间号", "IACUC 编号"]) {
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toBeInTheDocument();
  }
  const month = screen.getByLabelText("月份");
  const picker = month.closest<HTMLElement>(".ant-picker")!;
  const scrollIntoView = vi.fn();
  picker.scrollIntoView = scrollIntoView;
  focusQuantityValidationIssue(element, editor.validationIssues[0]);
  expect(month).toHaveFocus();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  const iacuc = screen.getByLabelText("IACUC 编号");
  expect(iacuc).toBeRequired();
  fireEvent.invalid(iacuc);
  expect(editor.validateEditor).toHaveBeenCalledWith(element);
  expect(editor.requestSave).not.toHaveBeenCalled();
});
