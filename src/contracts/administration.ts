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

export interface SystemRequestBreakdown {
  category: "api" | "download" | "page" | "static";
  route: string;
  total: number;
  slow: number;
  errors: number;
  responseBytes: number;
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  applicationP95Ms: number | null;
}

export interface PdfLatencyMetrics extends SystemLatencyMetrics {
  averageMs: number | null;
}

export interface SystemPerformance {
  uptimeSeconds: number;
  requests: SystemLatencyMetrics & {
    total: number;
    slow: number;
    breakdown: SystemRequestBreakdown[];
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
  pdf: {
    cache: {
      entries: number;
      sizeBytes: number;
      capacityBytes: number;
      ttlSeconds: number;
      hits: number;
      misses: number;
      evictions: number;
      hitRate: number | null;
    };
    jobs: {
      queued: number;
      rendering: number;
      ready: number;
      failed: number;
      active: number;
      backgroundQueued: number;
    };
    renders: PdfLatencyMetrics & {
      completed: number;
      failures: number;
    };
    renderer: PdfLatencyMetrics & {
      queueDepth: number;
      active: boolean;
      completed: number;
      failures: number;
      timeouts: number;
    };
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

export interface SystemPerformanceHistoryItem {
  observedAt: string;
  intervalSeconds: number;
  appVersion: string;
  processStartedAt: string;
  requestCount: number;
  slowRequestCount: number;
  requestP95Ms: number | null;
  databaseOperationCount: number;
  databaseLockErrorCount: number;
  databaseP95Ms: number | null;
  cacheHitRate: number | null;
  pdfActiveJobs: number;
  databaseSizeBytes: number | null;
}

export interface SystemPerformanceHistory {
  items: SystemPerformanceHistoryItem[];
  intervalSeconds: number;
  retentionDays: number;
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
