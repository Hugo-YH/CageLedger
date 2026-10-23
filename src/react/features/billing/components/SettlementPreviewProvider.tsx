import { Alert } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import { settlementCandidateScope } from "../../../../domain/settlementCandidateScope";
import { buildSettlementNoticeEmail, type SettlementNoticeEmail } from "../../../../domain/settlementNotice";
import type { BillingStatementResponse, SessionUser, SettlementCandidate } from "../../../api/contracts";
import { useSettlementActions } from "../../../api/settlements";
import { useAdvanceWorkflow } from "../../../api/workflows";
import { ModalPresence } from "../../../components/ui";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import type { usePdfExport } from "../hooks/usePdfExport";
import { SettlementNoticeModal } from "./SettlementNoticeModal";
import { SettlementPreviewModal } from "./SettlementPreviewModal";
import { canWithdrawCandidate, SettlementPreviewContext } from "./settlementPreviewContext";

export function SettlementPreviewProvider({
  source,
  user,
  exportPdf,
  pdfExporting,
  children,
}: PropsWithChildren<{
  source: "quantity_sheet" | "cage_map";
  user: SessionUser;
  exportPdf: ReturnType<typeof usePdfExport>["exportPdf"];
  pdfExporting: boolean;
}>) {
  const [selected, setSelected] = useState<SettlementCandidate | null>(null);
  const [result, setResult] = useState<BillingStatementResponse | null>(null);
  const [noticeEmail, setNoticeEmail] = useState<{
    candidate: SettlementCandidate;
    email: SettlementNoticeEmail;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error" | "info">("info");
  const [previewError, setPreviewError] = useState("");
  const [activeId, setActiveId] = useState("");
  const { preview, initiate, isPending } = useSettlementActions();
  const advance = useAdvanceWorkflow();
  const request = useLatestRequest();
  const generating = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const showNotice = useCallback((message: string, kind: "success" | "error" | "info" = "info") => {
    setNotice(message);
    setNoticeKind(kind);
  }, []);
  const previewStatement = preview.mutateAsync;
  const initiateStatement = initiate.mutateAsync;

  const generateFor = useCallback(
    async (candidate: SettlementCandidate, persist: boolean): Promise<boolean> => {
      if (generating.current) return false;
      generating.current = true;
      setActiveId(candidate.id);
      const isCurrent = request.begin();
      if (!persist) {
        setSelected(candidate);
        setResult(null);
        setPreviewError("");
        setNotice("");
      }
      try {
        const target = settlementCandidateScope(candidate, source);
        const response = persist
          ? await initiateStatement({
              ...target,
              sourceVersions: selected?.id === candidate.id ? result?.sourceVersions : undefined,
            })
          : await previewStatement(target);
        if (!isCurrent()) return false;
        setSelected(candidate);
        setResult(response);
        showNotice(persist ? "结算流程已发起，可到单据跟踪继续处理。" : "结算预览已生成。", "success");
        return true;
      } catch (error) {
        if (isCurrent()) {
          const message = error instanceof Error ? error.message : "生成结算单失败";
          if (!persist) setPreviewError(message);
          showNotice(message, "error");
        }
        return false;
      } finally {
        generating.current = false;
        if (mounted.current) setActiveId("");
      }
    },
    [initiateStatement, previewStatement, request, result, selected, showNotice, source],
  );

  async function prepareNoticeEmail(candidate: SettlementCandidate) {
    if (generating.current) return;
    generating.current = true;
    setActiveId(candidate.id);
    const isCurrent = request.begin();
    try {
      const response = await preview.mutateAsync(settlementCandidateScope(candidate, source));
      if (!isCurrent()) return;
      setSelected(candidate);
      setResult(response);
      if (!response.statement) return;
      setNoticeEmail({
        candidate,
        email: buildSettlementNoticeEmail({
          feeType: candidate.feeType,
          pi: response.statement.pi,
          month: response.statement.month,
          totalAmount: response.statement.totalAmount,
          staffName: user.displayName,
          staffPhone: user.phone,
        }),
      });
      showNotice("请复制通知邮件并确认发起结算流程。", "info");
    } catch (error) {
      if (isCurrent()) showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
    } finally {
      generating.current = false;
      if (mounted.current) setActiveId("");
    }
  }

  async function confirmNoticeEmail() {
    if (!noticeEmail) return;
    const ok = await generateFor(noticeEmail.candidate, true);
    if (ok) {
      setNoticeEmail(null);
      setSelected((current) =>
        current ? { ...current, hasWorkflow: true, workflowStatus: "statement_sent" } : current,
      );
    }
  }

  async function revertFor(candidate: SettlementCandidate, note: string) {
    if (!candidate.workflowId) return;
    await advance.mutateAsync({ workflowId: candidate.workflowId, toStatus: "statement_generated", note });
    setSelected(null);
    setResult(null);
    showNotice(`${candidate.pi} ${candidate.month} 的结算流程已撤回，退回已生成状态。`, "success");
  }

  async function exportSelected(candidate: SettlementCandidate) {
    setNotice("");
    try {
      await exportPdf({ kind: "billing_statement", items: [settlementCandidateScope(candidate, source)] });
    } catch (error) {
      if (mounted.current) showNotice(error instanceof Error ? error.message : "PDF 导出失败", "error");
    }
  }

  function close() {
    request.invalidate();
    setSelected(null);
    setResult(null);
    setNoticeEmail(null);
    setPreviewError("");
  }

  const controller = useMemo(
    () => ({
      pending: isPending,
      previewingId: isPending ? activeId : "",
      open: (candidate: SettlementCandidate) => void generateFor(candidate, false),
    }),
    [activeId, generateFor, isPending],
  );

  return (
    <SettlementPreviewContext.Provider value={controller}>
      {notice ? (
        <Alert role={noticeKind === "error" ? "alert" : "status"} showIcon title={notice} type={noticeKind} />
      ) : null}
      {children}
      <ModalPresence>
        {noticeEmail ? (
          <SettlementNoticeModal
            key={`notice:${noticeEmail.candidate.id}`}
            email={noticeEmail.email}
            pending={isPending}
            onCancel={() => {
              request.invalidate();
              setNoticeEmail(null);
            }}
            onConfirm={() => void confirmNoticeEmail()}
          />
        ) : selected ? (
          <SettlementPreviewModal
            key={`preview:${selected.id}`}
            generatePending={isPending}
            loading={!result && !previewError}
            error={previewError}
            onRetry={() => void generateFor(selected, false)}
            hasWorkflow={Boolean(selected.hasWorkflow)}
            revertPending={advance.isPending}
            canWithdraw={canWithdrawCandidate(selected, user)}
            workflowStatus={selected.workflowStatus}
            notice={notice}
            noticeKind={noticeKind}
            pdfExporting={pdfExporting}
            result={result}
            selected={selected}
            onClose={close}
            onExportPdf={() => void exportSelected(selected)}
            onRevert={(note) => revertFor(selected, note)}
            onStartSettlement={() => void prepareNoticeEmail(selected)}
          />
        ) : null}
      </ModalPresence>
    </SettlementPreviewContext.Provider>
  );
}
