import type { SessionUser } from "./session";

export interface IacucIndexItem {
  iacuc: string;
  project: string;
  pi: string;
  owner: string;
  funding: string;
  projectStartDate?: string;
  projectEndDate?: string;
}

export interface IacucExpiryItem {
  iacuc: string;
  projectEndDate?: string;
}

export type ManagedUser = SessionUser;

export interface PrincipalIdentity {
  pi: string;
  principalType: "pi" | "independent";
  freeCageAllowance: number;
  updatedAt: string;
}

export interface IacucIndexStatus {
  count: number;
  updatedAt: string;
  source: string;
}

export interface AuditEvent {
  id: string;
  message: string;
  actorDisplayName: string;
  action: string;
  entityType: string;
  at: string;
}

export interface SystemInfo {
  name: string;
  title: string;
  description: string;
  version: string;
  organization: string;
  department: string;
  developer: string;
  contactEmail: string;
  license: string;
  copyright: string;
  repositoryUrl: string;
  build: string;
  revisionShort: string;
}

export interface SystemLatencyMetrics {
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface SystemPerformance {
  uptimeSeconds: number;
  requests: SystemLatencyMetrics & {
    total: number;
    slow: number;
  };
  cache: {
    entries: number;
    capacity: number;
    hits: number;
    misses: number;
    expirations: number;
    evictions: number;
    hitRate: number | null;
  };
  database: SystemLatencyMetrics & {
    operations: number;
    slowOperations: number;
    lockErrors: number;
  };
  thresholds: {
    slowRequestMs: number;
    slowDatabaseMs: number;
  };
}

export interface SystemEnvironment {
  cpu: {
    model: string;
    architecture: string;
    cores: number;
    load: [number | null, number | null, number | null];
  };
  memory: {
    totalBytes: number | null;
  };
  system: {
    platform: string;
    release: string;
    version: string;
    hostname: string;
    container: "docker" | null;
  };
  python: {
    version: string;
    implementation: string;
    compiler: string;
    executable: string;
    bits64: boolean;
  };
  database: {
    ok: boolean;
    journalMode: string;
    sizeBytes: number | null;
    tables: number;
    path: string;
  };
  performance: SystemPerformance;
}

export interface SystemUpdateStatus {
  currentVersion?: string | null;
  latestVersion?: string | null;
  latestUrl?: string | null;
  latestMessage?: string | null;
  updateAvailable?: boolean | null;
  checkedAt?: string;
  disabled?: boolean;
}
