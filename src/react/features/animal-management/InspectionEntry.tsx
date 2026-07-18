import { useEffect, useMemo, useState } from "react";

import type { InspectionAnswer, InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import {
  uploadAnimalInspectionPhoto,
  useAnimalInspection,
  useAnimalInspectionCatalog,
  useSaveAnimalInspection,
  useSubmitAnimalInspection,
} from "../../api/animalManagement";
import { useBootstrap } from "../../api/bootstrap";
import { PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import { HelpTooltip, Tooltip } from "../../components/Tooltip";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb } from "../shell/workspaceNavigation";
import { FindingCaptureDialog, ReferenceImageDialog, type ReferencePreview } from "./InspectionDialogs";
import {
  groupedItems,
  inspectionAnswerKey,
  inspectionFacilityLabel,
  MODULE_LABELS,
  resumeInspectionId,
  setResumeInspectionId,
} from "./model";

const moduleOrder: InspectionModuleCode[] = ["basicAssessment", "advancedAssessment", "abnormalAnimalAssessment"];

export function InspectionEntry({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const [draftId, setDraftId] = useState(resumeInspectionId);
  const [facility, setFacility] = useState("");
  const [roomId, setRoomId] = useState("");
  const [modules, setModules] = useState<InspectionModuleCode[]>(["basicAssessment"]);
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [notice, setNotice] = useState("");
  const [findingDraft, setFindingDraft] = useState<{ node: InspectionCatalogNode; score: 1 | 2 } | null>(null);
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
    const current = answers[key] || { nodeCode: node.code, moduleCode: node.moduleCode, score: 3 };
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
        summary="以饲养间为对象完成标准化评分、异常留证和提交锁定。"
        status={draftId ? "草稿编辑中" : "新建巡检"}
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
        actions={
          <>
            <button
              className="secondary inspection-save-draft"
              type="button"
              disabled={save.isPending || submit.isPending}
              onClick={() => void saveDraft()}
            >
              保存草稿
            </button>
            <button
              className="primary inspection-submit"
              type="button"
              disabled={save.isPending || submit.isPending}
              onClick={() => void submitInspection()}
            >
              提交巡检
            </button>
          </>
        }
      />
      <div className="workspace-body animal-management-body">
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        <section className="panel inspection-context-panel" aria-labelledby="inspection-context-title">
          <div className="panel-head">
            <div className="panel-title-line">
              <h2 id="inspection-context-title">巡检对象与评估模块</h2>
              <HelpTooltip label="巡检对象快照说明">
                提交后自动固化当前房间、IACUC、项目负责人、品系和数量快照。
              </HelpTooltip>
            </div>
          </div>
          <div className="inspection-context-grid">
            <div className="inspection-room-picker">
              <label>
                设施
                <select
                  value={facility}
                  onChange={(event) => {
                    setFacility(event.target.value);
                    setRoomId("");
                  }}
                >
                  <option value="">请选择设施</option>
                  {facilities.map((value) => (
                    <option key={value} value={value}>
                      {inspectionFacilityLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                饲养间
                <select
                  disabled={!facility}
                  required
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                >
                  <option value="">{facility ? "请选择饲养间" : "请先选择设施"}</option>
                  {facilityRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="inspection-module-picker" role="group" aria-label="评估模块">
              {moduleOrder.map((code) => {
                const module = catalog.data?.modules.find((item) => item.code === code);
                return (
                  <div className={modules.includes(code) ? "selected" : ""} data-module={code} key={code}>
                    <label htmlFor={`inspection-module-${code}`}>
                      <input
                        checked={modules.includes(code)}
                        id={`inspection-module-${code}`}
                        type="checkbox"
                        onChange={(event) => setModule(code, event.target.checked)}
                      />
                      <strong>{module?.name || MODULE_LABELS[code]}</strong>
                    </label>
                    <HelpTooltip label={`${module?.name || MODULE_LABELS[code]}说明`}>
                      {module?.description || "按标准完成逐项评分"}
                    </HelpTooltip>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        {modules.map((moduleCode) => (
          <InspectionModuleForm
            answerMap={answers}
            key={moduleCode}
            moduleCode={moduleCode}
            nodes={catalogNodes}
            onAnswer={updateAnswer}
            onFinding={(node, score) => setFindingDraft({ node, score })}
            onReference={setReferencePreview}
          />
        ))}
        <aside className="inspection-review-notice">
          <strong>审核提示</strong>
          <span>{catalog.data?.reviewNotice}</span>
        </aside>
      </div>
      {findingDraft ? (
        <FindingCaptureDialog
          node={findingDraft.node}
          score={findingDraft.score}
          answer={answers[inspectionAnswerKey(findingDraft.node.moduleCode, findingDraft.node.code)]}
          onClose={() => setFindingDraft(null)}
          onReference={setReferencePreview}
          onConfirm={({ answer, files }) => {
            updateAnswer(findingDraft.node, { score: findingDraft.score, ...answer });
            setPhotos((current) => ({
              ...current,
              [inspectionAnswerKey(findingDraft.node.moduleCode, findingDraft.node.code)]: files,
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
  onFinding: (node: InspectionCatalogNode, score: 1 | 2) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const abnormal = moduleCode === "abnormalAnimalAssessment";
  return (
    <section
      className="panel inspection-module-panel"
      data-module={moduleCode}
      aria-labelledby={`inspection-module-${moduleCode}`}
    >
      <div className="panel-head">
        <div className="panel-title-line">
          <h2 id={`inspection-module-${moduleCode}`}>{MODULE_LABELS[moduleCode]}</h2>
          <HelpTooltip label={`${MODULE_LABELS[moduleCode]}评分说明`}>
            {abnormal
              ? "未勾选异常默认视为 3 分；发现异常后补充严重度、定位与照片。"
              : "每个条目均需完成 1 至 3 分评分，1 分和 2 分将自动创建异常处置项。"}
          </HelpTooltip>
        </div>
      </div>
      {groupedItems(nodes, moduleCode).map(([category, items]) => (
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
  onFinding: (node: InspectionCatalogNode, score: 1 | 2) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const answered = items.filter((node) => Boolean(answerMap[inspectionAnswerKey(moduleCode, node.code)])).length;
  const findings = items.filter(
    (node) => (answerMap[inspectionAnswerKey(moduleCode, node.code)]?.score || 3) < 3,
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
          <span
            className={`inspection-category-state ${findings ? "has-findings" : answered === items.length ? "complete" : ""}`}
          >
            {stateLabel}
          </span>
          <button
            className="secondary inspection-all-normal"
            type="button"
            onClick={() => items.forEach((node) => onAnswer(node, { score: 3 }))}
          >
            无异常
          </button>
        </div>
      </div>
      <details className="inspection-category-details">
        <summary>
          <span>展开检查</span>
          <span>{items.length} 项</span>
        </summary>
        <div className="inspection-category-items">
          {items.map((node) => {
            const key = inspectionAnswerKey(moduleCode, node.code);
            const answer = answerMap[key];
            const score = answer?.score || 3;
            const criteria = node.config?.scoringCriteria || {};
            const images = node.config?.referenceImages || [];
            return (
              <article className={`inspection-node ${score < 3 ? "has-finding" : ""}`} key={node.code}>
                <div className="inspection-node-main">
                  <div className="inspection-node-title">
                    <strong>{node.name}</strong>
                    {images.length ? (
                      <button
                        className="inspection-reference-trigger"
                        type="button"
                        onClick={() => onReference({ images, initialIndex: 0, title: node.name })}
                      >
                        图例 {images.length}
                      </button>
                    ) : null}
                  </div>
                  <div className="inspection-score-options" role="group" aria-label={`${node.name}评分`}>
                    {[3, 2, 1].map((value) => {
                      const description = criteria[String(value)]?.description;
                      const tooltipId = `inspection-score-${moduleCode}-${node.code}-${value}`;
                      return (
                        <label key={value}>
                          <input
                            aria-describedby={description ? tooltipId : undefined}
                            checked={score === value}
                            name={key}
                            type="radio"
                            onChange={() =>
                              value === 3 ? onAnswer(node, { score: 3 }) : onFinding(node, value as 1 | 2)
                            }
                          />
                          {description ? (
                            <Tooltip content={description} id={tooltipId}>
                              <span className="inspection-score-label">{value} 分</span>
                            </Tooltip>
                          ) : (
                            <span className="inspection-score-label">{value} 分</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {node.description ? <p>{node.description}</p> : null}
                </div>
                {score < 3 ? (
                  <div className="inspection-finding-summary">
                    <strong>{score === 1 ? "严重异常" : "轻微异常"}</strong>
                    <span>
                      {answer?.locationHint || answer?.animalIdentifier || answer?.note || "已登记，可点击评分修改。"}
                    </span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </details>
    </section>
  );
}
