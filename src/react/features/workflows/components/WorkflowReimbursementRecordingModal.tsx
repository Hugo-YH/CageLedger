import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { formatPersonNames } from "../../../../domain/personNames";
import { Alert, Button, Flex, Form, Typography } from "antd";
import { Modal } from "../../../components/ui/Modal";
import { useRef, useState } from "react";

import { unverifiedFundingBookNos } from "../../../../domain/fundingBookNo";
import { defaultReimbursementFormNo } from "../../../../domain/reimbursementFormNo";
import type { BillingWorkflow, BillingWorkflowAttachment } from "../../../api/workflows";
import {
  recordWorkflowReimbursement,
  uploadWorkflowAttachment,
  useWorkflowFundingBookOptions,
} from "../../../api/workflows";
import { FundingBookConfirmationModal } from "./FundingBookConfirmationModal";
import { validateAndFocus } from "../../../utils/validateAndFocus";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";
import { WorkflowScanUpload } from "./WorkflowScanUpload";
import { ReimbursementFormFields } from "./ReimbursementFormFields";

interface RecordingValues {
  reimbursementForms?: Array<{ formNo: string; amount?: number; fundingBookNo?: string }>;
}

export function WorkflowReimbursementRecordingModal({
  target,
  onCancel,
  onRecorded,
}: {
  target: BillingWorkflow | null;
  onCancel: () => void;
  onRecorded: () => void;
}) {
  const [pendingId, setPendingId] = useState("");
  // Block close events immediately, before React commits the busy appearance.
  const pendingIdRef = useRef("");
  const pending = Boolean(target && pendingId === target.id);
  function pendingChanged(id: string, value: boolean) {
    if (!value && pendingIdRef.current !== id) return;
    pendingIdRef.current = value ? id : "";
    setPendingId(pendingIdRef.current);
  }
  function cancel() {
    if (target && pendingIdRef.current === target.id) return;
    onCancel();
  }
  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={Boolean(target)}
      rootClassName="app-modal-root workflow-reimbursement-recording-modal"
      title={`补录报销单 · ${target?.month ?? ""} ${formatPersonNames(target?.pi)}`}
      width={640}
      closable={pending ? { disabled: true } : true}
      keyboard={!pending}
      mask={{ closable: !pending }}
      onCancel={cancel}
    >
      {target ? (
        <WorkflowReimbursementRecordingForm
          key={target.id}
          target={target}
          onCancel={cancel}
          onRecorded={onRecorded}
          onPendingChange={(value) => pendingChanged(target.id, value)}
        />
      ) : null}
    </Modal>
  );
}

function WorkflowReimbursementRecordingForm({
  target,
  onCancel,
  onRecorded,
  onPendingChange,
}: {
  target: BillingWorkflow;
  onCancel: () => void;
  onRecorded: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const feedback = useOperationFeedback();
  const [form] = Form.useForm<RecordingValues>();
  const [attachment, setAttachment] = useState<BillingWorkflowAttachment | null>(null);
  const save = useAsyncFormAction("补录报销单失败，请重试");
  const upload = useAsyncFormAction("扫描件上传失败，请重试");
  const operationPending = useRef(false);
  const [unverifiedFundingBookNumbers, setUnverifiedFundingBookNumbers] = useState<string[]>([]);
  const fundingBookOptions = useWorkflowFundingBookOptions(target?.id ?? "");
  const fundingOptions = fundingBookOptions.data?.items ?? [];

  async function runOperation(action: () => Promise<void>) {
    if (operationPending.current) return;
    operationPending.current = true;
    onPendingChange(true);
    try {
      await action();
    } finally {
      operationPending.current = false;
      onPendingChange(false);
    }
  }

  async function submit(confirmed = false) {
    await runOperation(() =>
      save.run(
        async () => {
          const values = await validateAndFocus(form);
          const forms = (values.reimbursementForms || []).filter((entry) => entry.formNo.trim());
          if (!forms.length) {
            throw new Error("请填写报销单号和金额");
          }
          const unverified = fundingBookOptions.data
            ? unverifiedFundingBookNos(
                forms.map((entry) => entry.fundingBookNo),
                fundingBookOptions.data.piFundingBookNos,
              )
            : [];
          if (!confirmed && unverified.length) {
            setUnverifiedFundingBookNumbers(unverified);
            return;
          }
          setUnverifiedFundingBookNumbers([]);
          await recordWorkflowReimbursement(
            target.id,
            forms.map((entry) => ({
              formNo: entry.formNo,
              amount: Number(entry.amount) || 0,
              fundingBookNo: entry.fundingBookNo?.trim() || "",
            })),
          );
          return true;
        },
        (recorded) => {
          if (recorded) {
            feedback.success("报销单补录已保存", `${target.month} · ${formatPersonNames(target.pi)}`);
            onRecorded();
          }
        },
      ),
    );
  }

  async function handleUpload(file: File) {
    let result: BillingWorkflowAttachment | undefined;
    await runOperation(() =>
      upload.run(
        () => uploadWorkflowAttachment(target.id, "reimbursement", file),
        (uploaded) => {
          result = uploaded;
          setAttachment(uploaded ?? null);
          feedback.success("报销单扫描件已上传", uploaded?.originalName || file.name);
        },
      ),
    );
    return result;
  }

  return (
    <>
      {target?.reimbursementForms?.length ? (
        <Typography.Paragraph type="secondary">
          已登记报销单：{target.reimbursementForms.map((entry) => entry.formNo).join("、")}
        </Typography.Paragraph>
      ) : null}
      {fundingBookOptions.isError ? (
        <Alert
          showIcon
          style={{ marginTop: 8 }}
          title="无法读取最新版实验申请汇总表；可手动填写经费本编号。"
          type="warning"
          action={
            <Button loading={fundingBookOptions.isFetching} onClick={() => void fundingBookOptions.refetch()}>
              重试读取
            </Button>
          }
        />
      ) : null}
      {save.error || upload.error ? (
        <Alert role="alert" showIcon style={{ marginBottom: 12 }} title={save.error || upload.error} type="error" />
      ) : null}
      <Form
        name={`workflow-recording-${target.id}`}
        form={form}
        disabled={save.pending || upload.pending}
        initialValues={{
          reimbursementForms: [{ formNo: defaultReimbursementFormNo(), amount: undefined, fundingBookNo: "" }],
        }}
        layout="vertical"
        onSubmitCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void submit();
        }}
      >
        <ReimbursementFormFields options={fundingOptions} loading={fundingBookOptions.isLoading} />
        <Form.Item label="报销单扫描件">
          <WorkflowScanUpload
            attachment={attachment}
            disabled={save.pending || upload.pending}
            pending={upload.pending}
            onUpload={handleUpload}
          />
        </Form.Item>
      </Form>
      <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
        <Button disabled={save.pending || upload.pending} onClick={onCancel}>
          取消
        </Button>
        <Button disabled={upload.pending} loading={save.pending} type="primary" onClick={() => void submit()}>
          保存补录
        </Button>
      </Flex>
      <FundingBookConfirmationModal
        otherProjectFundingBooks={[]}
        pending={save.pending}
        pi={target?.pi ?? ""}
        unknownFundingBookNos={unverifiedFundingBookNumbers}
        onCancel={() => setUnverifiedFundingBookNumbers([])}
        onConfirm={() => void submit(true)}
      />
    </>
  );
}
