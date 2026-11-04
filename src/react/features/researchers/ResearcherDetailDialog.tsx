import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Form, Input, Space, Typography } from "antd";
import { useRef, useState } from "react";

import type { Researcher, ResearcherEditable } from "../../../contracts/researchers";
import { ApiError } from "../../api/client";
import { useResearcher, useSaveResearcher } from "../../api/researchers";
import { PageSkeleton, PageState } from "../../components/WorkspaceUi";
import { Modal } from "../../components/ui";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { displayResearcherValue, RESEARCHER_FIELDS, researcherEditable, researcherError } from "./researcherFields";

export function ResearcherDetailDialog({
  id,
  canEdit,
  onClose,
  onSaved,
}: {
  id: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (item: Researcher) => void;
}) {
  const detail = useResearcher(id);
  if (!detail.data)
    return (
      <Modal open title="实验人员资料" onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
        {detail.isError ? (
          <PageState
            title="人员资料加载失败"
            detail={researcherError(detail.error)}
            retry={() => void detail.refetch()}
          />
        ) : (
          <PageSkeleton label="人员资料" variant="form" />
        )}
      </Modal>
    );
  return (
    <ResearcherEditor
      item={detail.data.item}
      canEdit={canEdit}
      onClose={onClose}
      onSaved={onSaved}
      onReload={async () => {
        const result = await detail.refetch({ throwOnError: true });
        return result.data!.item;
      }}
    />
  );
}

function ResearcherEditor({
  item,
  canEdit,
  onClose,
  onSaved,
  onReload,
}: {
  item: Researcher;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (item: Researcher) => void;
  onReload: () => Promise<Researcher>;
}) {
  const [baseline, setBaseline] = useState(item);
  const [draft, setDraft] = useState(() => researcherEditable(item));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latestItem, setLatestItem] = useState<Researcher | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const save = useSaveResearcher();
  const submitting = useRef(false);
  const latest = useLatestRequest();
  const dirty = JSON.stringify(draft) !== JSON.stringify(researcherEditable(baseline));
  const confirmLeave = useUnsavedChanges(canEdit && dirty, save.isPending);
  async function close() {
    if (!(await confirmLeave())) return;
    latest.invalidate();
    onClose();
  }
  async function submit() {
    if (!canEdit || submitting.current || conflict || !dirty) return;
    submitting.current = true;
    const current = latest.begin();
    setError("");
    try {
      const result = await save.mutateAsync({ id: baseline.id, item: draft, expectedUpdatedAt: baseline.updatedAt });
      if (current()) onSaved(result.item);
    } catch (cause) {
      if (current()) {
        setError(researcherError(cause));
        if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      }
    } finally {
      submitting.current = false;
    }
  }
  async function reload() {
    const current = latest.begin();
    setLoadingLatest(true);
    try {
      const result = await onReload();
      if (current()) setLatestItem(result);
    } catch (cause) {
      if (current()) setError(researcherError(cause));
    } finally {
      if (current()) setLoadingLatest(false);
    }
  }
  return (
    <Modal
      open
      title={canEdit ? "编辑实验人员资料" : "实验人员资料"}
      className="researcher-detail-dialog"
      width="min(800px, calc(100vw - 32px))"
      onCancel={() => void close()}
      footer={
        <Space>
          <Button disabled={save.isPending} onClick={() => void close()}>
            关闭
          </Button>
          {canEdit ? (
            <Button
              aria-label="保存资料"
              aria-busy={save.isPending}
              type="primary"
              loading={save.isPending}
              disabled={!dirty || conflict || save.isPending}
              onClick={() => void submit()}
            >
              保存资料
            </Button>
          ) : null}
        </Space>
      }
    >
      <Space orientation="vertical" size="middle" className="researcher-dialog-content">
        <Typography.Text type="secondary">账号为通讯录唯一标识，与系统登录账号独立。</Typography.Text>
        {error ? (
          <Alert
            type="error"
            showIcon
            title={conflict ? "资料已被其他人更新，当前草稿已保留" : "资料尚未保存"}
            description={error}
            action={
              conflict ? (
                <Button
                  aria-label="加载最新资料核对"
                  aria-busy={loadingLatest}
                  icon={<ReloadOutlined aria-hidden />}
                  loading={loadingLatest}
                  onClick={() => void reload()}
                >
                  加载最新资料核对
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {latestItem ? (
          <Alert
            type="warning"
            showIcon
            title="核对最新资料后可重新编辑"
            description={
              <Space orientation="vertical">
                <ResearcherDetails item={latestItem} />
                <Button
                  onClick={() => {
                    setBaseline(latestItem);
                    setDraft(researcherEditable(latestItem));
                    setLatestItem(null);
                    setConflict(false);
                    setError("");
                  }}
                >
                  放弃当前草稿，按最新资料重新编辑
                </Button>
              </Space>
            }
          />
        ) : null}
        {canEdit ? (
          <Form layout="vertical" className="researcher-edit-form" disabled={save.isPending}>
            <Form.Item label="账号">
              <Input aria-label="账号" value={baseline.account} readOnly />
            </Form.Item>
            {RESEARCHER_FIELDS.map(([field, label]) => (
              <Form.Item key={field} label={label}>
                <Input
                  aria-label={label}
                  value={draft[field]}
                  onChange={(event) =>
                    setDraft((previous: ResearcherEditable) => ({ ...previous, [field]: event.target.value }))
                  }
                />
              </Form.Item>
            ))}
          </Form>
        ) : (
          <ResearcherDetails item={baseline} />
        )}
        {canEdit ? (
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={[
              { key: "gender", label: "性别", children: baseline.gender || "—" },
              { key: "englishName", label: "英文名", children: baseline.englishName || "—" },
              {
                key: "sourceDisabled",
                label: "来源禁用标记",
                children: displayResearcherValue(baseline.sourceDisabled),
              },
              { key: "activationStatus", label: "来源激活状态", children: baseline.activationStatus || "—" },
            ]}
          />
        ) : null}
      </Space>
    </Modal>
  );
}

function ResearcherDetails({ item }: { item: Researcher }) {
  return (
    <Descriptions
      size="small"
      column={{ xs: 1, sm: 2 }}
      items={[
        { key: "account", label: "账号", children: item.account },
        ...RESEARCHER_FIELDS.map(([field, label]) => ({ key: field, label, children: item[field] || "—" })),
        { key: "gender", label: "性别", children: item.gender || "—" },
        { key: "englishName", label: "英文名", children: item.englishName || "—" },
        { key: "sourceDisabled", label: "来源禁用标记", children: displayResearcherValue(item.sourceDisabled) },
        { key: "activationStatus", label: "来源激活状态", children: item.activationStatus || "—" },
      ]}
    />
  );
}
