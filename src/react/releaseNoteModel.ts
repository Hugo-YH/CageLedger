export interface ReleaseNote {
  version: string;
  build?: string;
  releasedAt?: string;
  title: string;
  items: string[];
  note?: string;
  notes?: string;
}
