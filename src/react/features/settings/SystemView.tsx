import {
  ApiOutlined,
  BgColorsOutlined,
  BookOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useState, type ReactNode } from "react";
import { Alert, Button, Card, Flex, Progress, Segmented, Skeleton, Space, Statistic, Tag, Typography } from "antd";

import {
  useSystemEnvironment,
  useSystemInfo,
  useSystemPerformanceHistory,
  useSystemUpdate,
} from "../../api/administration";
import type { SessionUser, SystemEnvironment, SystemPerformance } from "../../api/contracts";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";
import {
  cacheCapacityPercent,
  cacheHealth,
  cacheLookups,
  databaseHealth,
  formatCount,
  formatDuration,
  formatMilliseconds,
  formatPercent,
  pdfCacheCapacityPercent,
  pdfHealth,
  requestHealth,
  runtimeHealth,
  type RuntimeHealth,
} from "./systemStatus";

const CERTIFICATE_DOWNLOAD_URL = "/docs/cageledger.crt";
const REFRESH_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function SystemView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const info = useSystemInfo();
  const environment = useSystemEnvironment(user.role === "admin");
  const performanceHistory = useSystemPerformanceHistory(24, user.role === "admin");
  const [checkEnabled, setCheckEnabled] = useState(false);
  const update = useSystemUpdate(checkEnabled && user.role === "admin");

  const content = (
    <div className="system-status-page" data-feature="administration" data-ui="system-status-page">
      <SystemMasthead
        environment={environment.data}
        info={info}
        isAdmin={user.role === "admin"}
        onCheckUpdate={() => {
          if (checkEnabled) void update.refetch();
          else setCheckEnabled(true);
        }}
        updateLoading={update.isFetching}
      />
      {checkEnabled ? <UpdateCard update={update} /> : null}
      {user.role === "admin" ? (
        <RuntimeDashboard environment={environment} performanceHistory={performanceHistory} />
      ) : (
        <Alert
          description="当前账号可以查看版本、文档、客户端证书和本机界面设置。请求、缓存与 SQLite 运行指标仅向系统管理员开放。"
          showIcon
          title="运行指标由管理员维护"
          type="info"
        />
      )}
      <div className="system-tools-grid">
        <ClientToolsCard />
        <AppearanceCard onThemeChange={(theme) => dispatch({ type: "set-theme", theme })} theme={ui.theme} />
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <MobilePage onBack={() => navigate("rooms")} title="关于系统" titleAsHeading={false}>
        {content}
      </MobilePage>
    );
  }
  return (
    <section className="workspace-view system-workspace" data-feature="administration">
      <div className="workspace-body system-workspace-body">{content}</div>
    </section>
  );
}

function SystemMasthead({
  environment,
  info,
  isAdmin,
  onCheckUpdate,
  updateLoading,
}: {
  environment?: SystemEnvironment;
  info: ReturnType<typeof useSystemInfo>;
  isAdmin: boolean;
  onCheckUpdate: () => void;
  updateLoading: boolean;
}) {
  const health = environment ? runtimeHealth(environment) : null;
  return (
    <Card className="system-masthead" variant="borderless">
      <div className="system-masthead-main">
        <div className="system-brand-mark" aria-hidden>
          <img alt="" src="/cageledger-icon.svg" />
        </div>
        <div className="system-masthead-copy">
          <Space size={8} wrap>
            <Typography.Text className="system-eyebrow">CageLedger</Typography.Text>
            {info.data ? (
              <Tag color="blue">
                {info.data.version}
                {info.data.build ? ` · Build ${info.data.build}` : ""}
              </Tag>
            ) : null}
            {isAdmin && health ? <HealthTag health={health} /> : null}
          </Space>
          <Typography.Title level={1}>系统状态</Typography.Title>
          <Typography.Paragraph>
            {isAdmin
              ? "查看当前服务进程的请求、缓存与 SQLite 运行状态，并从异常信号直接定位需要处理的部分。"
              : "查看 CageLedger 版本、使用文档、客户端证书与本机界面设置。"}
          </Typography.Paragraph>
        </div>
        <Flex className="system-masthead-actions" gap={8} wrap>
          {isAdmin ? (
            <Button loading={updateLoading} onClick={onCheckUpdate}>
              检查更新
            </Button>
          ) : null}
          <Button href="/docs/" icon={<BookOutlined aria-hidden />}>
            项目文档
          </Button>
          <Button href="/docs/releases/">更新记录</Button>
          {info.data?.repositoryUrl ? (
            <Button href={info.data.repositoryUrl} icon={<CodeOutlined aria-hidden />} rel="noreferrer" target="_blank">
              Gitea 仓库
            </Button>
          ) : null}
        </Flex>
      </div>
      {info.isPending ? (
        <Skeleton active className="system-info-skeleton" paragraph={{ rows: 1 }} title={false} />
      ) : null}
      {info.isError ? (
        <Alert
          action={
            <Button onClick={() => void info.refetch()} size="small">
              重试
            </Button>
          }
          description={info.error.message}
          showIcon
          title="版本信息暂时不可用"
          type="warning"
        />
      ) : null}
    </Card>
  );
}

