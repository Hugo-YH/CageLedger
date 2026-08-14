import { Button, Empty, Flex, Modal, Pagination, Skeleton, Space, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { type ReactNode, useEffect, useRef } from "react";

import { ActionButton, CommandBar, type ActionButtonProps, type ActionTone } from "./ui";

export function WorkspaceToolbar({ toolbar, actions }: { toolbar?: ReactNode; actions?: ReactNode }) {
  return toolbar || actions ? (
    <CommandBar
      className="workspace-toolbar"
      context={toolbar ? <div className="workspace-toolbar-main">{toolbar}</div> : undefined}
      actions={actions ? <div className="workspace-toolbar-action-group">{actions}</div> : undefined}
    />
  ) : null;
}

export function PageState({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <Empty description={detail || title}>{retry ? <Button onClick={retry}>重新加载</Button> : null}</Empty>
    </div>
  );
}

type PageSkeletonVariant = "page" | "table" | "detail" | "form";

const skeletonRows = ["92%", "100%", "84%", "96%", "72%", "90%"];

/** Shared first-load placeholder for lazy workspace views and remote page data. */
export function PageSkeleton({
  label = "页面内容",
  variant = "page",
  rows = 5,
  compact = false,
}: {
  label?: string;
  variant?: PageSkeletonVariant;
  rows?: number;
  compact?: boolean;
}) {
  const visibleRows = skeletonRows.slice(0, Math.max(1, Math.min(rows, skeletonRows.length)));
  const isTable = variant === "table";
  const isDetail = variant === "detail";

  return (
    <section
      aria-busy="true"
      aria-label={`${label}正在加载`}
      aria-live="polite"
      className={`page-skeleton page-skeleton-${variant}${compact ? " is-compact" : ""}`}
      data-ui="page-skeleton"
      role="status"
    >
      <span className="app-visually-hidden">{label}正在加载</span>
      <div className="page-skeleton-heading">
        <Skeleton.Input active block size="large" />
        <Skeleton.Button active size="medium" />
      </div>
      {isTable ? (
        <div className="page-skeleton-table" aria-hidden="true">
          <div className="page-skeleton-table-head">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton.Input active block key={index} size="small" />
            ))}
          </div>
          {Array.from({ length: rows }, (_, index) => (
            <div className="page-skeleton-table-row" key={index}>
              {Array.from({ length: 5 }, (_, cellIndex) => (
                <Skeleton.Input active block key={cellIndex} size="small" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Skeleton
          active
          paragraph={{ rows: isDetail ? Math.max(rows, 6) : rows, width: visibleRows }}
          title={{ width: isDetail ? "44%" : "32%" }}
        />
      )}
    </section>
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
  width = "min(1120px, calc(100vw - 32px))",
  children,
  onClose,
}: {
  ariaLabel: string;
  className?: string;
  width?: number | string;
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
      width={width}
    >
      <section aria-label={ariaLabel} className={`modal-shell ${className}`.trim()} data-ui="modal" ref={shellRef}>
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
  itemLabel = "条",
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
  onPageSize?: (pageSize: number) => void;
  itemLabel?: string;
}) {
  return (
    <Flex align="center" className="pager" justify="space-between" role="navigation" wrap>
      <Typography.Text type="secondary" aria-label="列表总数">
        共 {total} {itemLabel}
      </Typography.Text>
      <div className="pager-scroll">
        <Pagination
          aria-label="列表分页"
          current={page}
          pageSize={pageSize || Math.max(1, Math.ceil(total / Math.max(pages, 1)))}
          pageSizeOptions={[5, 10, 20, 50, 100]}
          showSizeChanger={pageSize && onPageSize ? { "aria-label": "每页显示条数" } : false}
          total={total}
          onChange={(nextPage, nextPageSize) => {
            if (nextPageSize !== pageSize && onPageSize) onPageSize(nextPageSize);
            else onPage(nextPage);
          }}
        />
      </div>
    </Flex>
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
