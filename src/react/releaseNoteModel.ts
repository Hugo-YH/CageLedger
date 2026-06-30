export interface ReleaseNote {
  version: string;
  releasedAt?: string;
  title: string;
  items: string[];
  note?: string;
  notes?: string;
}