function RuntimeDashboard({
  environment,
  performanceHistory,
}: {
  environment: ReturnType<typeof useSystemEnvironment>;
  performanceHistory: ReturnType<typeof useSystemPerformanceHistory>;
}) {
  if (environment.isPending) {
    return (
      <Card aria-busy="true" className="system-runtime-loading">
        <Skeleton active paragraph={{ rows: 8 }} title={{ width: "34%" }} />
      </Card>
    );
  }
  if (environment.isError || !environment.data) {
    return (
      <Alert
        action={
          <Button loading={environment.isFetching} onClick={() => void environment.refetch()} size="small">
            重新读取
          </Button>
        }
        description={environment.error?.message || "未返回运行状态"}
        showIcon
        title="运行状态获取失败"
        type="error"
      />
    );
  }

  const data = environment.data;
  const performance = data.performance;
  const overall = runtimeHealth(data);
  const cache = cacheHealth(performance);
  const requests = requestHealth(performance);
  const database = databaseHealth(data);
  const pdf = pdfHealth(performance);

  return (
    <section aria-labelledby="system-runtime-title" className="system-runtime-section">
      <div className="system-section-heading">
        <div>
          <Typography.Title id="system-runtime-title" level={2}>
            当前服务进程
          </Typography.Title>
          <Typography.Text type="secondary">自本次启动以来累计；延迟统计最多保留最近 512 个样本</Typography.Text>
        </div>
        <Flex align="center" gap={8} wrap>
          <Typography.Text className="system-refresh-time" type="secondary">
            更新于 {formatRefreshTime(environment.dataUpdatedAt)}
          </Typography.Text>
          <Button
            icon={<ReloadOutlined aria-hidden />}
            loading={environment.isFetching}
            onClick={() => void environment.refetch()}
          >
            刷新状态
          </Button>
        </Flex>
      </div>

      <div aria-live="polite" className="system-pulse-strip">
        <PulseTile health={overall} icon={<ThunderboltOutlined aria-hidden />} label="服务状态" value={overall.label} />
        <PulseTile health={cache} label="缓存命中率" value={formatPercent(performance.cache.hitRate)} />
        <PulseTile health={requests} label="HTTP P95" value={formatMilliseconds(performance.requests.p95Ms)} />
        <PulseTile health={database} label="SQLite P95" value={formatMilliseconds(performance.database.p95Ms)} />
        <PulseTile health={pdf} label="PDF 队列" value={formatCount(performance.pdf.jobs.active)} />
        <PulseTile
          health={{ detail: "本次进程", label: "运行时长", tone: "default" }}
          label="运行时长"
          value={formatDuration(performance.uptimeSeconds)}
        />
      </div>

      <div className="system-diagnostics-grid">
        <CacheCard performance={performance} />
        <RequestCard performance={performance} />
        <DatabaseCard environment={data} />
        <PdfCard performance={performance} />
      </div>
      <PerformanceHistoryCard history={performanceHistory} />
    </section>
  );
}

