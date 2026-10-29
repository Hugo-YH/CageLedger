import { formatPersonNames } from "../../../../domain/personNames";
import { Button, Tooltip, type GetRef } from "antd";
import { createContext, useContext, useLayoutEffect, useRef, type PropsWithChildren } from "react";

import type { IntakeBatch } from "../../../api/contracts";
import { useCopyProjectPeople } from "../hooks/useCopyProjectPeople";

const CopyProjectPeopleContext = createContext<ReturnType<typeof useCopyProjectPeople> | null>(null);

export function ProjectPeopleCopyProvider({ children }: PropsWithChildren) {
  const controller = useCopyProjectPeople();
  // Keep the table as stable children: progress updates only its name-cell consumers.
  return <CopyProjectPeopleContext.Provider value={controller}>{children}</CopyProjectPeopleContext.Provider>;
}

export function ProjectPeopleCopyButton({
  item,
  disabled = false,
}: {
  item: Pick<IntakeBatch, "id" | "iacuc" | "owner">;
  disabled?: boolean;
}) {
  const controller = useContext(CopyProjectPeopleContext);
  const tooltip = useRef<GetRef<typeof Tooltip>>(null);
  useLayoutEffect(() => {
    // Selection feedback can move the active row without resizing its button.
    if (controller?.copyingId === item.id) tooltip.current?.forceAlign();
  });
  if (!controller) throw new Error("ProjectPeopleCopyButton requires ProjectPeopleCopyProvider");
  const { copy, copyingId, phase } = controller;
  const text = item.owner == null || item.owner === "" ? "-" : formatPersonNames(item.owner);
  const pending = Boolean(copyingId) && copyingId === item.id;
  const status = pending ? (phase === "querying" ? "查询中…" : "复制中…") : "";

  return (
    <>
      <Tooltip
        ref={tooltip}
        title={status || "按项目汇总表复制：项目负责人组实验负责人"}
        open={pending ? true : undefined}
      >
        <Button
          type="link"
          className="intake-project-people-copy"
          aria-label={`复制项目负责人和实验负责人：${text}`}
          loading={pending}
          disabled={disabled || Boolean(copyingId)}
          onClick={() => void copy(item)}
        >
          <span className="table-cell-text">{text}</span>
        </Button>
      </Tooltip>
      <span className="app-visually-hidden" role="status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
