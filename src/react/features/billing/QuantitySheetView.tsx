import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Switch } from "antd";
import type { SessionUser } from "../../api/contracts";
import { useQuantitySheetDetail } from "../../api/quantitySheets";
import { Tooltip } from "../../components/Tooltip";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { ActionButton, CommandBar, ModalPresence } from "../../components/ui";
import { AsyncActionButton, ModalShell, PageSkeleton, PageState } from "../../components/WorkspaceUi";
import { ConfirmSave } from "./components/QuantitySheetModals";
import { SavedQuantitySheets } from "./components/SavedQuantitySheets";
import { QuantitySheetEditorForm } from "./components/QuantitySheetEditorForm";
import { useQuantitySheetEditor } from "./hooks/useQuantitySheetEditor";
import { saveHint } from "./quantitySheetEditorModel";

export function QuantitySheetView({
  user,
  mode,
  navigationAction,
}: {
  user: SessionUser;
  mode: "entry" | "saved";
  navigationAction?: ReactNode;
}) {
  const [editingId, setEditingId] = useState("");
  const editor = useQuantitySheetEditor(user, mode, Boolean(editingId));
  const editingDetail = useQuantitySheetDetail(editingId);
  const {
    draft,
    editorRows,
    initialLoading,
    metadataLoading,
    metadataError,
    metadataHasData,
    metadataReady,
    retryMetadata,
    unit,
    animalDetails,
    setField,
    save,
    startNew,
    loadForEdit,
    editingDialog,
    closeEditor,
    confirmSave,
    setConfirmSave,
    selectedRoom,
    persistSheet,
  } = editor;
  const openEditor = useCallback((id: string) => setEditingId(id), []);
  const dismissEditor = useCallback(() => {
    setEditingId("");
    closeEditor();
  }, [closeEditor]);

  useEffect(() => {
    if (!editingId || !editingDetail.data?.item) return;
    loadForEdit(editingDetail.data.item);
    setEditingId("");
  }, [editingDetail.data, editingId, loadForEdit]);

  const entryToolbar =
    mode === "entry" ? (
      <CommandBar
        ariaLabel="数量统计表录入操作"
        title="录入数量统计表"
        className="quantity-entry-toolbar"
        sticky
        context={
          <Tooltip
            content={unit === "animal_day" ? "当前房间按只/天计费，动物数量必须填写。" : "打开后记录动物数量变化。"}
          >
            <div
              className={`quantity-animal-control ${animalDetails ? "enabled" : ""} ${unit === "animal_day" ? "required locked" : ""}`}
            >
              <Switch
                aria-label="动物数量"
                checked={animalDetails}
                disabled={unit === "animal_day"}
                onChange={(checked) => setField("animalDetailEnabled", checked)}
              />
              <span>动物数量</span>
            </div>
          </Tooltip>
        }
        actions={
          <>
            {navigationAction}
            <ActionButton icon={<ActionIcon name="create" />} onClick={startNew}>
              新建
            </ActionButton>
          </>
        }
        primaryAction={
          <Tooltip content={saveHint(editorRows, animalDetails)}>
            <AsyncActionButton
              icon={<ActionIcon name="save" />}
              className="primary quantity-entry-save-button"
              type="submit"
              form="quantity-sheet-entry-form"
              pending={save.isPending}
              pendingLabel="保存中..."
              disabled={!metadataReady}
            >
              保存统计表
            </AsyncActionButton>
          </Tooltip>
        }
      />
    ) : null;

  if (initialLoading)
    return (
      <section className="billing-layout quantity-billing-layout react-quantity-layout">
        {entryToolbar}
        <PageSkeleton embedded label="数量统计表" variant="form" />
      </section>
    );
  if (mode === "entry" && metadataError && !metadataHasData) {
    return (
      <section className="billing-layout quantity-billing-layout react-quantity-layout">
        {entryToolbar}
        <PageState title="房间或负责人配置加载失败" retry={retryMetadata} />
      </section>
    );
  }

  return (
    <section className="billing-layout quantity-billing-layout react-quantity-layout">
      {entryToolbar}
      {mode === "entry" && metadataError && metadataHasData ? (
        <Alert
          role="alert"
          type="error"
          showIcon
          title="房间或负责人配置更新失败，草稿已保留"
          action={<Button onClick={retryMetadata}>重试</Button>}
        />
      ) : null}
      {mode === "entry" ? (
        <QuantitySheetEditorForm editor={editor} user={user} mode={mode} />
      ) : (
        <SavedQuantitySheets onEdit={openEditor} navigationAction={navigationAction} />
      )}
      <ModalPresence>
        {mode === "saved" && (editingId || editingDialog) ? (
          <ModalShell ariaLabel="编辑数量统计表" className="quantity-edit-modal" onClose={dismissEditor}>
            <div className="modal-shell-head">
              <div>
                <h2>编辑数量统计表</h2>
                <p>
                  {editingId
                    ? editingDetail.isError
                      ? "读取失败，可重试或关闭。"
                      : "正在读取统计表…"
                    : `${draft.month} · ${draft.iacuc}`}
                </p>
              </div>
              <ActionButton onClick={dismissEditor}>关闭</ActionButton>
            </div>
            <div className="modal-shell-body">
              {editingId ? (
                editingDetail.isError ? (
                  <PageState
                    title="数量统计表加载失败"
                    detail={editingDetail.error?.message}
                    retry={() => void editingDetail.refetch()}
                  />
                ) : (
                  <PageSkeleton compact label="编辑数量统计表" rows={4} variant="form" />
                )
              ) : metadataError && !metadataHasData ? (
                <PageState title="房间或负责人配置加载失败" retry={retryMetadata} />
              ) : metadataLoading && !metadataHasData ? (
                <PageSkeleton compact label="房间与负责人配置" rows={4} variant="form" />
              ) : (
                <div className="react-quantity-layout quantity-edit-context">
                  {metadataError ? (
                    <Alert
                      role="alert"
                      type="error"
                      showIcon
                      title="房间或负责人配置更新失败，草稿已保留"
                      action={<Button onClick={retryMetadata}>重试</Button>}
                    />
                  ) : null}
                  <QuantitySheetEditorForm
                    editor={editor}
                    user={user}
                    mode={mode}
                    headActions={
                      <Tooltip content={saveHint(editorRows, animalDetails)}>
                        <ActionButton
                          icon={<ActionIcon name="save" />}
                          form="quantity-sheet-entry-form"
                          loading={save.isPending}
                          disabled={!metadataReady}
                          tone="primary"
                          type="submit"
                        >
                          保存统计表
                        </ActionButton>
                      </Tooltip>
                    }
                  />
                </div>
              )}
            </div>
          </ModalShell>
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {confirmSave ? (
          <ConfirmSave
            key={confirmSave.id}
            sheet={confirmSave}
            room={selectedRoom}
            onCancel={() => setConfirmSave(null)}
            onConfirm={() => void persistSheet()}
            pending={save.isPending}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
