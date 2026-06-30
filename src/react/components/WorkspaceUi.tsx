import { type ReactNode, useEffect, useRef } from "react";

export function WorkspaceHeader({
  kicker,
  title,
  summary,
  status,
  metrics,
  actions,
}: {
  kicker: string;
  title: string;
  summary: string;
  status?: string;
  metrics?: Array<{ label: string; value: ReactNode; tone?: "success" | "warning" | "todo" }>;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-head">
      <div className="workspace-head-main">
        <span className="workspace-kicker">{kicker}</span>
        <div className="workspace-title-line">
          <h1>{title}</h1>
          {status ? <span className="workspace-status-badge">{status}</span> : null}
        </div>
        <p className="workspace-summary">{summary}</p>
        {metrics?.length ? (
          <div className="workspace-meta-strip">
            {metrics.map((metric) => (
              <div className={`workspace-meta-card ${metric.tone || ""}`} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? <div className="workspace-head-actions">{actions}</div> : null}
    </header>
  );
}

export function PageState({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {detail ? <p>{detail}</p> : null}
      {retry ? (
        <button className="secondary" type="button" onClick={retry}>
          重新加载
        </button>
      ) : null}
    </div>
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
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) || []).filter(
        (element) => element.getClientRects().length > 0,
      );

    document.body.style.overflow = "hidden";
    const focusable = getFocusable();
    (focusable[0] || dialog)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const currentFocusable = getFocusable();
      if (!currentFocusable.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog?.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog?.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className={`modal-shell ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
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
      </div>
      <div className="modal-shell-body">
        <p>{message}</p>
      </div>
      <div className="modal-shell-actions">
        <button className="secondary" type="button" onClick={onCancel}>
          取消
        </button>
        <button className={danger ? "danger" : "primary"} type="button" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <div>
        <button className="secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <button className="secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          下一页
        </button>
      </div>
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
