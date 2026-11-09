import { Skeleton } from "antd";
import { useMediaQuery } from "../hooks/useMediaQuery";

type PageSkeletonVariant = "page" | "table" | "detail" | "form";

const skeletonRows = ["92%", "100%", "84%", "96%", "72%", "90%"];

/** Lightweight first-load placeholder that keeps the workspace shell bundle small. */
export function PageSkeleton({
  label = "页面内容",
  variant = "page",
  rows = 5,
  compact = false,
  embedded = false,
}: {
  label?: string;
  variant?: PageSkeletonVariant;
  rows?: number;
  compact?: boolean;
  /** Use inside an existing Card, Modal, or panel to avoid duplicate chrome. */
  embedded?: boolean;
}) {
  const active = !useMediaQuery("(prefers-reduced-motion: reduce)");
  const visibleRows = skeletonRows.slice(0, Math.max(1, Math.min(rows, skeletonRows.length)));
  const isTable = variant === "table";
  const isDetail = variant === "detail";
  const tableRows = Math.min(12, Math.max(1, compact ? rows : Math.max(rows, 10)));

  return (
    <section
      aria-busy="true"
      aria-label={`${label}正在加载`}
      aria-live="polite"
      className={`page-skeleton page-skeleton-${variant}${compact ? " is-compact" : ""}${embedded ? " is-embedded" : ""}`}
      data-ui="page-skeleton"
      role="status"
    >
      <span className="app-visually-hidden">{label}正在加载</span>
      {embedded ? null : <PageSkeletonHeading active={active} variant={variant} />}
      {isTable ? (
        <div className="page-skeleton-table" aria-hidden="true">
          <div className="page-skeleton-table-head">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton.Input active={active} block key={index} size="small" />
            ))}
          </div>
          {Array.from({ length: tableRows }, (_, index) => (
            <div className="page-skeleton-table-row" key={index}>
              {Array.from({ length: 4 }, (_, cellIndex) => (
                <Skeleton.Input active={active} block key={cellIndex} size="small" />
              ))}
            </div>
          ))}
        </div>
      ) : variant === "form" ? (
        <div aria-hidden="true" className="page-skeleton-form-grid">
          {Array.from({ length: Math.max(rows, 6) }, (_, index) => (
            <div className="page-skeleton-form-field" key={index}>
              <Skeleton.Input active={active} size="small" />
              <Skeleton.Input active={active} block size="medium" />
            </div>
          ))}
        </div>
      ) : isDetail ? (
        <div aria-hidden="true" className="page-skeleton-detail-grid">
          {Array.from({ length: Math.max(rows, 4) }, (_, index) => (
            <div className="page-skeleton-detail-item" key={index}>
              <Skeleton.Input active={active} size="small" />
              <Skeleton.Input active={active} block size="medium" />
            </div>
          ))}
        </div>
      ) : (
        <Skeleton active={active} paragraph={{ rows, width: visibleRows }} title={{ width: "32%" }} />
      )}
    </section>
  );
}

function PageSkeletonHeading({ variant, active }: { variant: PageSkeletonVariant; active: boolean }) {
  const isTable = variant === "table";
  return (
    <div className={`page-skeleton-heading${isTable ? " page-skeleton-toolbar" : ""}`} aria-hidden="true">
      <Skeleton.Input active={active} block size="large" />
      {isTable ? (
        <div className="page-skeleton-heading-actions">
          <Skeleton.Button active={active} size="small" />
          <Skeleton.Button active={active} size="small" />
          <Skeleton.Button active={active} size="small" />
        </div>
      ) : (
        <Skeleton.Button active={active} size="medium" />
      )}
    </div>
  );
}
