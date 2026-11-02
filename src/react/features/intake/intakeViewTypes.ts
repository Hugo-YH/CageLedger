import type {
  IntakeBatch,
  IntakeBatchListItem,
  IntakeDuplicateDetails,
  IntakeRecognitionImageInput,
} from "../../api/contracts";
import type { IntakeCardPrintKind } from "../../print/intakeCards";

export interface PendingIntakePrintJob {
  batches: IntakeBatchListItem[];
  draft?: IntakeBatch;
  kind: IntakeCardPrintKind;
  cardCount: number;
  pageSize: number;
  missing: number;
  saveCurrent: boolean;
  exists: boolean;
  draftRevision: number;
}

export interface IntakeSaveIntent {
  item: IntakeBatch;
  exists: boolean;
  draftRevision: number;
  recognitionImages: IntakeRecognitionImageInput[];
  mode: "entry" | "batches";
  print?: { job: PendingIntakePrintJob; fillBlanks: boolean };
}

export interface PendingDuplicateSave {
  intent: IntakeSaveIntent;
  details: IntakeDuplicateDetails;
  error: string;
}
