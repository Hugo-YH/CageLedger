import { afterEach, expect, it, vi } from "vitest";

import type { IntakeRecognitionImageInput, IntakeRecognitionUpload, SessionResponse } from "./contracts";
import { ApiError } from "./client";
import { registerIntakeImageFile, withIntakeImageRefs } from "./intakeImageUploads";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

function source(name = "预约.png"): IntakeRecognitionImageInput {
  return Object.freeze({ name, dataUrl: "data:image/png;base64,AP8BAg==" });
}

function receipt(
  id: string,
  name = "预约.png",
  size = 4,
  expiresAt = Date.now() + 30 * 60_000,
): IntakeRecognitionUpload {
  return {
    uploadId: id.repeat(32),
    name,
    mime: "image/png",
    size,
    sha256: "a".repeat(64),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function response(items: unknown[]) {
  return new Response(JSON.stringify({ items }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function bytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.onerror = () => reject(new Error(reader.error?.message || "读取测试图片失败"));
    reader.readAsArrayBuffer(blob);
  });
}

it("sends registered original File bytes in one ordered multipart request without reading preview URLs", async () => {
  const first = Object.freeze({ name: "原件.png", dataUrl: "preview only, not an upload source" });
  const second = source("另一张.png");
  registerIntakeImageFile(first, new File([new Uint8Array([0, 255, 1, 2])], first.name, { type: "image/png" }));
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(response([receipt("1", first.name), receipt("2", second.name)]));
  const operation = vi.fn((refs) => Promise.resolve(refs));
  await expect(withIntakeImageRefs([first, second], operation)).resolves.toEqual([
    { uploadId: "1".repeat(32) },
    { uploadId: "2".repeat(32) },
  ]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("/api/intake/recognition-uploads");
  const init = fetch.mock.calls[0][1]!;
  expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  const files = (init.body as FormData).getAll("file") as File[];
  expect(files.map((file) => file.name)).toEqual([first.name, second.name]);
  expect(await bytes(files[0])).toEqual([0, 255, 1, 2]);
  expect(await bytes(files[1])).toEqual([0, 255, 1, 2]);
});

it("accepts server-verified image formats when browser types follow misleading filenames", async () => {
  const images = [source("JPEG原图.png"), source("PNG原图.jpg"), source("WebP原图.png")];
  const declaredTypes = ["image/png", "image/jpeg", "image/png"];
  const actualTypes = ["image/jpeg", "image/png", "image/webp"] as const;
  images.forEach((image, index) => {
    registerIntakeImageFile(
      image,
      new File([new Uint8Array([0, 255, 1, 2])], image.name, { type: declaredTypes[index] }),
    );
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    response(
      images.map((image, index) => ({
        ...receipt(String(index + 1), image.name),
        mime: actualTypes[index],
      })),
    ),
  );
  const operation = vi.fn((refs) => Promise.resolve(refs));
  await expect(withIntakeImageRefs(images, operation)).resolves.toEqual([
    { uploadId: "1".repeat(32) },
    { uploadId: "2".repeat(32) },
    { uploadId: "3".repeat(32) },
  ]);
  expect(operation).toHaveBeenCalledOnce();
  const files = (fetch.mock.calls[0][1]?.body as FormData).getAll("file") as File[];
  expect(files.map((file) => file.type)).toEqual(declaredTypes);
});

it.each([{ mime: "image/gif" }, { mime: "text/html" }, { size: 5 }])(
  "rejects unsupported server formats or changed original sizes: %j",
  async (invalid) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response([{ ...receipt("1"), ...invalid }]));
    const operation = vi.fn();
    await expect(withIntakeImageRefs([source()], operation)).rejects.toThrow("预约图片上传结果无效");
    expect(operation).not.toHaveBeenCalled();
  },
);

it("shares concurrent uploads by local object and only uploads additions while keeping input order", async () => {
  const first = source("one.png");
  const second = source("two.png");
  const pending = deferred<Response>();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response([receipt("2", second.name)]));
  const one = withIntakeImageRefs([first], (refs) => Promise.resolve(refs));
  const both = withIntakeImageRefs([second, first], (refs) => Promise.resolve(refs));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(((fetch.mock.calls[1][1]?.body as FormData).getAll("file") as File[]).map((file) => file.name)).toEqual([
    second.name,
  ]);
  pending.resolve(response([receipt("1", first.name)]));
  await expect(one).resolves.toEqual([{ uploadId: "1".repeat(32) }]);
  await expect(both).resolves.toEqual([{ uploadId: "2".repeat(32) }, { uploadId: "1".repeat(32) }]);
  await withIntakeImageRefs([first], (refs) => Promise.resolve(refs));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("discards failed upload evidence and allows an explicit later retry", async () => {
  const image = source();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(response([receipt("2")]));
  const operation = vi.fn((refs) => Promise.resolve(refs));
  await expect(withIntakeImageRefs([image], operation)).rejects.toThrow("offline");
  expect(operation).not.toHaveBeenCalled();
  await expect(withIntakeImageRefs([image], operation)).resolves.toEqual([{ uploadId: "2".repeat(32) }]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not let an aborted upload's late callback evict a newer successful receipt", async () => {
  const image = source();
  const old = deferred<Response>();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response([receipt("2")]));
  const controller = new AbortController();
  const previous = withIntakeImageRefs([image], (refs) => Promise.resolve(refs), controller.signal);
  const previousResult = expect(previous).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await withIntakeImageRefs([image], (refs) => Promise.resolve(refs));
  old.resolve(response([receipt("1")]));
  await previousResult;
  await Promise.resolve();
  await expect(withIntakeImageRefs([image], (refs) => Promise.resolve(refs))).resolves.toEqual([
    { uploadId: "2".repeat(32) },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reuploads once only when the server guarantees the reference expired before any operation", async () => {
  const image = source();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response([receipt("1")]))
    .mockResolvedValueOnce(response([receipt("2")]));
  const operation = vi
    .fn()
    .mockRejectedValueOnce(new ApiError("原图已过期", 410, { code: "INTAKE_UPLOAD_EXPIRED" }))
    .mockResolvedValueOnce("saved");
  await expect(withIntakeImageRefs([image], operation)).resolves.toBe("saved");
  expect(operation.mock.calls).toEqual([[[{ uploadId: "1".repeat(32) }]], [[{ uploadId: "2".repeat(32) }]]]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  [409, "INTAKE_DUPLICATE_CONFIRMATION_REQUIRED"],
  [410, "OTHER_EXPIRED_STATE"],
  [503, "HTTP_503"],
])("never automatically retries a business failure (%s/%s)", async (status, code) => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response([receipt("1")]));
  const error = new ApiError("请人工处理", status, { code });
  const operation = vi.fn().mockRejectedValue(error);
  await expect(withIntakeImageRefs([source()], operation)).rejects.toBe(error);
  expect(operation).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

it("stops after the second explicit expiry instead of looping an unavailable upload store", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response([receipt("1")]));
  const error = new ApiError("服务已重启", 410, { code: "INTAKE_UPLOAD_EXPIRED" });
  const operation = vi.fn().mockRejectedValue(error);
  // Each fetch needs a fresh readable response body.
  fetch.mockImplementation(() => Promise.resolve(response([receipt("1")])));
  await expect(withIntakeImageRefs([source()], operation)).rejects.toBe(error);
  expect(operation).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("refreshes locally expired receipts before sending a business request", async () => {
  const image = source();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response([receipt("1", image.name, 4, now + 1000)]))
    .mockResolvedValueOnce(response([receipt("2", image.name, 4, now + 600_000)]));
  await withIntakeImageRefs([image], (refs) => Promise.resolve(refs));
  clock.mockReturnValue(now + 1001);
  await expect(withIntakeImageRefs([image], (refs) => Promise.resolve(refs))).resolves.toEqual([
    { uploadId: "2".repeat(32) },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("cancels old-account uploads and never applies their late references to a new session", async () => {
  const session = (id: string) => ({ user: { id, role: "admin" } }) as SessionResponse;
  queryClient.setQueryData(queryKeys.session, session("first"));
  const image = source();
  const old = deferred<Response>();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response([receipt("2")]));
  const oldOperation = vi.fn((refs) => Promise.resolve(refs));
  const previous = withIntakeImageRefs([image], oldOperation);
  const previousResult = expect(previous).rejects.toMatchObject({ name: "AbortError" });
  queryClient.setQueryData(queryKeys.session, session("second"));
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await expect(withIntakeImageRefs([image], (refs) => Promise.resolve(refs))).resolves.toEqual([
    { uploadId: "2".repeat(32) },
  ]);
  old.resolve(response([receipt("1")]));
  await previousResult;
  expect(oldOperation).not.toHaveBeenCalled();
});
