import { Breadcrumb, Button, Card, Empty, Flex, Modal, Pagination, Space, Tag, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { type ReactNode, useEffect, useRef } from "react";

import { ActionButton, CommandBar, type ActionButtonProps, type ActionTone } from "./ui";

export interface WorkspaceBreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export interface WorkspaceSwitcherItem {
  label: string;
  description?: string;
  onClick: () => void;
}

export function WorkspaceHeader({
  kicker,
  title,
  summary,
  status,
  metrics,
  actions,
  toolbar,
  breadcrumbs,
  switcherLabel = "快速跳转",
  switcherItems,
}: {
  kicker: string;
  title: string;
  summary: string;
  status?: string;
  metrics?: Array<{ label: string; value: ReactNode; tone?: "success" | "warning" | "todo" }>;
  actions?: ReactNode;
  toolbar?: ReactNode;
  breadcrumbs?: WorkspaceBreadcrumbItem[];
  switcherLabel?: string;
  switcherItems?: WorkspaceSwitcherItem[];
}) {
  const hasBreadcrumbs = Boolean(breadcrumbs?.length);
  void switcherLabel;
  void switcherItems;
  return (
    <>
      <header className={`workspace-head ${hasBreadcrumbs ? "workspace-head-breadcrumb" : ""}`}>
        <div className="workspace-head-main">
          <Typography.Text className="workspace-kicker" type="secondary">
            {kicker}
          </Typography.Text>
          {hasBreadcrumbs ? (
            <Breadcrumb
              items={breadcrumbs!.map((crumb) => ({
                title: crumb.onClick ? (
                  <Button type="link" onClick={crumb.onClick}>
                    {crumb.label}
                  </Button>
                ) : (
                  crumb.label
                ),
              }))}
            />
          ) : null}
          <Flex align="center" className="workspace-title-line" gap={8} wrap>
            <Typography.Title level={1}>{title}</Typography.Title>
            {status ? (
              <Tag className="workspace-status-badge" color="blue">
                {status}
              </Tag>
            ) : null}
          </Flex>
          {summary ? (
            <Typography.Paragraph className="workspace-summary" type="secondary">
              {summary}
            </Typography.Paragraph>
          ) : null}
          {metrics?.length ? (
            <div className="workspace-meta-strip">
              {metrics.map((metric) => (
                <Card className={`workspace-meta-card ${metric.tone || ""}`} key={metric.label} size="small">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      {toolbar || actions ? (
        <CommandBar
          className="workspace-toolbar"
          context={toolbar ? <div className="workspace-toolbar-main">{toolbar}</div> : undefined}
          actions={actions ? <div className="workspace-toolbar-action-group">{actions}</div> : undefined}
        />
      ) : null}
    </>
  );
}

export function PageState({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <Empty description={detail || title}>{retry ? <Button onClick={retry}>重新加载</Button> : null}</Empty>
    </div>
  );
}

export function AsyncActionButton({
  pending,
  pendingLabel = "正在处理...",
  children,
  disabled,
  tone,
  ...buttonProps
}: Omit<ActionButtonProps, "children" | "tone"> & {
  pending: boolean;
  pendingLabel?: string;
  children: ReactNode;
  tone?: ActionTone;
}) {
  const { className, type = "button", ...nativeProps } = buttonProps;
  const inferredTone = className?.includes("danger")
    ? "destructive"
    : className?.includes("tertiary") || className?.includes("ghost")
      ? "tertiary"
      : className?.includes("primary") || className?.includes("flow-button")
        ? "primary"
        : "secondary";
  return (
    <ActionButton
      {...nativeProps}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      loading={pending}
      title={pending ? pendingLabel : nativeProps.title}
      tone={tone ?? inferredTone}
      type={type}
    >
      {pending ? pendingLabel : children}
    </ActionButton>
  );
}

export function ModalShell({
  ariaLabel,
  className = "",
  children,
  onClose,
}: {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const restoreTarget = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      shellRef.current?.querySelector<HTMLElement>("button[aria-label='关闭']")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const target = restoreTarget.current;
      requestAnimationFrame(() => target?.focus());
    };
  }, []);

  return (
    <Modal
      centered
      closable={false}
      footer={null}
      onCancel={onClose}
      open
      rootClassName={`app-modal-root ${className}`.trim()}
      title={<span className="app-visually-hidden">{ariaLabel}</span>}
      width="min(1120px, calc(100vw - 32px))"
    >
      <section aria-label={ariaLabel} className={`modal-shell ${className}`.trim()} ref={shellRef}>
        {children}
      </section>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "确认",
  pending,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  pending?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell ariaLabel={title} className="confirm-dialog" onClose={onCancel}>
      <div className="modal-shell-head">
        <h2>{title}</h2>
        <Button aria-label="关闭" icon={<CloseOutlined />} type="text" onClick={onCancel} />
      </div>
      <div className="modal-shell-body">
        <p>{message}</p>
      </div>
      <div className="modal-shell-actions">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button danger={danger} loading={pending} type="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Space>
      </div>
    </ModalShell>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
  pageSize,
  onPageSize,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
  onPageSize?: (pageSize: number) => void;
}) {
  return (
    <div className="pager" role="navigation" aria-label="列表分页">
      <Pagination
        current={page}
        pageSize={pageSize || Math.max(1, Math.ceil(total / Math.max(pages, 1)))}
        pageSizeOptions={[5, 10, 20, 50, 100]}
        showQuickJumper={pages > 8}
        showSizeChanger={pageSize && onPageSize ? { "aria-label": "每页显示条数" } : false}
        showTotal={(count) => `共 ${count} 条`}
        total={total}
        onChange={(nextPage, nextPageSize) => {
          if (nextPageSize !== pageSize && onPageSize) onPageSize(nextPageSize);
          else onPage(nextPage);
        }}
      />
    </div>
  );
}

export function formatMoney(value: number | string | undefined) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
