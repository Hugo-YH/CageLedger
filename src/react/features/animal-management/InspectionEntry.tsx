import { ActionIcon } from "../../components/ui/ActionIcon";
import { useState } from "react";
import { Selector as MobileSelector } from "antd-mobile";
import { Alert, Button, Card, Checkbox, Form, Select, Space, Tag, Typography } from "antd";

import type { InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import { AsyncActionButton, PageSkeleton, PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { HelpTooltip } from "../../components/Tooltip";
import { ModalPresence } from "../../components/ui";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { WorkspaceView } from "../../state/ui";
import { FindingCaptureDialog, ReferenceImageDialog, type ReferencePreview } from "./InspectionDialogs";
import { InspectionModuleForm } from "./InspectionModuleForms";
import { useInspectionEntryEditor } from "./useInspectionEntryEditor";
import { inspectionAnswerKey, inspectionFacilityLabel, MODULE_LABELS } from "./model";

const moduleOrder: InspectionModuleCode[] = ["basicAssessment", "advancedAssessment", "abnormalAnimalAssessment"];

const MODULE_ANNOTATIONS: Partial<Record<InspectionModuleCode, string>> = {
  basicAssessment: "设施与福利",
  advancedAssessment: "操作与伦理",
  abnormalAnimalAssessment: "体况与外观",
};

export function InspectionEntry({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const [findingDraft, setFindingDraft] = useState<InspectionCatalogNode | null>(null);
  const [referencePreview, setReferencePreview] = useState<ReferencePreview | null>(null);
  const {
    draftId,
    facility,
    setFacility,
    roomId,
    setRoomId,
    modules,
    setModules,
    setModule,
    answers,
    setPhotos,
    operationError,
    pendingPhotos,
    uploadingPhotos,
    busy,
    catalog,
    bootstrap,
    detail,
    save,
    submit,
    facilities,
    facilityRooms,
    catalogNodes,
    updateAnswer,
    markNodesNormal,
    saveDraft,
    retryPhotos,
    submitInspection,
    ready,
  } = useInspectionEntryEditor();

  if (catalog.isError || bootstrap.isError || (!ready && detail.isError))
    return (
      <PageState
        title="巡检工作区加载失败"
        retry={() => {
          void Promise.allSettled([catalog.refetch(), bootstrap.refetch(), ...(draftId ? [detail.refetch()] : [])]);
        }}
      />
    );

  if (catalog.isLoading || bootstrap.isLoading || !ready) return <PageSkeleton label="巡检工作区" variant="form" />;

  const content = (
    <>
      {operationError ? <Alert showIcon role="alert" type="error" title={operationError} /> : null}
      {pendingPhotos.length ? (
        <Alert
          showIcon
          type="warning"
          title={`巡检已提交，${pendingPhotos.length} 张照片尚未上传`}
          description={pendingPhotos.map(({ file }) => file.name).join("、")}
          action={
            <Button loading={uploadingPhotos} onClick={() => void retryPhotos()}>
              重试上传照片
            </Button>
          }
        />
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
          <Form className="inspection-room-picker" component="div" layout="vertical">
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
          {isMobile ? (
            <MobileSelector
              className="inspection-module-selector"
              multiple
              columns={1}
              options={moduleOrder.map((code) => {
                const module = catalog.data?.modules.find((item) => item.code === code);
                return { label: module?.name || MODULE_LABELS[code], value: code };
              })}
              value={modules}
              onChange={(values) => setModules(values.map(String) as InspectionModuleCode[])}
            />
          ) : (
            <DesktopModulePicker catalog={catalog.data} modules={modules} onToggle={setModule} />
          )}
        </div>
      </Card>
      {modules.map((moduleCode) => (
        <InspectionModuleForm
          answerMap={answers}
          key={moduleCode}
          moduleCode={moduleCode}
          nodes={catalogNodes}
          onAnswer={updateAnswer}
          onMarkNormal={markNodesNormal}
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
    </>
  );
  const dialogs = (
    <>
      <ModalPresence>
        {findingDraft ? (
          <FindingCaptureDialog
            key={inspectionAnswerKey(findingDraft.moduleCode, findingDraft.code)}
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
      </ModalPresence>
      <ModalPresence>
        {referencePreview ? (
          <ReferenceImageDialog
            key={referencePreview.title}
            preview={referencePreview}
            onClose={() => setReferencePreview(null)}
          />
        ) : null}
      </ModalPresence>
    </>
  );
  return (
    <MobilePage
      titleInToolbar
      desktop={
        isMobile
          ? undefined
          : {
              className: "workspace-view animal-management-workspace",
              bodyClassName: "workspace-body animal-management-body",
              feature: "animal-management",
            }
      }
      feature="animal-management"
      onBack={() => navigate("animal-inspection-entry")}
      title="动物巡检"
    >
      <WorkspaceToolbar
        ariaLabel="巡检录入操作"
        title="动物巡检"
        sticky
        actions={
          <AsyncActionButton
            icon={<ActionIcon name="save" />}
            className="secondary inspection-save-draft"
            type="button"
            pending={save.isPending}
            pendingLabel="保存中..."
            disabled={busy || submit.isPending || uploadingPhotos || pendingPhotos.length > 0}
            onClick={() => void saveDraft()}
          >
            保存草稿
          </AsyncActionButton>
        }
        primaryAction={
          <AsyncActionButton
            icon={<ActionIcon name="send" />}
            className="primary inspection-submit"
            type="button"
            pending={submit.isPending}
            pendingLabel="提交中..."
            disabled={busy || save.isPending || uploadingPhotos || pendingPhotos.length > 0}
            onClick={() => void submitInspection()}
          >
            提交巡检
          </AsyncActionButton>
        }
      />
      {content}
      {dialogs}
    </MobilePage>
  );
}

function DesktopModulePicker({
  catalog,
  modules,
  onToggle,
}: {
  catalog?: { modules?: Array<{ code: string; name: string; description?: string }> } | null;
  modules: InspectionModuleCode[];
  onToggle: (code: InspectionModuleCode, checked: boolean) => void;
}) {
  return (
    <div className="inspection-module-picker" role="group" aria-label="评估模块">
      {moduleOrder.map((code) => {
        const module = catalog?.modules?.find((item) => item.code === code);
        return (
          <Card
            className={`inspection-module-choice ${modules.includes(code) ? "is-selected" : ""}`}
            data-module={code}
            key={code}
            size="small"
          >
            <div className="inspection-module-choice-content">
              <Checkbox checked={modules.includes(code)} onChange={(event) => onToggle(code, event.target.checked)}>
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
  );
}
