import { expect, it, vi } from "vitest";
import { uploadInspectionPhotos } from "./inspectionPhotoUploads";

const upload = vi.hoisted(() => vi.fn());
vi.mock("../../api/animalManagement", () => ({ uploadAnimalInspectionPhoto: upload }));

it("keeps at most three originals uploading and retains failed files in selection order", async () => {
  const completions: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  let active = 0;
  let maximum = 0;
  upload.mockImplementation(() => {
    active += 1;
    maximum = Math.max(maximum, active);
    return new Promise<void>((resolve, reject) => completions.push({ resolve, reject })).finally(() => {
      active -= 1;
    });
  });
  const items = Array.from({ length: 6 }, (_, index) => ({
    inspectionId: "inspection",
    findingId: `finding-${Math.floor(index / 3)}`,
    file: new File([String(index)], `${index}.jpg`, { type: "image/jpeg" }),
  }));
  const result = uploadInspectionPhotos(items);
  expect(upload).toHaveBeenCalledTimes(3);
  completions[1].reject(new Error("断线"));
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
  completions[0].resolve();
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(5));
  completions[2].resolve();
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(6));
  completions[3].resolve();
  completions[4].reject(new Error("断线"));
  completions[5].resolve();
  expect(await result).toEqual([items[1], items[4]]);
  expect(maximum).toBe(3);
  expect(upload.mock.calls.map((call) => call[2])).toEqual(items.map((item) => item.file));
});
