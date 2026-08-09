import { useMemo, useState } from "react";
import type { Key } from "react";
import { App, Button, Card, Form, Modal, Segmented, Select, Space, Tag, Tree, Typography } from "antd";
import { PlusOutlined, SaveOutlined, SendOutlined } from "@ant-design/icons";

import { createClientId } from "../../../domain/id";
import {
  catalogDiff,
  catalogTreeData,
  catalogWorkingCopyReducer,
  nextChildCode,
} from "../../../domain/inspectionCatalog";
import type { CatalogWorkingCopy, CatalogTreeNode } from "../../../domain/inspectionCatalog";
import {
  useAnimalInspectionCatalogDraft,
  usePublishInspectionCatalogDraft,
  useSaveInspectionCatalogDraft,
} from "../../api/animalManagement";
import { ApiError } from "../../api/client";
import type { InspectionCatalogDraftResponse, InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import { InspectionNodeForm } from "./InspectionNodeForm";
import { InspectionPublishModal } from "./InspectionPublishModal";

export function InspectionCatalogEditor({
  draft,
  onExit,
}: {
  draft: InspectionCatalogDraftResponse;
  onExit: () => void;
}) {
  const { message } = App.useApp();
  const draftQuery = useAnimalInspectionCatalogDraft(true);
  const saveDraft = useSaveInspectionCatalogDraft();
  const publishCatalog = usePublishInspectionCatalogDraft();

  const [working, setWorking] = useState<CatalogWorkingCopy>(() => ({
    modules: draft.modules,
    nodes: draft.nodes,
  }));
  const [saved, setSaved] = useState<CatalogWorkingCopy>(() => ({
    modules: draft.modules,
    nodes: draft.nodes,
  }));
  const [savedUpdatedAt, setSavedUpdatedAt] = useState(draft.version.updatedAt);
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [formState, setFormState] = useState<{ node: InspectionCatalogNode; isNew: boolean } | null>(null);
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [addModule, setAddModule] = useState<InspectionModuleCode>("basicAssessment");
  const [addParentCode, setAddParentCode] = useState<string>("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishDiff, setPublishDiff] = useState(() => catalogDiff(draft.active.nodes, working.nodes));

  const diff = useMemo(() => catalogDiff(draft.active.nodes, working.nodes), [draft.active.nodes, working.nodes]);
  const changeMap = useMemo(() => new Map(diff.nodes.map((item) => [item.code, item.change])), [diff.nodes]);
  const dirty = useMemo(() => catalogDiff(saved.nodes, working.nodes).nodes.length > 0, [saved.nodes, working.nodes]);
  const treeData = useMemo(
    () =>
      catalogTreeData(working.modules, working.nodes, (moduleFilter || undefined) as InspectionModuleCode | undefined),
    [working.modules, working.nodes, moduleFilter],
  );
  const parentOptions = useMemo(
    () =>
      working.nodes
        .filter(
          (node) => node.moduleCode === addModule && (node.nodeType === "CATEGORY" || node.nodeType === "SUBCATEGORY"),
        )
        .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0))
        .map((node) => ({
          value: node.code,
          label: `${node.nodeType === "CATEGORY" ? "分类" : "子分类"}：${node.name}`,
        })),
    [working.nodes, addModule],
  );
  const moduleOptions = useMemo(
    () => [
      { label: "全部模块", value: "" },
      ...working.modules.map((module) => ({ label: module.name, value: module.code })),
    ],
    [working.modules],
  );

  async function refreshFromServer() {
    const fresh = await draftQuery.refetch();
    if (!fresh.data) return;
    setWorking({ modules: fresh.data.modules, nodes: fresh.data.nodes });
    setSaved({ modules: fresh.data.modules, nodes: fresh.data.nodes });
    setSavedUpdatedAt(fresh.data.version.updatedAt);
    setSelectedCode("");
    setFormState(null);
  }

  async function handleSave(): Promise<boolean> {
    try {
      const payload = await saveDraft.mutateAsync({
        modules: working.modules,
        nodes: working.nodes,
        expectedUpdatedAt: savedUpdatedAt,
      });
      setSaved({ modules: payload.modules, nodes: payload.nodes });
      setSavedUpdatedAt(payload.version.updatedAt);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        message.warning("草稿已被其他管理员更新，已刷新为最新内容，请重新检查后保存");
        await refreshFromServer();
      } else {
        message.error(error instanceof Error ? error.message : "保存草稿失败");
      }
      return false;
    }
  }

  function handleSaveClick() {
    void (async () => {
      if (await handleSave()) message.success("草稿已保存");
    })();
  }

  function handlePublishClick() {
    void (async () => {
      if (!dirty && diff.nodes.length === 0) {
        message.info("草稿与当前目录一致，没有可发布的内容");
        return;
      }
      if (dirty && !(await handleSave())) return;
      setPublishDiff(catalogDiff(draft.active.nodes, working.nodes));
      setPublishOpen(true);
    })();
  }

  async function handleConfirmPublish() {
    try {
      await publishCatalog.mutateAsync();
      message.success("目录已发布并生效");
      onExit();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发布失败");
    }
  }

  function handleAddConfirm() {
    const parent = working.nodes.find((node) => node.code === addParentCode);
    if (!parent) return;
    const siblings = working.nodes.filter((node) => String(node.parentId) === String(parent.id));
    const node: InspectionCatalogNode = {
      id: createClientId(),
      code: nextChildCode(parent, working.nodes),
      moduleId: parent.moduleId,
      moduleCode: parent.moduleCode,
      parentId: String(parent.id),
      nodeType: "ITEM",
      inputType: "severity",
      name: "新条目",
      sortOrder: Math.max(0, ...siblings.map((item) => item.sortOrder || 0)) + 1,
      config: {},
    };
    setAddOpen(false);
    setFormState({ node, isNew: true });
  }

  function handleNodeSave(node: InspectionCatalogNode) {
    setWorking((state) =>
      catalogWorkingCopyReducer(state, formState?.isNew ? { type: "addNode", node } : { type: "applyNode", node }),
    );
    setSelectedCode("");
    setFormState(null);
  }

  function handleNodeDelete(code: string) {
    setWorking((state) => catalogWorkingCopyReducer(state, { type: "removeNode", code }));
    setSelectedCode("");
    setFormState(null);
    message.success("条目已从草稿移除，保存草稿后生效");
  }

  function handleTreeSelect(keys: Key[]) {
    const code = String(keys[0] || "");
    if (!code) return;
    const node = working.nodes.find((item) => item.code === code);
    if (!node) return;
    setSelectedCode(code);
    setFormState({ node, isNew: false });
  }

  function closeForm() {
    setSelectedCode("");
    setFormState(null);
  }

  function treeTitle(node: CatalogTreeNode) {
    const change = changeMap.get(node.key);
    return (
      <span className="inspection-tree-title">
        <span className="inspection-tree-name">{node.title}</span>
        {change ? (
          <Tag
            className="inspection-tree-change"
            color={change === "added" ? "green" : change === "modified" ? "orange" : "red"}
          >
            {change === "added" ? "新增" : change === "modified" ? "修改" : "删除"}
          </Tag>
        ) : null}
      </span>
    );
  }

  return (
    <Card
      className="animal-ant-card inspection-editor-panel"
      title="编辑巡检标准目录"
      extra={
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            新增条目
          </Button>
          <Button icon={<SaveOutlined />} disabled={!dirty || saveDraft.isPending} onClick={handleSaveClick}>
            保存草稿
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={diff.nodes.length === 0 || saveDraft.isPending || publishCatalog.isPending}
            onClick={handlePublishClick}
          >
            发布
          </Button>
          <Button onClick={onExit}>返回</Button>
        </Space>
      }
    >
      <div className="inspection-editor-toolbar">
        <Segmented
          className="inspection-editor-module-filter"
          options={moduleOptions}
          value={moduleFilter}
          onChange={(value) => setModuleFilter(String(value))}
        />
        <Typography.Text type="secondary" className="inspection-editor-status">
          {dirty ? <Tag color="orange">有未保存的修改</Tag> : <Tag color="green">草稿已保存</Tag>}
          上次保存 {savedUpdatedAt.replace("T", " ").slice(5, 16)}
        </Typography.Text>
      </div>
      <div className="inspection-editor-body">
        <Tree
          className="inspection-editor-tree"
          treeData={treeData}
          defaultExpandAll
          showLine
          selectable
          selectedKeys={selectedCode ? [selectedCode] : []}
          titleRender={treeTitle}
          onSelect={handleTreeSelect}
        />
      </div>
      {formState ? (
        <InspectionNodeForm
          key={formState.isNew ? "new" : formState.node.code}
          node={formState.node}
          isNew={formState.isNew}
          onSave={handleNodeSave}
          onClose={closeForm}
          onDelete={formState.isNew ? undefined : handleNodeDelete}
        />
      ) : null}
      <Modal
        className="inspection-add-node-modal"
        open={addOpen}
        title="新增巡检条目"
        okText="下一步"
        cancelText="取消"
        onOk={handleAddConfirm}
        onCancel={() => setAddOpen(false)}
        width={420}
      >
        <Form layout="vertical">
          <Form.Item label="巡检模块" required>
            <Select
              value={addModule}
              onChange={(value) => {
                setAddModule(value);
                setAddParentCode("");
              }}
              options={[
                { value: "basicAssessment", label: "基础评估" },
                { value: "advancedAssessment", label: "进阶评估" },
                { value: "abnormalAnimalAssessment", label: "异常动物（小鼠）评估" },
              ]}
            />
          </Form.Item>
          <Form.Item label="所属分类 / 子分类" required>
            <Select
              value={addParentCode || undefined}
              placeholder="选择条目归属的分类"
              onChange={setAddParentCode}
              options={parentOptions}
              showSearch={{ optionFilterProp: "label" }}
            />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">新条目将在保存草稿后纳入目录，发布后进入巡检录入表单。</Typography.Text>
      </Modal>
      <InspectionPublishModal
        open={publishOpen}
        diff={publishDiff}
        pending={publishCatalog.isPending}
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => void handleConfirmPublish()}
      />
    </Card>
  );
}
