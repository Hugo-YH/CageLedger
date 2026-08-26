import { describe, expect, it } from "vitest";

import type { SystemEnvironment } from "../../api/contracts";
import {
  cacheCapacityPercent,
  cacheHealth,
  formatDuration,
  formatMilliseconds,
  formatPercent,
  pdfCacheCapacityPercent,
  pdfHealth,
  runtimeHealth,
} from "./systemStatus";

const environment: SystemEnvironment = {
  cpu: { model: "", architecture: "arm64", cores: 8, load: [null, null, null] },
  memory: { totalBytes: null },
  system: { platform: "test", release: "test", version: "test", hostname: "test", container: null },
  python: { version: "3.13", implementation: "CPython", compiler: "test", executable: "python", bits64: true },
  database: { ok: true, journalMode: "wal", sizeBytes: 1024, tables: 12, path: "test.sqlite" },
  performance: {
    uptimeSeconds: 3_900,
    requests: { total: 30, slow: 0, sampleCount: 30, p50Ms: 12, p95Ms: 40, maxMs: 80, breakdown: [] },
    cache: { entries: 128, capacity: 512, hits: 18, misses: 2, expirations: 0, evictions: 0, hitRate: 0.9 },
    database: {
      operations: 120,
      slowOperations: 0,
      lockErrors: 0,
      sampleCount: 120,
      p50Ms: 2,
      p95Ms: 8,
      maxMs: 30,
    },
    pdf: {
      cache: {
        entries: 12,
        sizeBytes: 12 * 1024 * 1024,
        capacityBytes: 512 * 1024 * 1024,
        ttlSeconds: 2_592_000,
        hits: 8,
        misses: 2,
        evictions: 0,
        hitRate: 0.8,
      },
      jobs: { queued: 0, rendering: 0, ready: 2, failed: 0, active: 0, backgroundQueued: 0 },
      renders: {
        completed: 2,
        failures: 0,
        sampleCount: 2,
        averageMs: 140,
        p50Ms: 130,
        p95Ms: 150,
        maxMs: 150,
      },
      renderer: {
        queueDepth: 0,
        active: false,
        completed: 2,
        failures: 0,
        timeouts: 0,
        sampleCount: 2,
        averageMs: 120,
        p50Ms: 110,
        p95Ms: 130,
        maxMs: 130,
      },
    },
    thresholds: { slowRequestMs: 500, slowDatabaseMs: 100 },
  },
};

describe("system status formatting", () => {
  it("formats empty and populated performance values", () => {
    expect(formatPercent(null)).toBe("暂无样本");
    expect(formatPercent(0.4567)).toBe("45.7%");
    expect(formatMilliseconds(null)).toBe("暂无样本");
    expect(formatMilliseconds(0.4)).toBe("<1 ms");
    expect(formatMilliseconds(8.4)).toBe("8.4 ms");
    expect(formatDuration(59)).toBe("不足 1 分钟");
    expect(formatDuration(3_900)).toBe("1 小时 5 分钟");
  });

  it("derives cache capacity and warmup state", () => {
    expect(cacheCapacityPercent(environment.performance)).toBe(25);
    expect(cacheHealth(environment.performance).tone).toBe("success");
    expect(
      cacheHealth({
        ...environment.performance,
        cache: { ...environment.performance.cache, hits: 2, misses: 1, hitRate: 2 / 3 },
      }).label,
    ).toBe("样本积累中");
  });

  it("flags explicit database and latency failures", () => {
    expect(runtimeHealth(environment).tone).toBe("success");
    expect(runtimeHealth({ ...environment, database: { ...environment.database, ok: false } }).tone).toBe("error");
    expect(
      runtimeHealth({
        ...environment,
        performance: {
          ...environment.performance,
          requests: { ...environment.performance.requests, p95Ms: 600 },
        },
      }).tone,
    ).toBe("warning");
  });

  it("reports PDF cache capacity and generation failures", () => {
    expect(pdfCacheCapacityPercent(environment.performance)).toBeCloseTo(2.34375);
    expect(pdfHealth(environment.performance).tone).toBe("success");
    const failedPerformance = {
      ...environment.performance,
      pdf: {
        ...environment.performance.pdf,
        renders: { ...environment.performance.pdf.renders, failures: 1 },
      },
    };
    expect(pdfHealth(failedPerformance)).toMatchObject({ label: "生成异常", tone: "warning" });
    expect(runtimeHealth({ ...environment, performance: failedPerformance }).tone).toBe("warning");
  });
});
