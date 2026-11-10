import { useOperationFeedback } from "../../hooks/useOperationFeedback";
import { Alert, App, Button, Empty, Flex, Form, Image, Radio, Select, Space, Spin, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";

import type {
  ReceptionCertificateAttachment,
  ReceptionCertificateLine,
  ReceptionRecognitionRequest,
  ReceptionRecognitionRun,
  ReceptionRecord,
  ReceptionRegistrationResponse,
  ReceptionRegistrationSaveRequest,
} from "../../../contracts/reception";
import {
  useReceptionRegistration,
  useRecognizeReceptionCertificate,
  useSaveReceptionRegistration,
  useUploadReceptionCertificate,
} from "../../api/reception";
import { queryKeys } from "../../api/queryKeys";
import { ActionIcon, EmptyState, HelpPopover, Modal } from "../../components/ui";
import { formatDateTime, PageSkeleton, PageState } from "../../components/WorkspaceUi";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { DialogActivityContext } from "../../state/dialogActivity";
import { CertificateGroupEditors } from "./CertificateGroupEditors";
import { ReceptionCertificateReview } from "./ReceptionCertificateReview";
import {
  certificateDifferences,
  certificateErrorMessage as errorMessage,
  certificateFileError,
  certificateLineErrors,
  certificateMultipleFilesError,
  certificateUploadAccept,
  hasStaleCertificateSource,
  mergeCertificateReviewWarnings,
  newCertificateLine,
} from "./certificateDraft";

export function ReceptionCertificateDrawer({
  record,
  initialFile,
  onClose,
  onSaved,
}: {
  record: ReceptionRecord;
  initialFile?: File;
  onClose: () => void;
  onSaved: () => void;
}) {
  const active = useContext(DialogActivityContext);
  const query = useReceptionRegistration(record.batchId, active);
  const queryClient = useQueryClient();
  const upload = useUploadReceptionCertificate(record.batchId);
  const recognize = useRecognizeReceptionCertificate(record.batchId);
  const save = useSaveReceptionRegistration(record.batchId);
  const { modal } = App.useApp();
  const feedback = useOperationFeedback();
  const [snapshot, setSnapshot] = useState<ReceptionRegistrationResponse | null>(null);
  const [lines, setLines] = useState<ReceptionCertificateLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [attachmentId, setAttachmentId] = useState("");
  const [pendingRun, setPendingRun] = useState<ReceptionRecognitionRun | null>(null);
  const [error, setError] = useState("");
  const [retryRecognitionId, setRetryRecognitionId] = useState("");
  const [recognitionModes, setRecognitionModes] = useState<Record<string, "auto" | "all">>({});
  const recognitionRequests = useRef(new Map<string, ReceptionRecognitionRequest>());
  const saveRequest = useRef<{ serialized: string; request: ReceptionRegistrationSaveRequest } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const initialUploadStarted = useRef(false);
  const [phase, setPhase] = useState<"upload" | "recognize" | null>(null);
  const { begin, invalidate } = useLatestRequest();
  const pending = Boolean(phase) || save.isPending;
  const confirmLeave = useUnsavedChanges(dirty, upload.isPending || save.isPending);

  useEffect(() => {
    if (!active || snapshot || !query.data) return;
    setSnapshot(query.data);
    const savedLines = query.data.registration?.lines;
    const previousResults = query.data.attachments.flatMap((item) => {
      const run = query.data.runs.find((candidate) => candidate.attachmentId === item.id);
      return run?.status === "completed" ? (run.result?.lines ?? []) : [];
    });
    setLines((savedLines ?? previousResults).map((line) => ({ ...line })));
    setDirty(!savedLines && previousResults.length > 0);
    setAttachmentId(query.data.attachments[0]?.id ?? "");
  }, [active, query.data, snapshot]);

  const detail = query.data ?? snapshot;
  const attachments = detail?.attachments ?? [];
  const attachment = attachments.find((item) => item.id === attachmentId) ?? attachments[0];
  const attachmentIds = new Set(attachments.map((item) => item.id));
  const canWrite = Boolean(detail?.canWrite);
  const sourceChanged = Boolean(
    detail &&
    snapshot &&
    (detail.batch.updatedAt !== snapshot.batch.updatedAt ||
      detail.applicationVersion !== snapshot.applicationVersion ||
      (detail.registration?.updatedAt ?? null) !== (snapshot.registration?.updatedAt ?? null)),
  );
  const writable = canWrite && !sourceChanged && !save.isPending;
  const warnings = mergeCertificateReviewWarnings(certificateDifferences(lines, detail?.batch ?? record), [
    ...(pendingRun?.result?.warnings ?? []),
    ...(detail?.runs
      .filter((run) => lines.some((line) => line.runId === run.id))
      .flatMap((run) => run.result?.warnings ?? []) ?? []),
    ...(snapshot?.registration?.warnings ?? []),
    ...(detail?.batch.warnings ?? []),
  ]);
  const lineErrors = lines.map((line) => certificateLineErrors(line, attachmentIds));
  const currentRuns = (detail?.runs ?? []).filter((run) => run.attachmentId === attachment?.id);
  const latestRun = pendingRun?.attachmentId === attachment?.id ? pendingRun : currentRuns[0];
  const pageSelection = latestRun?.result?.pageSelection;
  const recognitionMode = recognitionModes[attachment?.id ?? ""] ?? pageSelection?.mode ?? "auto";

  function changeLines(next: ReceptionCertificateLine[]) {
    setLines(next);
    setDirty(true);
    setError("");
  }

  async function close() {
    if (await confirmLeave()) {
      invalidate();
      onClose();
    }
  }

  async function recognizeAttachment(
    target: ReceptionCertificateAttachment,
    isCurrent: () => boolean,
    mode: "auto" | "all",
    { retry = false, deferRegistrationRefresh = false } = {},
  ) {
    if (!snapshot) return;
    if (lines.some((line) => line.attachmentId === target.id)) {
      const confirmed = await modal.confirm({
        title: "替换本附件的编辑明细？",
        content:
          "识别成功后会替换本附件已有的人工编辑与已保存明细，其他附件的明细会保留。原件保留，核对并保存后才更新登记。",
        okText: "重新识别并替换",
        cancelText: "保留当前明细",
      });
      if (!confirmed || !isCurrent()) return;
    }
    const previousRequest = recognitionRequests.current.get(target.id);
    const request =
      retry && previousRequest?.includeAllPages === (mode === "all")
        ? previousRequest
        : {
            requestId: crypto.randomUUID(),
            expectedBatchUpdatedAt: snapshot.batch.updatedAt,
            includeAllPages: mode === "all",
          };
    recognitionRequests.current.set(target.id, request);
    setRecognitionModes((current) => ({ ...current, [target.id]: mode }));
    setRetryRecognitionId("");
    setPhase("recognize");
    try {
      const { run } = await recognize.mutateAsync({
        attachmentId: target.id,
        ...request,
        deferRegistrationRefresh,
      });
      if (!isCurrent()) return;
      setPendingRun(run);
      if (run.status === "completed" && run.result) {
        const additions = run.result.lines.map((line) => ({ ...line, id: crypto.randomUUID() }));
        if (additions.length) {
          changeLines([...lines.filter((line) => line.attachmentId !== target.id), ...additions]);
          feedback.info("合格证明细已识别", "请对照原件核对明细与预约差异，核对并保存后才更新接收登记。");
        } else setError("未识别到可登记明细，原有草稿已保留。请核对原件后重试或手工填写。");
      } else if (run.status === "failed") {
        setError(run.error || "AI 识别失败，原件和人工草稿已保留，可重试或手工填写。");
      }
    } catch (reason) {
      if (!isCurrent()) return;
      setRetryRecognitionId(target.id);
      setError(errorMessage(reason, "识别请求未完成。原件和草稿已保留，重试会复用本次请求标识。"));
    }
  }

  async function uploadFile(file: File) {
    if (!snapshot || !writable || busy.current) return;
    const fileError = certificateFileError(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    busy.current = true;
    const isCurrent = begin();
    const mode = recognitionMode;
    setError("");
    setPhase("upload");
    let uploaded = false;
    try {
      const result = await upload.mutateAsync({
        file,
        expectedBatchUpdatedAt: snapshot.batch.updatedAt,
        deferRegistrationRefresh: true,
      });
      uploaded = true;
      if (!isCurrent()) return;
      setAttachmentId(result.attachment.id);
      setRecognitionModes((current) => ({ ...current, [result.attachment.id]: mode }));
      setPendingRun(null);
      await recognizeAttachment(result.attachment, isCurrent, mode, { deferRegistrationRefresh: true });
    } catch (reason) {
      if (isCurrent()) setError(errorMessage(reason, "上传失败，请重新选择合格证原件重试。当前登记草稿已保留。"));
    } finally {
      if (uploaded)
        void queryClient.invalidateQueries({ queryKey: queryKeys.receptionRegistration(record.batchId), exact: true });
      busy.current = false;
      if (isCurrent()) setPhase(null);
    }
  }

  const uploadInitialFile = useEffectEvent((file: File) => void uploadFile(file));
  useEffect(() => {
    if (!active || !snapshot || !canWrite || !initialFile || initialUploadStarted.current) return;
    initialUploadStarted.current = true;
    uploadInitialFile(initialFile);
  }, [active, snapshot, canWrite, initialFile]);

  async function runRecognition() {
    if (!attachment || !snapshot || !writable || busy.current) return;
    busy.current = true;
    const isCurrent = begin();
    setError("");
    try {
      await recognizeAttachment(attachment, isCurrent, recognitionMode, {
        retry: retryRecognitionId === attachment.id,
      });
    } finally {
      busy.current = false;
      if (isCurrent()) setPhase(null);
    }
  }

  async function confirmRegistration() {
    if (!snapshot || !writable || busy.current) return;
    setShowErrors(true);
    if (!lines.length || lineErrors.some((errors) => Object.keys(errors).length)) {
      setError(!lines.length ? "请至少加入一条证件明细。" : "请修正标出的明细字段；未知数量不能当作 0 保存。");
      const invalidIndex = lineErrors.findIndex((errors) => Object.keys(errors).length);
      const invalidKey = invalidIndex >= 0 ? Object.keys(lineErrors[invalidIndex])[0] : "";
      document
        .getElementById(
          invalidKey
            ? `reception-certificate-${lines[invalidIndex].id}-${invalidKey}`
            : "reception-certificate-add-line",
        )
        ?.focus();
      return;
    }
    busy.current = true;
    const isCurrent = begin();
    const serialized = JSON.stringify(lines);
    if (saveRequest.current?.serialized !== serialized)
      saveRequest.current = {
        serialized,
        request: {
          requestId: crypto.randomUUID(),
          expectedBatchUpdatedAt: snapshot.batch.updatedAt,
          expectedRegistrationUpdatedAt: snapshot.registration?.updatedAt ?? null,
          expectedApplicationVersion: snapshot.applicationVersion,
          acknowledged: true,
          lines,
        },
      };
    setError("");
    try {
      await save.mutateAsync(saveRequest.current.request);
      if (!isCurrent()) return;
      setDirty(false);
      feedback.success("接收登记已人工确认保存", record.batchNo);
      onSaved();
    } catch (reason) {
      if (isCurrent()) setError(errorMessage(reason, "登记保存失败，原件和编辑草稿已保留，请重试。"));
    } finally {
      busy.current = false;
    }
  }

  return (
    <Modal
      open
      title={`合格证与接收登记 · ${record.batchNo}`}
      aria-label={`合格证与接收登记 · ${record.batchNo}`}
      centered
      width={1180}
      styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}
      rootClassName="reception-workspace reception-certificate-modal"
      onCancel={() => void close()}
      closable={upload.isPending || save.isPending ? { disabled: true } : true}
      keyboard={!upload.isPending && !save.isPending}
      mask={{ closable: !upload.isPending && !save.isPending }}
      footer={
        <Flex gap={12} justify="flex-end" align="center" wrap>
          <Space>
            <Button disabled={upload.isPending || save.isPending} onClick={() => void close()}>
              取消
            </Button>
            {canWrite ? (
              <Button
                type="primary"
                loading={save.isPending}
                disabled={!snapshot || !writable || pending}
                onClick={() => void confirmRegistration()}
              >
                核对并保存
              </Button>
            ) : null}
          </Space>
        </Flex>
      }
    >
      {!detail || !snapshot ? (
        query.isError ? (
          <PageState
            title="合格证详情加载失败"
            detail={errorMessage(query.error, "请重试。接收列表仍可使用。")}
            retry={() => void query.refetch()}
          />
        ) : (
          <PageSkeleton embedded label="合格证详情" variant="detail" />
        )
      ) : (
        <Flex vertical gap={16}>
          <ReceptionCertificateReview
            refreshFailed={query.isError}
            sourceChanged={sourceChanged}
            recognitionSourceChanged={hasStaleCertificateSource(detail, snapshot, lines, pendingRun)}
            canWrite={canWrite}
            warnings={warnings}
            error={error}
            onRetry={() => void query.refetch()}
          />
          <div className="reception-certificate-layout">
            <section className="reception-certificate-original" aria-label="合格证原件">
              <Flex vertical gap={12}>
                <Flex gap={8} wrap justify="space-between" align="center">
                  <Flex gap={4} align="center">
                    <Typography.Title level={5} className="reception-certificate-section-title">
                      合格证原件
                    </Typography.Title>
                    <HelpPopover label="合格证原件说明" icon={<ExclamationCircleOutlined aria-hidden="true" />}>
                      PDF、PNG、JPEG、WebP 每份最大 30 MiB，图片限单帧、2400 万像素。选中后自动上传并识别，
                      原件始终保留。PDF 每次最多识别 20 页，超过时请拆分上传。
                    </HelpPopover>
                  </Flex>
                  <Space wrap role="group" aria-label="合格证原件操作">
                    {canWrite ? (
                      <>
                        <input
                          ref={input}
                          type="file"
                          accept={certificateUploadAccept}
                          aria-label="上传合格证文件"
                          hidden
                          disabled={!writable || pending}
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            if (files.length > 1) {
                              setError(certificateMultipleFilesError);
                              return;
                            }
                            const file = files[0];
                            if (file) void uploadFile(file);
                          }}
                        />
                        <Button
                          icon={<ActionIcon name="upload" />}
                          disabled={!writable || pending}
                          loading={upload.isPending}
                          onClick={() => input.current?.click()}
                        >
                          上传
                        </Button>
                      </>
                    ) : null}
                    {attachment ? (
                      <>
                        <Button
                          href={attachment.fileUrl}
                          download={attachment.name}
                          icon={<ActionIcon name="download" />}
                        >
                          下载
                        </Button>
                        {canWrite ? (
                          <Button
                            icon={<ActionIcon name="scan" />}
                            loading={recognize.isPending}
                            disabled={!writable || pending}
                            onClick={() => void runRecognition()}
                          >
                            识别
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </Space>
                </Flex>
                {canWrite ? (
                  <Flex vertical gap={4}>
                    <Typography.Text>识别范围</Typography.Text>
                    <Radio.Group
                      aria-label="识别范围"
                      value={recognitionMode}
                      options={[
                        { value: "auto", label: "自动筛选合格证页" },
                        { value: "all", label: "全部页面" },
                      ]}
                      disabled={!writable || pending}
                      onChange={(event) => {
                        const mode = event.target.value === "all" ? "all" : "auto";
                        setRecognitionModes((current) => ({
                          ...current,
                          [attachment?.id ?? ""]: mode,
                        }));
                        setRetryRecognitionId("");
                      }}
                    />
                    <Typography.Text type="secondary">
                      自动模式按画幅筛选候选页；若遗漏合格证，可选择全部页面后重新识别。
                    </Typography.Text>
                  </Flex>
                ) : null}
                {attachments.length ? (
                  <Select
                    aria-label="选择合格证原件"
                    value={attachment?.id}
                    options={attachments.map((item) => ({
                      value: item.id,
                      label: `${item.name}（${item.pageCount} 页）`,
                    }))}
                    onChange={(id) => {
                      setAttachmentId(id);
                      setPendingRun(null);
                      setError("");
                    }}
                    disabled={pending}
                  />
                ) : null}
                {attachment ? (
                  <>
                    <Image
                      width="100%"
                      src={attachment.previewUrl}
                      alt={`${attachment.name} 首页原图`}
                      className="reception-certificate-preview"
                      fallback=""
                    />
                    <Typography.Text type="secondary">
                      此处仅预览首页，点击可放大；识别按所选范围处理候选页面，全部页面请下载原件核对。
                    </Typography.Text>
                    {pageSelection ? (
                      <Alert
                        showIcon
                        type="info"
                        title="本次识别页面范围"
                        description={
                          <Flex vertical gap={4}>
                            <span>
                              {pageSelection.mode === "all" ? "全部页面" : "自动筛选合格证页"}；原件共{" "}
                              {pageSelection.totalPages} 页。
                            </span>
                            <span>
                              送识别页码：
                              {pageSelection.selectedPages.length
                                ? `第 ${pageSelection.selectedPages.join("、")} 页`
                                : "无"}
                              。
                            </span>
                            <span>
                              {pageSelection.skippedPhotoPages.length
                                ? `疑似照片跳过页码：第 ${pageSelection.skippedPhotoPages.join("、")} 页。`
                                : "未跳过疑似照片页。"}
                            </span>
                            <span>送识别的候选页不代表所有合格证均已成功识别，请下载原件核对完整性。</span>
                          </Flex>
                        }
                      />
                    ) : attachment.pageCount > 1 && latestRun?.status === "completed" && latestRun.result ? (
                      <Alert
                        showIcon
                        type="warning"
                        title="旧识别结果仅包含首页"
                        description="此多页 PDF 的旧识别结果仅依据首页。建议重新识别，核对后再保存登记。"
                      />
                    ) : null}
                    {latestRun?.status === "failed" && !pendingRun ? (
                      <Alert
                        showIcon
                        type="warning"
                        title="上次识别失败"
                        description={latestRun.error || "可重新识别或手工填写明细。"}
                      />
                    ) : null}
                    {latestRun?.status === "running" && !recognize.isPending ? (
                      <Alert
                        showIcon
                        type="info"
                        title="此原件有进行中的识别记录"
                        action={<Button onClick={() => void query.refetch()}>刷新状态</Button>}
                      />
                    ) : null}
                  </>
                ) : (
                  <Empty description="尚未上传合格证原件" />
                )}
              </Flex>
            </section>
            <section className="reception-certificate-editor" aria-label="独立接收登记编辑区">
              <Flex vertical gap={12}>
                <Flex gap={8} justify="space-between" align="center" wrap>
                  <Flex gap={4} align="center">
                    <Typography.Title level={5} className="reception-certificate-section-title">
                      识别明细
                    </Typography.Title>
                    <HelpPopover label="识别明细说明" icon={<ExclamationCircleOutlined aria-hidden="true" />}>
                      同证同品系、规格的公共信息只填一次；性别和数量分行核对，来源信息可在高级信息中查看。
                    </HelpPopover>
                  </Flex>
                  {canWrite ? (
                    <Button
                      id="reception-certificate-add-line"
                      icon={<ActionIcon name="create" />}
                      disabled={!attachment || !writable || pending}
                      onClick={() => {
                        if (!attachment) return;
                        const current = lines.filter((line) => line.attachmentId === attachment.id);
                        const certificateIndex = Math.max(1, ...current.map((line) => line.certificateIndex));
                        const certificateLineIndex =
                          Math.max(
                            0,
                            ...current
                              .filter((line) => line.certificateIndex === certificateIndex)
                              .map((line) => line.certificateLineIndex),
                          ) + 1;
                        changeLines([
                          ...lines,
                          {
                            ...newCertificateLine(attachment.id, certificateIndex, detail.batch.grade || ""),
                            certificateLineIndex,
                          },
                        ]);
                      }}
                    >
                      添加手工明细
                    </Button>
                  ) : null}
                </Flex>
                {phase ? (
                  <Flex role="status" aria-live="polite" gap={12} align="center">
                    <Spin size="small" />
                    <Typography.Text>
                      {phase === "upload" ? "正在上传合格证原件…" : "正在识别合格证，完成后自动预填…"}
                    </Typography.Text>
                  </Flex>
                ) : null}
                {!lines.length && !phase ? (
                  <EmptyState title="暂无接收登记明细" detail="识别结果或手工补充的登记明细会显示在此处。" />
                ) : null}
                <Form layout="vertical" disabled={!writable || pending}>
                  <Flex vertical gap={12}>
                    <CertificateGroupEditors
                      lines={lines}
                      attachments={attachments.map((item) => ({ value: item.id, label: item.name }))}
                      receipts={detail.batch.receipts ?? []}
                      errors={showErrors ? lineErrors : []}
                      readOnly={!canWrite}
                      onChange={changeLines}
                    />
                  </Flex>
                </Form>
                {snapshot.registration ? (
                  <Typography.Text type="secondary">
                    上次确认：{formatDateTime(snapshot.registration.confirmedAt)} · {snapshot.registration.confirmedBy}
                  </Typography.Text>
                ) : null}
              </Flex>
            </section>
          </div>
        </Flex>
      )}
    </Modal>
  );
}
