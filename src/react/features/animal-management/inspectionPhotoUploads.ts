import { uploadAnimalInspectionPhoto } from "../../api/animalManagement";

export interface InspectionPhotoUpload {
  inspectionId: string;
  findingId: string;
  file: File;
}

/** Keep original File objects and input order; one failed upload cannot cancel others. */
export async function uploadInspectionPhotos(items: InspectionPhotoUpload[]) {
  const failures = new Set<number>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        const { inspectionId, findingId, file } = items[index];
        try {
          if (!findingId) throw new Error("未匹配到异常处置项");
          await uploadAnimalInspectionPhoto(inspectionId, findingId, file);
        } catch {
          failures.add(index);
        }
      }
    }),
  );
  return items.filter((_, index) => failures.has(index));
}
