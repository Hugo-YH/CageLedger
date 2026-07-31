import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Collapse, Form, Select, Space, Tag, Typography } from "antd";

import type { InspectionAnswer, InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import {
  uploadAnimalInspectionPhoto,
  useAnimalInspection,
  useAnimalInspectionCatalog,
  useSaveAnimalInspection,
  useSubmitAnimalInspection,
} from "../../api/animalManagement";
import { useBootstrap } from "../../api/bootstrap";
import { AsyncActionButton, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import { HelpTooltip } from "../../components/Tooltip";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb } from "../shell/workspaceNavigation";
import { FindingCaptureDialog, ReferenceImageDialog, type ReferencePreview } from "./InspectionDialogs";
import {
  abnormalAnimalBodyRegions,
  groupedItems,
  inspectionAnswerKey,
  inspectionFacilityLabel,
  inspectionOutcome,
  MODULE_LABELS,
  resumeInspectionId,
  setResumeInspectionId,
} from "./model";

const moduleOrder: InspectionModuleCode[] = ["basicAssessment", "advancedAssessment", "abnormalAnimalAssessment"];

const MODULE_ANNOTATIONS: Partial<Record<InspectionModuleCode, string>> = {
  basicAssessment: "设施与福利",
  advancedAssessment: "操作与伦理",
};

export function InspectionEntry({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const [draftId, setDraftId] = useState(resumeInspectionId);
  const [facility, setFacility] = useState("");
  const [roomId, setRoomId] = useState("");
  const [modules, setModules] = useState<InspectionModuleCode[]>(["basicAssessment"]);
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [notice, setNotice] = useState("");
  const [findingDraft, setFindingDraft] = useState<InspectionCatalogNode | null>(null);
  const [referencePreview, setReferencePreview] = useState<ReferencePreview | null>(null);
  const catalog = useAnimalInspectionCatalog();
  const bootstrap = useBootstrap("summary");
  const detail = useAnimalInspection(draftId);
  const save = useSaveAnimalInspection();
  const submit = useSubmitAnimalInspection();
  const rooms = useMemo(
    () => (bootstrap.data?.rooms || []) as Array<{ id: string; name: string; facility?: string }>,
    [bootstrap.data?.rooms],
  );
  const facilities = [...new Set(rooms.map((room) => String(room.facility || "").trim()).filter(Boolean))].sort();
  const facilityRooms = rooms.filter((room) => room.facility === facility);
  const catalogNodes = catalog.data?.nodes || [];

  useEffect(() => {
    const item = detail.data?.item;
    if (!item) return;
    setFacility(item.facility || "");
    setRoomId(item.roomId);
    setModules(item.moduleCodes);
    const next: Record<string, InspectionAnswer> = {};
    for (const answer of detail.data!.answers) {
      const source = answer.payload || answer;
      next[inspectionAnswerKey(source.moduleCode || answer.module_code, source.nodeCode || answer.node_code)] = {
        nodeCode: source.nodeCode || answer.node_code,
        moduleCode: source.moduleCode || answer.module_code,
        outcome: source.outcome,
        score: source.score,
        subOption: source.subOption,
        note: source.note,
        locationHint: source.locationHint,
        rackHint: source.rackHint,
        cageNumber: source.cageNumber,
        animalIdentifier: source.animalIdentifier,
      };
    }
    setAnswers(next);
  }, [detail.data]);

  useEffect(() => {
    if (facility || !roomId) return;
    const room = rooms.find((item) => item.id === roomId);
    if (room?.facility) setFacility(room.facility);
  }, [facility, roomId, rooms]);

  function setModule(code: InspectionModuleCode, checked: boolean) {
    setModules((current) => {
      if (checked) return [...current, code];
      return current.filter((item) => item !== code);
    });
  }

  function updateAnswer(node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) {
    const key = inspectionAnswerKey(node.moduleCode, node.code);
    const current = answers[key] || { nodeCode: node.code, moduleCode: node.moduleCode, outcome: "normal" };
    setAnswers((items) => ({ ...items, [key]: { ...current, ...patch } }));
  }

  async function saveDraft() {
    setNotice("");
    try {
      const response = await save.mutateAsync({
        id: draftId || undefined,
        roomId,
        moduleCodes: modules,
        answers: Object.values(answers),
      });
      setDraftId(response.item.id);
      setResumeInspectionId(response.item.id);
      setNotice("巡检草稿已保存，可在巡检记录中继续编辑。");
      return response.item.id;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存巡检草稿失败");
      return "";
    }
  }

  async function submitInspection() {
    setNotice("");
    const id = await saveDraft();
    if (!id) return;
    try {
      const response = await submit.mutateAsync(id);
      const findingsByNode = new Map(
        response.findings.map((finding) => [`${finding.moduleCode}:${finding.nodeCode}`, finding]),
      );
      let photoNotice = "";
      try {
        await Promise.all(
          Object.entries(photos).flatMap(([key, files]) => {
            const finding = findingsByNode.get(key);
            return finding ? files.map((file) => uploadAnimalInspectionPhoto(id, finding.id, file)) : [];
          }),
        );
      } catch (error) {
        photoNotice = `；照片上传失败：${error instanceof Error ? error.message : "请在巡检记录中补传"}`;
      }
      setPhotos({});
      setResumeInspectionId("");
      setDraftId("");
      setNotice(`巡检已提交，已生成 ${response.findings.length} 项异常处置项${photoNotice}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "提交巡检失败");
    }
  }

  if (catalog.isLoading || bootstrap.isLoading || (draftId && detail.isLoading))
    return <PageState title="正在加载巡检工作区..." />;
  if (catalog.isError || bootstrap.isError || detail.isError)
    return <PageState title="巡检工作区加载失败" retry={() => void catalog.refetch()} />;

  return (
    <section className="workspace-view animal-management-workspace">
      <WorkspaceHeader
        kicker="动物管理工作台"
        title="动物巡检"
        summary="以饲养间为对象完成正常确认、异常留证和提交锁定。"
        status={draftId ? "草稿编辑中" : "新建巡检"}
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
        actions={
          <>
            <AsyncActionButton
              className="secondary inspection-save-draft"
              type="button"
              pending={save.isPending}
              pendingLabel="保存中..."
              disabled={submit.isPending}
              onClick={() => void saveDraft()}
            >
              保存草稿
            </AsyncActionButton>
            <AsyncActionButton
              className="primary inspection-submit"
              type="button"
              pending={submit.isPending}
              pendingLabel="提交中..."
              disabled={save.isPending}
              onClick={() => void submitInspection()}
            >
              提交巡检
            </AsyncActionButton>
          </>
        }
      />
      <div className="workspace-body animal-management-body">
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        <Card
          className="animal-ant-card inspection-context-panel"
          title={
            <Space size={8}>
              <span id="inspection-context-title">巡检对象与评估模块</span>
              <HelpTooltip label="巡检对象快照说明">
                提交后自动固化当前房间、IACUC、项目负责人、品系和数量快照。
              </HelpTooltip>
            </Space>
          }
        >
          <div className="inspection-context-grid">
            <Form className="inspection-room-picker" component={false} layout="vertical">
              <Form.Item label="设施">
                <Select
                  aria-label="设施"
                  className="inspection-room-select"
                  id="inspection-facility"
                  options={[
                    { label: "请选择设施", value: "" },
                    ...facilities.map((value) => ({ label: inspectionFacilityLabel(value), value })),
                  ]}
                  value={facility}
                  onChange={(value) => {
                    setFacility(value);
                    setRoomId("");
                  }}
                />
              </Form.Item>
              <Form.Item label="饲养间">
                <Select
                  aria-label="饲养间"
                  disabled={!facility}
                  className="inspection-room-select"
                  id="inspection-room"
                  options={[
                    { label: facility ? "请选择饲养间" : "请先选择设施", value: "" },
                    ...facilityRooms.map((room) => ({ label: room.name, value: room.id })),
                  ]}
                  value={roomId}
                  onChange={setRoomId}
                />
              </Form.Item>
            </Form>
            <div className="inspection-module-picker" role="group" aria-label="评估模块">
              {moduleOrder.map((code) => {
                const module = catalog.data?.modules.find((item) => item.code === code);
                return (
                  <Card
                    className={`inspection-module-choice ${modules.includes(code) ? "is-selected" : ""}`}
                    data-module={code}
                    key={code}
                    size="small"
                  >
                    <div className="inspection-module-choice-content">
                      <Checkbox
                        checked={modules.includes(code)}
                        onChange={(event) => setModule(code, event.target.checked)}
                      >
                        <Typography.Text strong>{module?.name || MODULE_LABELS[code]}</Typography.Text>
                      </Checkbox>
                      {MODULE_ANNOTATIONS[code] ? (
                        <Tag color="blue" variant="filled">
                          {MODULE_ANNOTATIONS[code]}
                        </Tag>
                      ) : null}
                      <HelpTooltip label={`${module?.name || MODULE_LABELS[code]}说明`}>
                        {module?.description || "按标准完成逐项巡检"}
                      </HelpTooltip>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </Card>
        {modules.map((moduleCode) => (
          <InspectionModuleForm
            answerMap={answers}
            key={moduleCode}
            moduleCode={moduleCode}
            nodes={catalogNodes}
            onAnswer={updateAnswer}
            onFinding={setFindingDraft}
            onReference={setReferencePreview}
          />
        ))}
        <Alert
          className="inspection-review-notice"
          description={catalog.data?.reviewNotice}
          title="审核提示"
          showIcon
          type="warning"
        />
      </div>
      {findingDraft ? (
        <FindingCaptureDialog
          node={findingDraft}
          answer={answers[inspectionAnswerKey(findingDraft.moduleCode, findingDraft.code)]}
          onClose={() => setFindingDraft(null)}
          onReference={setReferencePreview}
          onConfirm={({ answer, files }) => {
            updateAnswer(findingDraft, { outcome: "abnormal", ...answer });
            setPhotos((current) => ({
              ...current,
              [inspectionAnswerKey(findingDraft.moduleCode, findingDraft.code)]: files,
            }));
            setFindingDraft(null);
          }}
        />
      ) : null}
      {referencePreview ? (
        <ReferenceImageDialog preview={referencePreview} onClose={() => setReferencePreview(null)} />
      ) : null}
    </section>
  );
}

function InspectionModuleForm({
  moduleCode,
  nodes,
  answerMap,
  onAnswer,
  onFinding,
  onReference,
}: {
  moduleCode: InspectionModuleCode;
  nodes: InspectionCatalogNode[];
  answerMap: Record<string, InspectionAnswer>;
  onAnswer: (node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => void;
  onFinding: (node: InspectionCatalogNode) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  return (
    <Card
      className="animal-ant-card inspection-module-card"
      data-module={moduleCode}
      aria-labelledby={`inspection-module-${moduleCode}`}
      size="small"
      styles={{ body: { padding: 0 } }}
      title={
        <span className="inspection-module-card-title">
          <span id={`inspection-module-${moduleCode}`}>{MODULE_LABELS[moduleCode]}</span>
          {MODULE_ANNOTATIONS[moduleCode] ? (
            <Tag color="blue" variant="filled">
              {MODULE_ANNOTATIONS[moduleCode]}
            </Tag>
          ) : null}
          <HelpTooltip label={`${MODULE_LABELS[moduleCode]}巡检说明`}>
            每个条目选择正常或异常；确认异常后补充定位、图例对照和现场照片。
          </HelpTooltip>
        </span>
      }
    >
      {moduleCode === "abnormalAnimalAssessment"
        ? abnormalAnimalBodyRegions(nodes).map((region) => (
            <InspectionBodyRegionSection
              answerMap={answerMap}
              key={region.key}
              moduleCode={moduleCode}
              onAnswer={onAnswer}
              onFinding={onFinding}
              onReference={onReference}
              region={region}
            />
          ))
        : groupedItems(nodes, moduleCode).map(([category, items]) => (
            <InspectionCategory
              answerMap={answerMap}
              category={category}
              items={items}
              key={category}
              moduleCode={moduleCode}
              onAnswer={onAnswer}
              onFinding={onFinding}
              onReference={onReference}
            />
          ))}
    </Card>
  );
}

function InspectionBodyRegionSection({
  region,
  moduleCode,
  answerMap,
  onAnswer,
  onFinding,
  onReference,
}: {
  region: ReturnType<typeof abnormalAnimalBodyRegions>[number];
  moduleCode: InspectionModuleCode;
  answerMap: Record<string, InspectionAnswer>;
  onAnswer: (node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => void;
  onFinding: (node: InspectionCatalogNode) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const items = region.groups.flatMap((group) => group.items);
  const answered = items.filter((node) => Boolean(answerMap[inspectionAnswerKey(moduleCode, node.code)])).length;
  const findings = items.filter(
    (node) => inspectionOutcome(answerMap[inspectionAnswerKey(moduleCode, node.code)]) === "abnormal",
  ).length;
  const stateLabel = findings
    ? `${findings} 项异常`
    : answered === items.length
      ? `已确认 ${answered}/${items.length}`
      : `待确认 ${answered}/${items.length}`;

  return (
    <section
      className={`inspection-body-region ${findings ? "has-findings" : ""}`}
      aria-label={`${region.name}异常动物评估`}
    >
      <Collapse
        className="inspection-body-region-collapse"
        bordered
        expandIconPlacement="end"
        size="small"
        items={[
          {
            key: region.key,
            label: (
              <span className="inspection-body-region-label">
                <span className="inspection-body-region-label-main">
                  <strong>{region.name}</strong>
                  <Tag variant="filled">{region.description}</Tag>
                </span>
                <Space size={8}>
                  <Tag color={findings ? "error" : answered === items.length ? "success" : "default"}>{stateLabel}</Tag>
                  <span className="inspection-body-region-count">{region.itemCount} 项</span>
                </Space>
              </span>
            ),
            children: region.groups.map((group) => (
              <InspectionCategory
                answerMap={answerMap}
                category={group.name}
                items={group.items}
                key={group.key}
                moduleCode={moduleCode}
                onAnswer={onAnswer}
                onFinding={onFinding}
                onReference={onReference}
              />
            )),
          },
        ]}
      />
    </section>
  );
}

function InspectionCategory({
  category,
  items,
  moduleCode,
  answerMap,
  onAnswer,
  onFinding,
  onReference,
}: {
  category: string;
  items: InspectionCatalogNode[];
  moduleCode: InspectionModuleCode;
  answerMap: Record<string, InspectionAnswer>;
  onAnswer: (node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => void;
  onFinding: (node: InspectionCatalogNode) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const answered = items.filter((node) => Boolean(answerMap[inspectionAnswerKey(moduleCode, node.code)])).length;
  const findings = items.filter(
    (node) => inspectionOutcome(answerMap[inspectionAnswerKey(moduleCode, node.code)]) === "abnormal",
  ).length;
  const stateLabel = findings
    ? `${findings} 项异常`
    : answered === items.length
      ? `已确认 ${answered}/${items.length}`
      : `待确认 ${answered}/${items.length}`;
  return (
    <section className={`inspection-category ${findings ? "has-findings" : ""}`} aria-label={category}>
      <div className="inspection-category-head">
        <div className="inspection-category-title">
          <h3>{category}</h3>
          <Tag color={findings ? "error" : answered === items.length ? "success" : "default"}>{stateLabel}</Tag>
          <Button
            className="inspection-all-normal"
            size="small"
            type="link"
            onClick={() => items.forEach((node) => onAnswer(node, { outcome: "normal" }))}
          >
            全部正常
          </Button>
        </div>
      </div>
      <Collapse
        className="inspection-category-collapse"
        expandIconPlacement="start"
        ghost
        items={[
          {
            key: "items",
            label: (
              <span className="inspection-category-collapse-label">
                <span>查看检查项</span>
                <Tag variant="filled">{items.length} 项</Tag>
              </span>
            ),
            children: (
              <div className="inspection-category-items">
                {items.map((node) => {
                  const key = inspectionAnswerKey(moduleCode, node.code);
                  const answer = answerMap[key];
                  // A missing answer remains visibly pending until the inspector confirms it.
                  const outcome = answer ? inspectionOutcome(answer) : undefined;
                  const images = node.config?.referenceImages || [];
                  return (
                    <article
                      className={`inspection-node ${outcome === "abnormal" ? "has-finding" : ""}`}
                      key={node.code}
                    >
                      <div className="inspection-node-main">
                        <div className="inspection-node-title">
                          <strong>{node.name}</strong>
                          {images.length ? (
                            <Button
                              className="inspection-reference-trigger"
                              size="small"
                              type="link"
                              onClick={() => onReference({ images, initialIndex: 0, title: node.name })}
                            >
                              图例 {images.length}
                            </Button>
                          ) : null}
                        </div>
                        <Space.Compact
                          className="inspection-outcome-options"
                          role="group"
                          aria-label={`${node.name}巡检结论`}
                        >
                          <Button
                            aria-pressed={outcome === "normal"}
                            className="normal"
                            size="small"
                            type={outcome === "normal" ? "primary" : "default"}
                            onClick={() => onAnswer(node, { outcome: "normal" })}
                          >
                            正常
                          </Button>
                          <Button
                            aria-pressed={outcome === "abnormal"}
                            className="abnormal"
                            danger
                            size="small"
                            type={outcome === "abnormal" ? "primary" : "default"}
                            onClick={() => onFinding(node)}
                          >
                            异常
                          </Button>
                        </Space.Compact>
                        {node.description ? <p>{node.description}</p> : null}
                      </div>
                      {outcome === "abnormal" ? (
                        <div className="inspection-finding-summary">
                          <strong>已登记异常</strong>
                          <span>
                            {answer?.locationHint ||
                              answer?.animalIdentifier ||
                              answer?.note ||
                              "已登记，可点击异常修改。"}
                          </span>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
