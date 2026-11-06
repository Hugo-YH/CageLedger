import type {
  IntakeRecognitionImageInput,
  IntakeRecognitionImageRef,
  IntakeRecognitionUpload,
  SessionResponse,
} from "./contracts";
import { ApiError, requestMultipart } from "./client";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

interface UploadEntry {
  generation: number;
  controller: AbortController;
  promise: Promise<IntakeRecognitionUpload>;
  receipt?: IntakeRecognitionUpload;
}

const files = new WeakMap<IntakeRecognitionImageInput, File>();
let uploads = new WeakMap<IntakeRecognitionImageInput, UploadEntry>();
const activeUploads = new Set<AbortController>();
let generation = 0;
let account = accountKey();

function accountKey() {
  const user = queryClient.getQueryData<SessionResponse>(queryKeys.session)?.user;
  return JSON.stringify([user?.id ?? null, user?.role ?? null]);
}

function currentGeneration() {
  const next = accountKey();
  if (next !== account) {
    account = next;
    generation += 1;
    uploads = new WeakMap();
    for (const controller of activeUploads) controller.abort();
  }
  return generation;
}

// Reuse the existing session owner; no image bytes or business data enter Query.
queryClient.getQueryCache().subscribe((event) => {
  const key: unknown = event.query.queryKey;
  const first: unknown = Array.isArray(key) ? key[0] : undefined;
  if (first === queryKeys.session[0]) currentGeneration();
});

export function registerIntakeImageFile(source: IntakeRecognitionImageInput, file: File) {
  files.set(source, file);
}

function abortError() {
  return new DOMException("预约图片请求已取消", "AbortError");
}

function requestError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return abortError();
  return error instanceof Error ? error : new Error("预约图片上传失败，请重试。");
}

function requireCurrent(started: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (started !== currentGeneration()) throw abortError();
}

function inputFile(source: IntakeRecognitionImageInput): Blob {
  const file = files.get(source);
  if (file) return file;
  // Compatibility for callers holding an older in-memory data URL, never a second HTTP fetch.
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source.dataUrl);
  if (!match) throw new Error("预约图片数据格式无效，请重新选择图片。");
  const content = atob(match[2]);
  return new Blob([Uint8Array.from(content, (character) => character.charCodeAt(0))], { type: match[1] });
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(requestError(signal.reason, signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(requestError(signal.reason, signal));
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(requestError(error, signal));
      },
    );
  });
}

function startUploads(missing: IntakeRecognitionImageInput[], started: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const owned: Array<{ source: IntakeRecognitionImageInput; entry: UploadEntry }> = [];
  const forgetOwned = () => {
    for (const { source, entry } of owned) if (uploads.get(source) === entry) uploads.delete(source);
  };
  const abort = () => {
    controller.abort(signal?.reason);
    forgetOwned();
  };
  signal?.addEventListener("abort", abort, { once: true });
  activeUploads.add(controller);
  const batch = (async () => {
    try {
      requireCurrent(started, signal);
      const form = new FormData();
      const bodies = missing.map(inputFile);
      missing.forEach((source, index) => form.append("file", bodies[index], source.name));
      const response = await requestMultipart<{ items: IntakeRecognitionUpload[] }>(
        "/api/intake/recognition-uploads",
        form,
        { signal: controller.signal },
      );
      requireCurrent(started, signal);
      // The server verifies original bytes; File.type may only reflect a misleading filename.
      if (
        !Array.isArray(response.items) ||
        response.items.length !== missing.length ||
        response.items.some(
          (item, index) =>
            !item ||
            !/^[a-f0-9]{32}$/.test(item.uploadId) ||
            typeof item.name !== "string" ||
            !["image/png", "image/jpeg", "image/webp"].includes(item.mime) ||
            item.size !== bodies[index].size ||
            !/^[a-f0-9]{64}$/.test(item.sha256) ||
            !Number.isFinite(Date.parse(item.expiresAt)),
        )
      )
        throw new Error("预约图片上传结果无效，请重新选择图片。");
      return response.items;
    } finally {
      signal?.removeEventListener("abort", abort);
      activeUploads.delete(controller);
    }
  })();
  missing.forEach((source, index) => {
    const entry: UploadEntry = {
      generation: started,
      controller,
      promise: batch.then((items) => items[index]),
    };
    entry.promise = entry.promise
      .then((receipt) => {
        requireCurrent(started, signal);
        entry.receipt = receipt;
        return receipt;
      })
      .catch((error) => {
        if (uploads.get(source) === entry) uploads.delete(source);
        throw error;
      });
    owned.push({ source, entry });
    uploads.set(source, entry);
  });
}

async function references(images: IntakeRecognitionImageInput[], started: number, signal?: AbortSignal) {
  requireCurrent(started, signal);
  const missing: IntakeRecognitionImageInput[] = [];
  for (const source of new Set(images)) {
    const entry = uploads.get(source);
    if (
      !entry ||
      entry.generation !== started ||
      entry.controller.signal.aborted ||
      (entry.receipt && Date.parse(entry.receipt.expiresAt) <= Date.now())
    )
      missing.push(source);
  }
  if (missing.length) startUploads(missing, started, signal);
  const entries = images.map((source) => uploads.get(source)!);
  const receipts = await waitFor(Promise.all(entries.map((entry) => entry.promise)), signal);
  requireCurrent(started, signal);
  return { refs: receipts.map(({ uploadId }) => ({ uploadId })), entries };
}

export async function withIntakeImageRefs<T>(
  images: IntakeRecognitionImageInput[] | undefined,
  operation: (refs: IntakeRecognitionImageRef[]) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!images?.length) return operation([]);
  if (images.length > 4) throw new Error("一次最多识别或新增 4 张预约图片");
  const started = currentGeneration();
  for (let attempt = 0; ; attempt += 1) {
    const { refs, entries } = await references(images, started, signal);
    try {
      requireCurrent(started, signal);
      const result = await operation(refs);
      requireCurrent(started, signal);
      return result;
    } catch (error) {
      if (
        attempt !== 0 ||
        !(error instanceof ApiError) ||
        error.status !== 410 ||
        error.code !== "INTAKE_UPLOAD_EXPIRED"
      )
        throw error;
      requireCurrent(started, signal);
      images.forEach((source, index) => {
        if (uploads.get(source) === entries[index]) uploads.delete(source);
      });
    }
  }
}