function PerformanceHistoryCard({ history }: { history: ReturnType<typeof useSystemPerformanceHistory> }) {
  if (history.isPending) {
    return (
      <Card aria-busy="true" className="system-history-card">
        <Skeleton active paragraph={{ rows: 2 }} title={{ width: "28%" }} />
      </Card>
    );
  }
  if (history.isError || !history.data) {
    return (
      <Alert
        action={
          <Button loading={history.isFetching} onClick={() => void history.refetch()} size="small">
            重新读取
          </Button>
        }
        description={history.error?.message || "未返回历史性能记录"}
        showIcon
        title="性能历史读取失败"
        type="warning"
      />
    );
  }
  const { items, intervalSeconds, retentionDays } = history.data;
  const latest = items.at(-1);
  const peakRequestP95 = items.reduce<number | null>(
    (peak, item) =>
      item.requestP95Ms !== null && (peak === null || item.requestP95Ms > peak) ? item.requestP95Ms : peak,
    null,
  );
  const requestCount = items.reduce((total, item) => total + item.requestCount, 0);
  return (
    <Card
      className="system-history-card"
      extra={
        <Button loading={history.isFetching} onClick={() => void history.refetch()} size="small">
          刷新历史
        </Button>
      }
      title={
        <SectionTitle
          icon={<ApiOutlined aria-hidden />}
          subtitle={`每 ${Math.round(intervalSeconds / 60)} 分钟汇总一次，最长保留 ${retentionDays} 天`}
          title="最近 24 小时性能记录"
        />
      }
    >
      <div aria-live="polite" className="system-history-summary">
        <Statistic title="已记录周期" value={formatCount(items.length)} />
        <Statistic title="周期内请求" value={formatCount(requestCount)} />
        <Statistic title="HTTP P95 峰值" value={formatMilliseconds(peakRequestP95)} />
        <Statistic title="最新 SQLite P95" value={formatMilliseconds(latest?.databaseP95Ms ?? null)} />
      </div>
      <Typography.Text type="secondary">
        {latest
          ? `最近记录：${formatObservedTime(latest.observedAt)}；历史记录用于比较版本升级和优化前后的变化。`
          : "服务启动后会立即写入基线，后续记录按设定周期追加。"}
      </Typography.Text>
    </Card>
  );
}

function PulseTile({
  health,
  icon,
  label,
  value,
}: {
  health: RuntimeHealth;
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="system-pulse-tile" data-tone={health.tone}>
      <div className="system-pulse-label">
        <span aria-hidden className="system-status-dot" />
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <span className="system-pulse-detail">{health.detail}</span>
    </div>
  );
}

function CacheCard({ performance }: { performance: SystemPerformance }) {
  const health = cacheHealth(performance);
  const capacity = cacheCapacityPercent(performance);
  return (
    <DiagnosticCard
      extra={<HealthTag health={health} />}
      icon={<ThunderboltOutlined aria-hidden />}
      subtitle="命中率包含命中、未命中和过期读取"
      title="数据缓存"
    >
      <Statistic title="命中率" value={formatPercent(performance.cache.hitRate)} />
      <div className="system-capacity-block">
        <Flex justify="space-between">
          <Typography.Text type="secondary">缓存容量</Typography.Text>
          <Typography.Text>{`${performance.cache.entries} / ${performance.cache.capacity}`}</Typography.Text>
        </Flex>
        <Progress aria-label="缓存容量占用" percent={capacity} showInfo={false} size="small" />
      </div>
      <MetricRows
        items={[
          ["缓存读取", formatCount(cacheLookups(performance))],
          ["命中", formatCount(performance.cache.hits)],
          ["未命中", formatCount(performance.cache.misses)],
          ["过期", formatCount(performance.cache.expirations)],
          ["容量淘汰", formatCount(performance.cache.evictions)],
        ]}
      />
    </DiagnosticCard>
  );
}

