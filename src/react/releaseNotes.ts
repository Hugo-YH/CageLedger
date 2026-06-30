import { CURRENT_RELEASE_NOTES } from "./releaseNotesCurrent";
import { HISTORICAL_RELEASE_NOTES } from "./releaseNotesHistory";
import type { ReleaseNote } from "./releaseNoteModel";

export type { ReleaseNote } from "./releaseNoteModel";

export const SYSTEM_RELEASE_NOTES: ReleaseNote[] = [...CURRENT_RELEASE_NOTES, ...HISTORICAL_RELEASE_NOTES];
