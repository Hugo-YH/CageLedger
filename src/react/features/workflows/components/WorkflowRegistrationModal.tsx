import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { formatPersonNames } from "../../../../domain/personNames";
import { Alert, Button, Flex, Form, Input, Space, Switch, Tag } from "antd";
import { Modal } from "../../../components/ui/Modal";
import { useContext, useRef, useState } from "react";
import { tagColors } from "../../../../theme/visual-system.mjs";

import { fundingBookRemark, reviewFundingBookNos, type FundingBookReference } from "../../../../domain/fundingBookNo";
import { defaultReimbursementFormNo } from "../../../../domain/reimbursementFormNo";
import type { BillingWorkflow, BillingWorkflowAttachment } from "../../../api/workflows";
import { uploadWorkflowAttachment, useAdvanceWorkflow, useWorkflowFundingBookOptions } from "../../../api/workflows";
import { FundingBookConfirmationModal } from "./FundingBookConfirmationModal";
import { validateAndFocus } from "../../../utils/validateAndFocus";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";
import { ReimbursementFormFields } from "./ReimbursementFormFields";
import { WorkflowScanUpload } from "./WorkflowScanUpload";
import { DialogActivityContext } from "../../../state/dialogActivity";

interface RegistrationValues {
  reimbursementForms?: Array<{ formNo: string; amount?: number; fundingBookNo?: string }>;
  signedStatementReturned?: boolean;
  signedStatementNote?: string;
  reimbursementFormReturned?: boolean;
  reimbursementFormNote?: string;
}

function registrationInitialValues(target: BillingWorkflow): RegistrationValues {
  const previousForms = (target.reimbursementForms || []).filter((entry) => entry.formNo);
  return {
    signedStatementReturned: Boolean(target.signedStatementReturned),
    signedStatementNote: target.signedStatementNote || "",
    reimbursementFormReturned: Boolean(target.reimbursementFormReturned),
    reimbursementForms: previousForms.length
      ? previousForms.map((entry) => ({
          fundingBookNo: entry.fundingBookNo || "",
          formNo: entry.formNo,
          amount: entry.amount,
        }))
      : [
          {
            formNo: defaultReimbursementFormNo(),
            amount: Number(target.totalAmount || 0) || undefined,
            fundingBookNo: "",
          },
        ],
    reimbursementFormNote: target.reimbursementFormNote || "",
  };
}

function RegistrationSwitch({
  checked,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  label,
  onChange,
  returnedLabel,
  returnedColor,
  unreturnedLabel,
}: {
  checked?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  label: string;
  onChange?: (checked: boolean) => void;
  returnedLabel: string;
  returnedColor: string;
  unreturnedLabel: string;
}) {
  return (
    <Space size={8}>
      <Switch
        id={id}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-label={label}
        checked={checked}
        onChange={onChange}
      />
      <span>{label}</span>
      <Tag color={checked ? returnedColor : tagColors.status.default}>{checked ? returnedLabel : unreturnedLabel}</Tag>
    </Space>
  );
}

export function WorkflowRegistrationModal({
  target,
  onCancel,
  onRegistered,
}: {
  target: BillingWorkflow | null;
  onCancel: () => void;
  onRegistered: () => void;
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
      rootClassName="app-modal-root workflow-registration-modal"
      title={`交回登记 · ${target?.month ?? ""} ${formatPersonNames(target?.pi)}`}
      width={640}
      closable={pending ? { disabled: true } : true}
      keyboard={!pending}
      mask={{ closable: !pending }}
      onCancel={cancel}
    >
      {target ? (
        <WorkflowRegistrationForm
          key={target.id}
          target={target}
          onCancel={cancel}
          onRegistered={onRegistered}
          onPendingChange={(value) => pendingChanged(target.id, value)}
        />
      ) : null}
    </Modal>
  );
}

