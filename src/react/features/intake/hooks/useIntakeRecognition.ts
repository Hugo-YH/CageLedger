import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeRecognitionImageInput } from "../../../api/contracts";

const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 15 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type LocalImage = IntakeRecognitionImageInput & { size: number; key: string };

export function useIntakeRecognition(onChange: () => void) {
  const [images, setImages] = useState<LocalImage[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const imagesRef = useRef<LocalImage[]>([]);
  const pendingFiles = useRef(new Map<string, File[]>());
  const readGeneration = useRef(0);
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    version.current += 1;
    controller.current?.abort();
    controller.current = null;
    setPending(false);
  }, []);
  useEffect(
    () => () => {
      version.current += 1;
      readGeneration.current += 1;
      controller.current?.abort();
    },
    [],
  );
  const reset = useCallback(() => {
    invalidate();
    readGeneration.current += 1;
    pendingFiles.current.clear();
    setReading(false);
    imagesRef.current = [];
    setImages([]);
    setError("");
  }, [invalidate]);
  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      invalidate();
      onChange();
      const generation = readGeneration.current;
      const existing = imagesRef.current;
      const waiting = Array.from(pendingFiles.current.values()).flat();
      if (
        existing.length + waiting.length + files.length > 4 ||
        files.some((file) => !TYPES.has(file.type) || file.size > MAX_FILE) ||
        existing.reduce((sum, image) => sum + image.size, 0) +
          [...waiting, ...files].reduce((sum, file) => sum + file.size, 0) >
          MAX_TOTAL
      ) {
        setError("最多选择 4 张 PNG、JPEG 或 WebP 图片；单张不超过 5 MiB，合计不超过 15 MiB。");
        return;
      }
      const batchKey = crypto.randomUUID();
      pendingFiles.current.set(batchKey, files);
      setReading(true);
      try {
        const loaded = await Promise.all(
          files.map(
            (file) =>
              new Promise<LocalImage>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve({
                    name: file.name || "粘贴的图片",
                    dataUrl: String(reader.result),
                    size: file.size,
                    key: crypto.randomUUID(),
                  });
                reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
                reader.readAsDataURL(file);
              }),
          ),
        );
        if (readGeneration.current !== generation) return;
        imagesRef.current = [...imagesRef.current, ...loaded];
        setImages(imagesRef.current);
        setError("");
      } catch {
        if (readGeneration.current === generation) setError("图片读取失败，请重试。");
      } finally {
        if (readGeneration.current === generation) {
          pendingFiles.current.delete(batchKey);
          setReading(pendingFiles.current.size > 0);
        }
      }
    },
    [invalidate, onChange],
  );
  const remove = useCallback(
    (key: string) => {
      invalidate();
      onChange();
      imagesRef.current = imagesRef.current.filter((image) => image.key !== key);
      setImages(imagesRef.current);
      setError("");
    },
    [invalidate, onChange],
  );
  const begin = useCallback(() => {
    if (controller.current) return null;
    const next = new AbortController();
    controller.current = next;
    setPending(true);
    const currentVersion = version.current;
    return {
      signal: next.signal,
      isCurrent: () => version.current === currentVersion && !next.signal.aborted,
      finish: () => {
        if (controller.current === next) {
          controller.current = null;
          setPending(false);
        }
      },
    };
  }, []);
  const snapshot = useCallback(() => imagesRef.current.map(({ name, dataUrl }) => ({ name, dataUrl })), []);
  return { images, error, pending, reading, invalidate, reset, addFiles, remove, begin, snapshot };
}
