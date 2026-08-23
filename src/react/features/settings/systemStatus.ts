import type { SystemEnvironment, SystemPerformance } from "../../api/contracts";

const COUNT_FORMATTER = new Intl.NumberFormat("zh-CN");

export type RuntimeTone = "default" | "success" | "warning" | "error";

export interface RuntimeHealth {
  label: string;
  detail: string;
  tone: RuntimeTone;
}

export function runtimeHealth(environment: SystemEnvironment): RuntimeHealth {
  const { database, performance } = environment;
  if (!database.ok) {
    return { label: "需要处理", detail: "SQLite 状态异常", tone: "error" };
  }
  if (performance.database.lockErrors > 0) {
    return { label: "需要关注", detail: "本次运行出现过 SQLite 锁错误", tone: "warning" };
  }
  if (
    performance.pdf.renderer.failures > 0 ||
    performance.pdf.renderer.timeouts > 0 ||
    performance.pdf.renders.failures > 0
  ) {
    return { label: "需要关注", detail: "本次运行出现过 PDF 生成失败或超时", tone: "warning" };
  }
  if (isAbove(performance.requests.p95Ms, performance.thresholds.slowRequestMs)) {
    return { label: "需要关注", detail: "HTTP P95 已超过慢请求阈值", tone: "warning" };
  }
  if (isAbove(performance.database.p95Ms, performance.thresholds.slowDatabaseMs)) {
    return { label: "需要关注", detail: "SQLite P95 已超过慢操作阈值", tone: "warning" };
  }
  return { label: "运行正常", detail: "未发现明确的运行异常", tone: "success" };
}

export function cacheHealth(performance: SystemPerformance): RuntimeHealth {
  const lookups = cacheLookups(performance);
  if (lookups < 20 || performance.cache.hitRate === null) {
    return { label: "样本积累中", detail: `${lookups} 次缓存读取`, tone: "default" };
  }
  if (performance.cache.hitRate < 0.5) {
    return { label: "命中率偏低", detail: `${lookups} 次缓存读取`, tone: "warning" };
  }
  return { label: "缓存有效", detail: `${lookups} 次缓存读取`, tone: "success" };
}

export function requestHealth(performance: SystemPerformance): RuntimeHealth {
  if (performance.requests.sampleCount === 0) {
    return { label: "暂无样本", detail: "等待 HTTP 请求", tone: "default" };
  }
  if (isAbove(performance.requests.p95Ms, performance.thresholds.slowRequestMs)) {
    return {
      label: "P95 偏高",
      detail: `阈值 ${formatMilliseconds(performance.thresholds.slowRequestMs)}`,
      tone: "warning",
    };
  }
  return {
    label: "延迟正常",
    detail: `阈值 ${formatMilliseconds(performance.thresholds.slowRequestMs)}`,
    tone: "success",
  };
}

export function databaseHealth(environment: SystemEnvironment): RuntimeHealth {
  const { database, performance } = environment;
  if (!database.ok) return { label: "数据库异常", detail: "SQLite 状态检查失败", tone: "error" };
  if (performance.database.lockErrors > 0) {
    return { label: "出现锁错误", detail: `${performance.database.lockErrors} 次`, tone: "warning" };
  }
  if (isAbove(performance.database.p95Ms, performance.thresholds.slowDatabaseMs)) {
    return {
      label: "P95 偏高",
      detail: `阈值 ${formatMilliseconds(performance.thresholds.slowDatabaseMs)}`,
      tone: "warning",
    };
  }
  return { label: "SQLite 正常", detail: database.journalMode || "状态可用", tone: "success" };
}

export function pdfHealth(performance: SystemPerformance): RuntimeHealth {
  const pdf = performance.pdf;
  if (pdf.renderer.failures > 0 || pdf.renderer.timeouts > 0 || pdf.renders.failures > 0) {
    return {
      label: "生成异常",
      detail: `${pdf.renders.failures} 个任务失败，${pdf.renderer.failures} 次渲染失败，${pdf.renderer.timeouts} 次超时`,
      tone: "warning",
    };
  }
  if (pdf.jobs.active > 0 || pdf.renderer.active || pdf.renderer.queueDepth > 0) {
    return {
      label: "正在生成",
      detail: `${pdf.jobs.active} 个任务处理中，${pdf.renderer.queueDepth} 个等待渲染`,
      tone: "default",
    };
  }
  if (pdf.renderer.sampleCount === 0) {
    return { label: "等待首份", detail: "尚无 PDF 生成样本", tone: "default" };
  }
  return { label: "生成正常", detail: `${pdf.renderer.completed} 份已完成`, tone: "success" };
}

export function cacheLookups(performance: SystemPerformance): number {
  return performance.cache.hits + performance.cache.misses + performance.cache.expirations;
}

export function cacheCapacityPercent(performance: SystemPerformance): number {
  if (performance.cache.capacity <= 0) return 0;
  return Math.min(100, Math.max(0, (performance.cache.entries / performance.cache.capacity) * 100));
}

export function pdfCacheCapacityPercent(performance: SystemPerformance): number {
  const cache = performance.pdf.cache;
  if (cache.capacityBytes <= 0) return 0;
  return Math.min(100, Math.max(0, (cache.sizeBytes / cache.capacityBytes) * 100));
}

export function formatPercent(value: number | null): string {
  return value === null ? "暂无样本" : `${(value * 100).toFixed(1)}%`;
}

export function formatMilliseconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "暂无样本";
  if (value < 1) return "<1 ms";
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

export function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 60) return "不足 1 分钟";
  const totalMinutes = Math.floor(value / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value);
}

function isAbove(value: number | null, threshold: number): boolean {
  return value !== null && value > threshold;
}
