import { Skeleton } from "antd";

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
  const visibleRows = skeletonRows.slice(0, Math.max(1, Math.min(rows, skeletonRows.length)));
  const isTable = variant === "table";
  const isDetail = variant === "detail";
  const tableRows = compact ? rows : Math.max(rows, 10);

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
      {embedded ? null : <PageSkeletonHeading variant={variant} />}
      {isTable ? (
        <div className="page-skeleton-table" aria-hidden="true">
          <div className="page-skeleton-table-head">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton.Input active block key={index} size="small" />
            ))}
          </div>
          {Array.from({ length: tableRows }, (_, index) => (
            <div className="page-skeleton-table-row" key={index}>
              {Array.from({ length: 8 }, (_, cellIndex) => (
                <Skeleton.Input active block key={cellIndex} size="small" />
              ))}
            </div>
          ))}
        </div>
      ) : variant === "form" ? (
        <div aria-hidden="true" className="page-skeleton-form-grid">
          {Array.from({ length: Math.max(rows, 6) }, (_, index) => (
            <div className="page-skeleton-form-field" key={index}>
              <Skeleton.Input active size="small" />
              <Skeleton.Input active block size="medium" />
            </div>
          ))}
        </div>
      ) : isDetail ? (
        <div aria-hidden="true" className="page-skeleton-detail-grid">
          {Array.from({ length: Math.max(rows, 4) }, (_, index) => (
            <div className="page-skeleton-detail-item" key={index}>
              <Skeleton.Input active size="small" />
              <Skeleton.Input active block size="medium" />
            </div>
          ))}
        </div>
      ) : (
        <Skeleton active paragraph={{ rows, width: visibleRows }} title={{ width: "32%" }} />
      )}
    </section>
  );
}

function PageSkeletonHeading({ variant }: { variant: PageSkeletonVariant }) {
  const isTable = variant === "table";
  return (
    <div className={`page-skeleton-heading${isTable ? " page-skeleton-toolbar" : ""}`} aria-hidden="true">
      <Skeleton.Input active block size="large" />
      {isTable ? (
        <div className="page-skeleton-heading-actions">
          <Skeleton.Button active size="small" />
          <Skeleton.Button active size="small" />
          <Skeleton.Button active size="small" />
        </div>
      ) : (
        <Skeleton.Button active size="medium" />
      )}
    </div>
  );
}
