import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import { settlementCandidateScope } from "../../../../domain/settlementCandidateScope";
import { buildSettlementNoticeEmail, type SettlementNoticeEmail } from "../../../../domain/settlementNotice";
import type { BillingStatementResponse, SessionUser, SettlementCandidate } from "../../../api/contracts";
import { usePreviewSettlementNotice, useSettlementActions } from "../../../api/settlements";
import { useAdvanceWorkflow } from "../../../api/workflows";
import { ModalPresence } from "../../../components/ui";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
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
    sourceVersions: Record<string, string>;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const feedback = useOperationFeedback();
  const [previewError, setPreviewError] = useState("");
  const [activeId, setActiveId] = useState("");
  const { preview, initiate } = useSettlementActions();
  const noticePreview = usePreviewSettlementNotice();
  const [previewPending, setPreviewPending] = useState(false);
  const isPending = previewPending || initiate.isPending;
  const advance = useAdvanceWorkflow();
  const request = useLatestRequest();
  const generating = useRef<{ controller?: AbortController } | null>(null);
  const returnToPreview = useRef<SettlementCandidate | null>(null);
  const mounted = useRef(true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocusAfterClose = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generating.current?.controller?.abort();
    };
  }, []);

  const previewStatement = preview.mutateAsync;
  const initiateStatement = initiate.mutateAsync;

  const generateFor = useCallback(
    async (
      candidate: SettlementCandidate,
      persist: boolean,
      sourceVersions?: Record<string, string>,
    ): Promise<boolean> => {
      if (generating.current) return false;
      const operation = { controller: persist ? undefined : new AbortController() };
      generating.current = operation;
      setPreviewPending(!persist);
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
              sourceVersions,
            })
          : await previewStatement({ ...target, signal: operation.controller?.signal });
        if (!isCurrent()) return false;
        setSelected(candidate);
        setResult(response);
        if (persist) feedback.success("结算流程已发起", `${candidate.pi} · ${candidate.month}，可到单据跟踪继续处理。`);
        setNotice("");
        return true;
      } catch (error) {
        if (isCurrent()) {
          const message = error instanceof Error ? error.message : "生成结算单失败";
          if (!persist) setPreviewError(message);
          if (persist) setNotice(message);
        }
        return false;
      } finally {
        if (generating.current === operation) {
          generating.current = null;
          if (mounted.current) {
            setPreviewPending(false);
            setActiveId("");
          }
        }
      }
    },
    [initiateStatement, previewStatement, request, feedback, source],
  );

  async function prepareNoticeEmail(candidate: SettlementCandidate) {
    if (generating.current) return;
    returnToPreview.current = null;
    const operation = { controller: new AbortController() };
    generating.current = operation;
    setPreviewPending(true);
    setActiveId(candidate.id);
    const isCurrent = request.begin();
    try {
      const response = await noticePreview.mutateAsync({
        ...settlementCandidateScope(candidate, source),
        signal: operation.controller.signal,
      });
      if (!isCurrent()) return;
      setNoticeEmail({
        candidate,
        sourceVersions: { ...response.sourceVersions },
        email: buildSettlementNoticeEmail({
          feeType: candidate.feeType,
          pi: response.statement.pi,
          month: response.statement.month,
          totalAmount: response.statement.totalAmount,
          staffName: user.displayName,
          staffPhone: user.phone,
        }),
      });
      setNotice("");
    } catch (error) {
      if (isCurrent()) setPreviewError(error instanceof Error ? error.message : "生成结算单失败");
    } finally {
      if (generating.current === operation) {
        generating.current = null;
        if (mounted.current) {
          setPreviewPending(false);
          setActiveId("");
        }
      }
    }
  }

  async function confirmNoticeEmail() {
    if (!noticeEmail) return;
    const reviewed = noticeEmail;
    const ok = await generateFor(reviewed.candidate, true, reviewed.sourceVersions);
    const returning = returnToPreview.current;
    if (returning) {
      returnToPreview.current = null;
      if (mounted.current) await generateFor(returning, false);
      return;
    }
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
    feedback.success("结算流程已撤回", `${candidate.pi} · ${candidate.month}，可重新发起结算。`);
  }

  async function exportSelected(candidate: SettlementCandidate) {
    setNotice("");
    try {
      await exportPdf({ kind: "billing_statement", items: [settlementCandidateScope(candidate, source)] });
    } catch {
      // The shared PDF task owns the result.
    }
  }

  function close() {
    returnToPreview.current = null;
    restoreFocusAfterClose.current = true;
    request.invalidate();
    if (generating.current?.controller) {
      generating.current.controller.abort();
      generating.current = null;
      setPreviewPending(false);
      setActiveId("");
    }
    setSelected(null);
    setResult(null);
    setNoticeEmail(null);
    setPreviewError("");
  }

  function cancelNoticeEmail() {
    if (!noticeEmail) return;
    const candidate = noticeEmail.candidate;
    request.invalidate();
    setNoticeEmail(null);
    if (generating.current) {
      // A submitted write keeps its ownership; refresh only when it has settled.
      returnToPreview.current = candidate;
      setResult(null);
      return;
    }
    void generateFor(candidate, false);
  }

  function restoreFocus() {
    if (!restoreFocusAfterClose.current) return;
    restoreFocusAfterClose.current = false;
    const trigger = returnFocus.current;
    returnFocus.current = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  const controller = useMemo(
    () => ({
      pending: isPending,
      previewingId: isPending ? activeId : "",
      open: (candidate: SettlementCandidate, trigger?: HTMLElement) => {
        if (trigger?.isConnected) returnFocus.current = trigger;
        void generateFor(candidate, false);
      },
    }),
    [activeId, generateFor, isPending],
  );

  return (
    <SettlementPreviewContext.Provider value={controller}>
      {children}
      <ModalPresence>
        {noticeEmail ? (
          <SettlementNoticeModal
            key={`notice:${noticeEmail.candidate.id}`}
            email={noticeEmail.email}
            error={notice}
            pending={isPending}
            onCancel={cancelNoticeEmail}
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
            pdfExporting={pdfExporting}
            result={result}
            selected={selected}
            onClose={close}
            afterClose={restoreFocus}
            onExportPdf={() => void exportSelected(selected)}
            onRevert={(note) => revertFor(selected, note)}
            onStartSettlement={() => void prepareNoticeEmail(selected)}
          />
        ) : null}
      </ModalPresence>
    </SettlementPreviewContext.Provider>
  );
}