function RequestCard({ performance }: { performance: SystemPerformance }) {
  const health = requestHealth(performance);
  return (
    <DiagnosticCard
      extra={<HealthTag health={health} />}
      icon={<ApiOutlined aria-hidden />}
      subtitle="包含 API、页面和静态资源请求"
      title="HTTP 请求"
    >
      <Statistic title="P95 响应时间" value={formatMilliseconds(performance.requests.p95Ms)} />
      <MetricRows
        items={[
          ["请求总数", formatCount(performance.requests.total)],
          ["延迟样本", formatCount(performance.requests.sampleCount)],
          ["P50", formatMilliseconds(performance.requests.p50Ms)],
          ["最大耗时", formatMilliseconds(performance.requests.maxMs)],
          ["慢请求", formatCount(performance.requests.slow)],
        ]}
      />
    </DiagnosticCard>
  );
}

function DatabaseCard({ environment }: { environment: SystemEnvironment }) {
  const health = databaseHealth(environment);
  const { database, performance } = environment;
  return (
    <DiagnosticCard
      extra={<HealthTag health={health} />}
      icon={<DatabaseOutlined aria-hidden />}
      subtitle="SQLite 连接操作与锁状态"
      title="SQLite"
    >
      <Statistic title="P95 操作时间" value={formatMilliseconds(performance.database.p95Ms)} />
      <MetricRows
        items={[
          ["操作总数", formatCount(performance.database.operations)],
          ["P50", formatMilliseconds(performance.database.p50Ms)],
          ["最大耗时", formatMilliseconds(performance.database.maxMs)],
          ["慢操作", formatCount(performance.database.slowOperations)],
          ["锁错误", formatCount(performance.database.lockErrors)],
          ["数据库", `${database.journalMode || "未知模式"} · ${formatBytes(database.sizeBytes)}`],
        ]}
      />
    </DiagnosticCard>
  );
}

function PdfCard({ performance }: { performance: SystemPerformance }) {
  const health = pdfHealth(performance);
  const { cache, jobs, renderer } = performance.pdf;
  return (
    <DiagnosticCard
      extra={<HealthTag health={health} />}
      icon={<FilePdfOutlined aria-hidden />}
      subtitle="后台队列、Chromium 渲染与磁盘缓存"
      title="PDF 生成"
    >
      <Statistic title="P95 生成时间" value={formatMilliseconds(renderer.p95Ms)} />
      <div className="system-capacity-block">
        <Flex justify="space-between">
          <Typography.Text type="secondary">PDF 缓存容量</Typography.Text>
          <Typography.Text>{`${formatBytes(cache.sizeBytes)} / ${formatBytes(cache.capacityBytes)}`}</Typography.Text>
        </Flex>
        <Progress
          aria-label="PDF 缓存容量占用"
          percent={pdfCacheCapacityPercent(performance)}
          showInfo={false}
          size="small"
        />
      </div>
      <MetricRows
        items={[
          ["当前任务", `${jobs.active} 个（等待 ${jobs.queued} · 生成 ${jobs.rendering}）`],
          ["后台预热", `${jobs.backgroundQueued} 个等待`],
          ["渲染队列", `${renderer.queueDepth} 个等待${renderer.active ? " · 正在生成" : ""}`],
          ["缓存命中率", formatPercent(cache.hitRate)],
          ["缓存文件", `${formatCount(cache.entries)} 份`],
          ["平均生成时间", formatMilliseconds(renderer.averageMs)],
          ["生成完成", `${formatCount(renderer.completed)} 份`],
          ["失败 / 超时", `${formatCount(renderer.failures)} / ${formatCount(renderer.timeouts)}`],
        ]}
      />
    </DiagnosticCard>
  );
}

