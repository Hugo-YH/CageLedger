import { Alert, Button, Checkbox, Form, Input, Select, Space, Typography } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useRef, useState } from "react";

import type { FeedbackKind, FeedbackSubmission } from "../../../contracts/feedback";
import { uploadFeedbackAttachment, useCreateFeedback } from "../../api/feedback";
import { ApiError } from "../../api/client";
import { Drawer } from "../../components/ui/Drawer";
import { captureDiagnostics } from "../../diagnostics/collector";
import { APP_VERSION } from "../../version";
import { FeedbackDiagnosticsPreview } from "./FeedbackDiagnosticsPreview";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { KIND_LABEL } from "./feedbackPresentation";

type Draft = { title: string; kind: FeedbackKind; module: string; description: string };

export function FeedbackCreateDrawer({
  build,
  open,
  page,
  onClose,
  onCreated,
}: {
  build: string;
  open: boolean;
  page: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form] = Form.useForm<Draft>();
  const create = useCreateFeedback();
  const requestId = useRef(crypto.randomUUID());
  const attachmentRequestIds = useRef(new Map<string, string>());
  const saving = useRef(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [previewDiagnostics, setPreviewDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState(captureDiagnostics);
  const submission = useRef<FeedbackSubmission | null>(null);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const environment = { appVersion: APP_VERSION, build, page, browser: navigator.userAgent };
  const pending = create.isPending || uploading;
  async function save() {
    if (saving.current) return;
    saving.current = true;
    try {
      const values = submission.current ? null : await form.validateFields();
      setUploadError("");
      if (!submission.current && values) {
        submission.current = {
          ...values,
          requestId: requestId.current,
          environment,
          ...(includeDiagnostics ? { diagnostics } : {}),
        };
        setSubmissionLocked(true);
      }
      const item = createdId ? { id: createdId } : (await create.mutateAsync(submission.current!)).item;
      if (!createdId) setCreatedId(item.id);
      setUploading(true);
      const failed: UploadFile[] = [];
      for (const uploadFile of files) {
        const file = uploadFile.originFileObj;
        if (!file) continue;
        try {
          let attachmentRequestId = attachmentRequestIds.current.get(uploadFile.uid);
          if (!attachmentRequestId) {
            attachmentRequestId = crypto.randomUUID();
            attachmentRequestIds.current.set(uploadFile.uid, attachmentRequestId);
          }
          await uploadFeedbackAttachment(item.id, attachmentRequestId, file);
        } catch {
          failed.push(uploadFile);
        }
      }
      setFiles(failed);
      if (failed.length) {
        setUploadError("反馈已提交，但部分截图上传失败。本地已保留，可重试。");
        return;
      }
      onCreated(item.id);
    } catch (error) {
      if (!createdId && error instanceof ApiError && error.status >= 400 && error.status < 500) {
        submission.current = null;
        setSubmissionLocked(false);
      }
      setUploadError(error instanceof Error ? error.message : "提交失败，请重试");
    } finally {
      setUploading(false);
      saving.current = false;
    }
  }
  return (
    <Drawer
      destroyOnHidden
      drawerRender={(node) => (
        <div className="feedback-drawer-render" data-feature="feedback">
          {node}
        </div>
      )}
      closable={pending ? { disabled: true } : true}
      keyboard={!pending}
      mask={{ closable: !pending }}
      open={open}
      size={560}
      title="提交反馈"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <Space>
          <Button disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            aria-label={createdId && files.length ? "重试上传" : "提交"}
            type="primary"
            disabled={pending}
            loading={pending}
            onClick={() => void save()}
          >
            {createdId && files.length ? "重试上传" : "提交"}
          </Button>
        </Space>
      }
    >
      <Form
        disabled={Boolean(createdId) || pending || submissionLocked}
        form={form}
        layout="vertical"
        initialValues={{ kind: "bug", module: "", title: "", description: "" }}
      >
        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
          <Select options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="module" label="涉及模块" rules={[{ required: true, message: "请填写涉及模块" }]}>
          <Input maxLength={100} placeholder="例如：笼位管理" />
        </Form.Item>
        <Form.Item name="description" label="问题描述" rules={[{ required: true, message: "请描述遇到的情况" }]}>
          <Input.TextArea
            rows={7}
            maxLength={5000}
            placeholder="支持 Markdown 标题、列表、引用和代码；截图请通过附件上传"
          />
        </Form.Item>
        <ScreenshotPicker
          canAdd={!createdId && !pending}
          canRemove={!pending}
          files={files}
          onError={setUploadError}
          onFiles={setFiles}
        />
      </Form>
      <Alert
        showIcon
        type="info"
        title="将随反馈一并提交的环境信息"
        description={`版本 ${environment.appVersion}${environment.build ? ` · Build ${environment.build}` : ""}；当前页面 ${environment.page}；浏览器 ${environment.browser}`}
      />
      <section className="feedback-diagnostics" aria-label="反馈诊断选项">
        <Space wrap>
          <Checkbox
            checked={includeDiagnostics}
            disabled={pending || submissionLocked}
            onChange={(event) => setIncludeDiagnostics(event.target.checked)}
          >
            提交反馈时附带诊断信息
          </Checkbox>
          <Button
            aria-expanded={previewDiagnostics}
            aria-controls="feedback-diagnostics-preview"
            onClick={() => setPreviewDiagnostics((value) => !value)}
          >
            {previewDiagnostics ? "收起诊断信息" : "预览诊断信息"}
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">
          仅附带近期错误、失败请求和简短操作轨迹，最多 50
          条。不会包含表单内容、业务明细或登录凭据；诊断摘要将随反馈同步到项目工单。取消勾选后不会提交该摘要。
        </Typography.Paragraph>
        {previewDiagnostics ? (
          <div id="feedback-diagnostics-preview">
            <FeedbackDiagnosticsPreview snapshot={diagnostics} />
            <Button disabled={pending || submissionLocked} onClick={() => setDiagnostics(captureDiagnostics())}>
              更新诊断信息
            </Button>
          </div>
        ) : null}
      </section>
      {uploadError ? <Alert className="feedback-submit-error" showIcon type="warning" title={uploadError} /> : null}
    </Drawer>
  );
}
