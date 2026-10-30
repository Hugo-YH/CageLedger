import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Form } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FeedbackCreateDrawer } from "./FeedbackCreateDrawer";

const api = vi.hoisted(() => ({ create: vi.fn(), upload: vi.fn() }));
vi.mock("../../api/feedback", () => ({
  useCreateFeedback: () => ({ isPending: false, mutateAsync: api.create }),
  uploadFeedbackAttachment: api.upload,
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.create.mockReset();
  api.upload.mockReset();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function holdValidation() {
  const { result, unmount } = renderHook(() => Form.useForm());
  const form = result.current[0];
  unmount();
  const validation = deferred<{ title: string; kind: "bug"; module: string; description: string }>();
  vi.spyOn(Form, "useForm").mockReturnValue([form]);
  vi.spyOn(form, "validateFields").mockReturnValue(validation.promise);
  return validation;
}

const values = { title: "延迟校验", kind: "bug" as const, module: "笼卡管理", description: "验证关闭后的操作边界" };

it("marks validation as pending and prevents closing or duplicate submission", async () => {
  const validation = holdValidation();
  const close = vi.fn();
  const created = vi.fn();
  api.create.mockResolvedValue({ item: { id: "created" } });
  render(<FeedbackCreateDrawer open build="test" page="feedback" onClose={close} onCreated={created} />);
  const submit = screen.getByRole("button", { name: "提交" });
  fireEvent.click(submit);
  expect(submit).toBeDisabled();
  const cancel = screen.getByRole("button", { name: /取\s*消/ });
  expect(cancel).toBeDisabled();
  fireEvent.click(cancel);
  fireEvent.click(submit);
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    validation.resolve(values);
    await validation.promise;
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(created).toHaveBeenCalledWith("created");
});

it("does not start a write after validation finishes on an unmounted form", async () => {
  const validation = holdValidation();
  const created = vi.fn();
  api.create.mockResolvedValue({ item: { id: "stale" } });
  const view = render(<FeedbackCreateDrawer open build="test" page="feedback" onClose={vi.fn()} onCreated={created} />);
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  view.unmount();
  await act(async () => {
    validation.resolve(values);
    await validation.promise;
  });
  expect(api.create).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});

it("finishes an initiated write and its attachments without opening a stale detail drawer", async () => {
  const validation = holdValidation();
  const response = deferred<{ item: { id: string } }>();
  const upload = deferred<void>();
  const created = vi.fn();
  api.create.mockReturnValue(response.promise);
  api.upload.mockReturnValue(upload.promise);
  const view = render(<FeedbackCreateDrawer open build="test" page="feedback" onClose={vi.fn()} onCreated={created} />);
  const file = new File(["test image"], "继续上传.png", { type: "image/png" });
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("截图选择器应提供文件输入");
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("继续上传.png")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await act(async () => {
    validation.resolve(values);
    await validation.promise;
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => {
    response.resolve({ item: { id: "saved" } });
    await response.promise;
  });
  expect(api.upload).toHaveBeenCalledWith("saved", expect.any(String), file);
  await act(async () => {
    upload.resolve(undefined);
    await upload.promise;
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.upload).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
});