function WorkflowRegistrationForm({
  target,
  onCancel,
  onRegistered,
  onPendingChange,
}: {
  target: BillingWorkflow;
  onCancel: () => void;
  onRegistered: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const advance = useAdvanceWorkflow();
  const feedback = useOperationFeedback();
  const [form] = Form.useForm<RegistrationValues>();
  const signedStatementReturned = Form.useWatch("signedStatementReturned", form);
  const reimbursementFormReturned = Form.useWatch("reimbursementFormReturned", form);
  const reimbursementForms = Form.useWatch("reimbursementForms", form);
  const [settlementAttachment, setSettlementAttachment] = useState<BillingWorkflowAttachment | null>(null);
  const [reimbursementAttachment, setReimbursementAttachment] = useState<BillingWorkflowAttachment | null>(null);
  const save = useAsyncFormAction("交回登记失败，请重试");
  const upload = useAsyncFormAction("扫描件上传失败，请重试");
  const operationPending = useRef(false);
  const [fundingBookReview, setFundingBookReview] = useState<{
    otherProjectOptions: FundingBookReference[];
    unknownFundingBookNos: string[];
  }>({ otherProjectOptions: [], unknownFundingBookNos: [] });
  const settlementLabel = target.sourceType === "pi_merged_technical_service" ? "技术服务费结算单" : "饲养费结算单";
  const hasPayableAmount = Number(target.totalAmount || 0) > 0;
  const active = useContext(DialogActivityContext);
  const fundingBookOptions = useWorkflowFundingBookOptions(
    target.id,
    active && hasPayableAmount && Boolean(reimbursementFormReturned),
  );
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

  async function submitRegistration(confirmed = false) {
    await runOperation(() =>
      save.run(
        async () => {
          const values = await validateAndFocus(form);
          const reimbursementForms = (values.reimbursementForms || []).filter((entry) => entry.formNo.trim());
          if (values.reimbursementFormReturned && !reimbursementForms.length) return;
          const review = fundingBookOptions.data
            ? reviewFundingBookNos(
                reimbursementForms.map((entry) => entry.fundingBookNo),
                fundingBookOptions.data.items.map((option) => option.value),
                fundingBookOptions.data.piFundingBookOptions,
              )
            : { otherProjectOptions: [], unknownFundingBookNos: [] };
          if (!confirmed && (review.otherProjectOptions.length || review.unknownFundingBookNos.length)) {
            setFundingBookReview(review);
            return;
          }
          setFundingBookReview({ otherProjectOptions: [], unknownFundingBookNos: [] });
          const automaticRemarks = review.otherProjectOptions.map(fundingBookRemark);
          const reimbursementFormNote = [values.reimbursementFormNote?.trim() || "", ...automaticRemarks]
            .filter((value, index, entries) => value && entries.indexOf(value) === index)
            .join("\n");
          if (automaticRemarks.length) form.setFieldValue("reimbursementFormNote", reimbursementFormNote);
          await advance.mutateAsync({
            workflowId: target.id,
            toStatus: "statement_archived",
            registration: {
              reimbursementForms: reimbursementForms.map((entry) => ({
                formNo: entry.formNo,
                amount: Number(entry.amount) || 0,
                fundingBookNo: entry.fundingBookNo?.trim() || "",
              })),
              signedStatementReturned: Boolean(values.signedStatementReturned),
              signedStatementNote: values.signedStatementNote?.trim() || "",
              reimbursementFormReturned: Boolean(values.reimbursementFormReturned),
              reimbursementFormNote,
            },
          });
          return true;
        },
        (registered) => {
          if (registered) {
            feedback.success("结算单交回登记已保存", `${target.month} · ${formatPersonNames(target.pi)}`);
            onRegistered();
          }
        },
      ),
    );
  }

  async function handleUpload(kind: "settlement" | "reimbursement", file: File) {
    let uploaded: BillingWorkflowAttachment | undefined;
    await runOperation(() =>
      upload.run(
        () => uploadWorkflowAttachment(target.id, kind, file),
        (attachment) => {
          uploaded = attachment;
          if (kind === "settlement") setSettlementAttachment(attachment ?? null);
          else setReimbursementAttachment(attachment ?? null);
          feedback.success(
            kind === "settlement" ? "结算单扫描件已上传" : "报销单扫描件已上传",
            attachment?.originalName || file.name,
          );
        },
      ),
    );
    return uploaded;
  }

  const attachmentField = (attachment: BillingWorkflowAttachment | null, kind: "settlement" | "reimbursement") => (
    <WorkflowScanUpload
      attachment={attachment}
      disabled={save.pending || upload.pending}
      pending={upload.pending}
      onUpload={(file) => handleUpload(kind, file)}
    />
  );

  return (
    <Form
      name={`workflow-registration-${target.id}`}
      disabled={save.pending || upload.pending}
      form={form}
      initialValues={registrationInitialValues(target)}
      layout="vertical"
      onSubmitCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submitRegistration();
      }}
    >
      {save.error || upload.error ? (
        <Alert role="alert" showIcon style={{ marginBottom: 12 }} title={save.error || upload.error} type="error" />
      ) : null}
      <Form.Item
        name="signedStatementReturned"
        rules={[
          {
            validator: (_, value) =>
              value ? Promise.resolve() : Promise.reject(new Error(`请确认已交回${settlementLabel}`)),
          },
        ]}
        valuePropName="checked"
      >
        <RegistrationSwitch
          label={settlementLabel}
          returnedLabel="已交回"
          unreturnedLabel="未交回"
          returnedColor={tagColors.document.statement}
        />
      </Form.Item>
      {signedStatementReturned ? (
        <>
          <Form.Item label={`${settlementLabel}扫描件`}>
            {attachmentField(settlementAttachment, "settlement")}
          </Form.Item>
          <Form.Item label={`${settlementLabel}备注`} name="signedStatementNote">
            <Input.TextArea showCount maxLength={500} placeholder="选填，记录交回相关信息" rows={2} />
          </Form.Item>
        </>
      ) : null}
      {hasPayableAmount ? (
        <>
          <Form.Item name="reimbursementFormReturned" valuePropName="checked">
            <RegistrationSwitch
              label="报销单"
              returnedLabel="已交回"
              unreturnedLabel="未交回"
              returnedColor={tagColors.document.reimbursement}
            />
          </Form.Item>
          {reimbursementFormReturned ? (
            <>
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
              <ReimbursementFormFields options={fundingOptions} loading={fundingBookOptions.isLoading} />
              {reimbursementFormReturned && !(reimbursementForms || []).length ? (
                <Alert role="alert" showIcon style={{ marginBottom: 8 }} title="请填写报销单号和金额" type="error" />
              ) : null}
              <Form.Item label="报销单扫描件" style={{ marginTop: 12 }}>
                {attachmentField(reimbursementAttachment, "reimbursement")}
              </Form.Item>
              <Form.Item label="报销单备注" name="reimbursementFormNote">
                <Input.TextArea showCount maxLength={500} placeholder="选填，记录交回相关信息" rows={2} />
              </Form.Item>
            </>
          ) : null}
        </>
      ) : null}
      <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
        <Button disabled={save.pending || upload.pending} onClick={onCancel}>
          取消
        </Button>
        <Button
          disabled={upload.pending}
          loading={save.pending}
          type="primary"
          onClick={() => void submitRegistration()}
        >
          保存登记
        </Button>
      </Flex>
      <FundingBookConfirmationModal
        otherProjectFundingBooks={fundingBookReview.otherProjectOptions}
        pending={save.pending}
        pi={target.pi}
        unknownFundingBookNos={fundingBookReview.unknownFundingBookNos}
        onCancel={() => setFundingBookReview({ otherProjectOptions: [], unknownFundingBookNos: [] })}
        onConfirm={() => void submitRegistration(true)}
      />
    </Form>
  );
}