function DiagnosticCard({
  children,
  extra,
  icon,
  subtitle,
  title,
}: {
  children: ReactNode;
  extra: ReactNode;
  icon: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <Card
      className="system-diagnostic-card"
      extra={extra}
      title={<SectionTitle icon={icon} subtitle={subtitle} title={title} />}
    >
      {children}
    </Card>
  );
}

function MetricRows({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="system-metric-rows">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ClientToolsCard() {
  return (
    <Card
      className="system-tool-card"
      title={
        <SectionTitle
          icon={<SafetyCertificateOutlined aria-hidden />}
          subtitle="启用内网 HTTPS 下的摄像头、剪贴板等安全能力"
          title="客户端工具"
        />
      }
    >
      <Typography.Paragraph type="secondary">
        仅在受控设备上安装 CageLedger 公开根证书。私钥保留在部署端证书管理中，不会包含在下载文件里。
      </Typography.Paragraph>
      <Flex gap={8} wrap>
        <Button
          download="cageledger.crt"
          href={CERTIFICATE_DOWNLOAD_URL}
          icon={<DownloadOutlined aria-hidden />}
          type="primary"
        >
          下载客户端证书
        </Button>
        <Button href="/docs/operations/https-and-certificate">查看安装说明</Button>
      </Flex>
    </Card>
  );
}

function AppearanceCard({
  onThemeChange,
  theme,
}: {
  onThemeChange: (theme: "system" | "light" | "dark") => void;
  theme: "system" | "light" | "dark";
}) {
  return (
    <Card
      className="system-tool-card"
      title={
        <SectionTitle
          icon={<BgColorsOutlined aria-hidden />}
          subtitle="只影响当前设备，不改变业务数据"
          title="本机外观"
        />
      }
    >
      <Segmented
        aria-label="显示模式"
        block
        onChange={(value) => onThemeChange(value as "system" | "light" | "dark")}
        options={[
          { label: "跟随系统", value: "system" },
          { label: "浅色", value: "light" },
          { label: "深色", value: "dark" },
        ]}
        value={theme}
      />
    </Card>
  );
}

function SectionTitle({ icon, subtitle, title }: { icon: ReactNode; subtitle: string; title: string }) {
  return (
    <div className="system-card-title">
      <span aria-hidden className="system-card-icon">
        {icon}
      </span>
      <span>
        <Typography.Title level={2}>{title}</Typography.Title>
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      </span>
    </div>
  );
}

function HealthTag({ health }: { health: RuntimeHealth }) {
  return (
    <Tag className="system-health-tag" data-tone={health.tone} variant="filled">
      {health.label}
    </Tag>
  );
}

function UpdateCard({ update }: { update: ReturnType<typeof useSystemUpdate> }) {
  const status = update.isFetching
    ? "正在检查最新 Release"
    : update.data?.updateAvailable
      ? "发现新版本"
      : update.data?.disabled
        ? "更新检查已关闭"
        : "当前已是最新版本";
  return (
    <Alert
      action={
        update.data?.latestUrl ? (
          <Button href={update.data.latestUrl} rel="noreferrer" size="small" target="_blank">
            查看发布页
          </Button>
        ) : undefined
      }
      description={
        <Space orientation="vertical" size={2}>
          <Typography.Text>
            {update.data?.latestVersion ? `最新发布版 ${update.data.latestVersion}` : "尚未获取远端版本"}
          </Typography.Text>
          {update.data?.latestMessage ? (
            <Typography.Text type="secondary">{update.data.latestMessage}</Typography.Text>
          ) : null}
          {update.isError ? <Typography.Text type="danger">{update.error.message}</Typography.Text> : null}
        </Space>
      }
      showIcon
      title={status}
      type={update.isError ? "error" : update.data?.updateAvailable ? "warning" : "info"}
    />
  );
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "大小未知";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  return `${(value / 1024 ** 2).toFixed(0)} MiB`;
}

function formatRefreshTime(timestamp: number): string {
  if (!timestamp) return "尚未更新";
  return REFRESH_TIME_FORMATTER.format(timestamp);
}

function formatObservedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : REFRESH_TIME_FORMATTER.format(date);
}
