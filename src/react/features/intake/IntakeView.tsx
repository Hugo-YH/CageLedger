import { useMemo } from "react";
import { Alert, Button } from "antd";

import type { IntakeBatch, SessionUser } from "../../api/contracts";
import { useRooms } from "../../api/infrastructure";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { ActionButton } from "../../components/ui";
import { AsyncActionButton, PageSkeleton, PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { useSelectionScope } from "../../hooks/useSelectionScope";
import { isDirectSampling } from "../../../domain/intake";
import { planIntakeCardPrint, type IntakePrintRoom } from "../../print/intakeCards";
import type { WorkspaceView } from "../../state/ui";
import { IntakeBatchList, IntakeEntryPanel } from "./components/IntakePanels";
import { IntakeEditorDialog, type IntakeEditorFormProps } from "./components/IntakeEditorDialog";
import { IntakeActionDialogs } from "./components/IntakeActionDialogs";
import { useIntakeEditor } from "./hooks/useIntakeEditor";
import { useIntakeSaveFlow } from "./hooks/useIntakeSaveFlow";
import { useIntakePrintActions } from "./hooks/useIntakePrintActions";
import { useIntakeBatchActions } from "./hooks/useIntakeBatchActions";
import { useIntakeBatchPage } from "./hooks/useIntakeBatchPage";
import { useIntakeSelection } from "./hooks/useIntakeSelection";
import { useIntakeRecognitionMerge } from "./hooks/useIntakeRecognitionMerge";
import { useIntakeMessageRecognition } from "./hooks/useIntakeMessageRecognition";
import type { IntakeSaveIntent } from "./intakeViewTypes";

export function IntakeView({
  user,
  mode,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
  mode: "entry" | "batches";
}) {
  const page = useIntakeBatchPage(mode);
  const selection = useIntakeSelection();
  const roomQuery = useRooms(mode === "entry" || Boolean(page.data));
  const roomNames = useMemo(
    () => roomQuery.data?.items.map((room) => room.name).filter(Boolean) || [],
    [roomQuery.data],
  );
  const printRooms: IntakePrintRoom[] = useMemo(
    () => roomQuery.data?.items.map((room) => ({ name: room.name, facility: room.facility || "" })) || [],
    [roomQuery.data],
  );
  const roomsAvailable = Boolean(roomQuery.data);
  const roomsReady = roomsAvailable && !roomQuery.isError;
  const editor = useIntakeEditor({ user, mode, roomNames, roomsReady, updateSelection: selection.update });
  const actions = useIntakeBatchActions(selection, () => page.query.refetch());
  const saves = useIntakeSaveFlow({
    mode,
    revision: editor.revision,
    snapshotImages: editor.recognition.snapshot,
    isCurrent: editor.isCurrent,
    onError: editor.setNotice,
    invalidate: editor.invalidate,
    onSaved: completeSave,
  });
  const printer = useIntakePrintActions({
    editor,
    saves,
    roomNames,
    printRooms,
    markPrinted: actions.markPrinted,
    showBulkNotice: actions.showBulkNotice,
  });
  const merge = useIntakeRecognitionMerge({
    revision: editor.revision,
    save: saves.mutation,
    saveInFlight: saves.inFlight,
    snapshotImages: editor.recognition.snapshot,
    duplicate: saves.pendingDuplicate,
    onCloseReview: saves.clearDuplicate,
    onAcknowledge: () => {
      editor.startNew();
      editor.setDialogOpen(false);
      editor.setNotice("已确认预约已登记，原记录未改动。可继续录入下一批。");
    },
    onEdit: editor.editReviewed,
    onSaved: (item, intent, popup) => {
      selection.update([item]);
      if (intent?.print) return completeSave(intent, item, popup || null);
      editor.completeSavedDraft(intent || saves.capture(editor.draft, editor.editing), item, "原预约已补充");
      editor.setDialogOpen(false);
    },
  });
  const { parseMessage, aiParseMessage } = useIntakeMessageRecognition({
    draft: editor.draft,
    user,
    mode,
    editing: editor.editing,
    roomNames,
    revision: editor.revision,
    recognition: editor.recognition,
    requireRooms: editor.requireRooms,
    replaceDraft: editor.replaceDraft,
    setNotice: editor.setNotice,
    onTextRecognized: merge.preview,
  });
  useSelectionScope(
    page.scope,
    () => {
      selection.clear();
      printer.clearSelection();
      actions.clearScope();
    },
    selection.selectedItems.length > 0 || selection.selectingAll,
  );

  function completeSave(intent: IntakeSaveIntent, item: IntakeBatch, popup: Window | null): void | Promise<void> {
    if (intent.print) return printer.completeSavedPrint(intent, item, popup);
    editor.completeSavedDraft(intent, item);
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const item = editor.prepareSave();
    if (item) void saves.run(saves.capture(item, editor.editing));
  }

  const mergeFeedback = merge.state?.checking ? (
    <Alert showIcon type="info" title="正在核对已有预约…" />
  ) : merge.state?.error ? (
    <Alert
      showIcon
      type="error"
      title="已有预约匹配失败"
      description={`${merge.state.error} 本次草稿和图片已保留。`}
      action={<Button onClick={merge.retry}>重试匹配</Button>}
    />
  ) : null;
  const roomFeedback = !roomsReady ? (
    <Alert
      role={roomQuery.isError ? "alert" : "status"}
      showIcon
      type={roomQuery.isError ? "error" : "info"}
      title={
        roomQuery.isError
          ? "房间信息加载失败；列表仍可浏览，请重试后编辑、识别或打印。"
          : "正在加载房间信息；列表可先浏览。"
      }
      action={
        roomQuery.isError ? (
          <Button loading={roomQuery.isFetching} onClick={() => void roomQuery.refetch()}>
            重试房间信息
          </Button>
        ) : undefined
      }
    />
  ) : null;
  const form: IntakeEditorFormProps = {
    editing: editor.editing,
    draft: editor.draft,
    roomNames,
    notice: editor.notice,
    saving: saves.mutation.isPending || editor.recognition.reading || printer.preparing,
    aiPending: editor.recognition.pending || editor.recognition.reading,
    recognitionImages: editor.recognition.images,
    recognitionError: editor.recognition.error,
    onAddImages: (files) => void editor.recognition.addFiles(files),
    onRemoveImage: editor.recognition.remove,
    onSubmit: submit,
    onAiParse: () => void aiParseMessage(),
    onParse: () => void parseMessage(),
    onPrint: printer.printCurrentBatch,
    onUpdate: editor.update,
    roomsReady,
  };
  const selectedPrintPlan = planIntakeCardPrint(selection.selectedItems, printRooms);

  return (
    <section className="workspace-view intake-workspace react-intake-view" data-feature="intake">
      <div className="workspace-body intake-workspace-body">
        <section className="billing-layout quantity-billing-layout intake-layout">
          {roomFeedback}
          {mode === "entry" ? mergeFeedback : null}
          {mode === "batches" && page.query.isError ? (
            <PageState
              title="待接收批次更新失败"
              detail="已加载内容和选择已保留，请重试后继续操作。"
              retry={() => void page.query.refetch()}
            />
          ) : null}
          {mode === "entry" ? (
            <WorkspaceToolbar
              ariaLabel="笼卡录入操作"
              sticky
              title={isDirectSampling(editor.draft) ? "直接取材预约" : editor.editing ? "编辑接收笼卡" : "接收笼卡"}
              actions={
                <ActionButton
                  icon={<ActionIcon name="create" />}
                  disabled={saves.mutation.isPending}
                  onClick={editor.startNew}
                >
                  新建批次
                </ActionButton>
              }
              primaryAction={
                <AsyncActionButton
                  icon={<ActionIcon name="save" />}
                  className="primary"
                  type="submit"
                  form="intake-entry-panel"
                  disabled={!roomsReady || editor.recognition.reading}
                  pending={saves.mutation.isPending}
                  pendingLabel="保存中..."
                >
                  保存待接收批次
                </AsyncActionButton>
              }
            />
          ) : null}
          {mode === "entry" ? (
            roomsAvailable ? (
              <IntakeEntryPanel {...form} headActions={null} />
            ) : (
              <PageSkeleton compact label="房间信息" variant="form" />
            )
          ) : !page.data ? (
            <>
              <WorkspaceToolbar title="待接收批次列表" ariaLabel="待接收批次列表" />
              {page.query.isPending ? <PageSkeleton label="待接收批次" variant="table" /> : null}
            </>
          ) : (
            <IntakeBatchList
              total={page.data.page.total}
              selectedItems={selection.selectedItems}
              items={page.data.items}
              loading={page.blocked}
              selectingAll={selection.selectingAll}
              allFilteredSelected={selection.allFilteredSelected}
              bulkNotice={selection.error || actions.bulkNotice}
              bulkNoticeKind={selection.error ? "error" : actions.bulkNoticeKind}
              markingPrinted={actions.markingPrinted}
              preparingPrint={printer.preparing}
              markingReceived={actions.markingReceived}
              printDisabledReason={roomsReady ? selectedPrintPlan.disabledReason : "房间信息尚未就绪，请等待或重试。"}
              page={page.page}
              pageSize={page.pageSize}
              params={page.params}
              filters={page.filters}
              onClearSelection={selection.clear}
              onToggleAll={() => void selection.toggleAll(page.params)}
              onToggleItem={selection.toggle}
              onSort={page.onSort}
              onFilter={page.onFilter}
              onPrint={(targets) => printer.requestPrint(targets)}
              onMarkPrinted={(targets) => void actions.markPrinted(targets)}
              onReceive={actions.beginReceive}
              onEdit={editor.edit}
              onDelete={actions.setDeleteTarget}
              onPage={page.setPage}
              onPageSize={page.onPageSize}
            />
          )}
        </section>
      </div>
      <IntakeEditorDialog
        editor={editor}
        form={form}
        roomFeedback={roomFeedback}
        mergeFeedback={mergeFeedback}
        saving={saves.mutation.isPending}
        roomsReady={roomsReady}
      />
      <IntakeActionDialogs actions={actions} printer={printer} saves={saves} merge={merge} />
    </section>
  );
}
