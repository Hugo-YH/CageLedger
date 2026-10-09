import { Typography } from "antd";
import type { DiagnosticEvent, DiagnosticPage, FeedbackDiagnostics } from "../../../contracts/feedbackDiagnostics";
import { formatDateTime } from "../../components/WorkspaceUi";

const PAGE_LABELS: Record<DiagnosticPage, string> = {
  overview: "总览",
  cages: "笼卡管理",
  intake: "动物接收",
  quarantine: "检疫管理",
  "animal-inspection": "动物巡检",
  billing: "饲养费管理",
  workflows: "单据跟踪",
  feedback: "帮助与反馈",
  settings: "系统设置",
  scanner: "笼卡扫码",
  unknown: "页面加载",
};

function describe(event: DiagnosticEvent) {
  if (event.kind === "navigation") return "进入页面";
  if (event.kind === "action") return { save: "提交保存操作", delete: "删除操作", download: "下载操作" }[event.action];
  if (event.kind === "error") {
    const source = { runtime: "页面脚本", promise: "异步任务", react: "页面渲染", resource: "资源加载" }[event.source];
    return `${source}异常 · ${event.errorType}${event.line ? ` · 第 ${event.line} 行` : ""}${event.column ? `，第 ${event.column} 列` : ""}`;
  }
  return `${event.method} ${event.route} · ${event.status ? `HTTP ${event.status}` : "连接失败"} · ${event.durationMs} ms${event.requestId ? ` · 请求编号 ${event.requestId}` : ""}`;
}

export function FeedbackDiagnosticsPreview({ snapshot }: { snapshot: FeedbackDiagnostics }) {
  return (
    <div className="feedback-diagnostics-preview" role="region" aria-label="诊断信息预览">
      <Typography.Paragraph type="secondary">
        采集时间：{formatDateTime(new Date(snapshot.capturedAt).toISOString())}；此前 5 分钟，共{" "}
        {snapshot.events.length} 条。
      </Typography.Paragraph>
      {snapshot.events.length ? (
        <ul aria-label="近期诊断记录">
          {snapshot.events.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <span>
                {formatDateTime(new Date(event.at).toISOString())} · {PAGE_LABELS[event.page]}
              </span>
              <div>{describe(event)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <Typography.Paragraph>最近没有记录到页面错误、失败请求或操作轨迹。</Typography.Paragraph>
      )}
    </div>
  );
}
