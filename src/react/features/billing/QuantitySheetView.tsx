import type { ReactNode } from "react";
import { Switch } from "antd";
import type { SessionUser } from "../../api/contracts";
import { Tooltip } from "../../components/Tooltip";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { ActionButton, CommandBar, ModalPresence } from "../../components/ui";
import { AsyncActionButton, ModalShell, PageSkeleton } from "../../components/WorkspaceUi";
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
  const editor = useQuantitySheetEditor(user, mode);
  const {
    draft,
    editorRows,
    initialLoading,
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
            >
              保存统计表
            </AsyncActionButton>
          </Tooltip>
        }
      />
    ) : null;

  if (initialLoading) return <PageSkeleton label="数量统计表" variant="form" />;

  return (
    <section className="billing-layout quantity-billing-layout react-quantity-layout">
      {entryToolbar}
      {mode === "entry" ? (
        <QuantitySheetEditorForm editor={editor} user={user} mode={mode} />
      ) : (
        <SavedQuantitySheets onEdit={loadForEdit} navigationAction={navigationAction} />
      )}
      <ModalPresence>
        {mode === "saved" && editingDialog ? (
          <ModalShell key={draft.id} ariaLabel="编辑数量统计表" className="quantity-edit-modal" onClose={closeEditor}>
            <div className="modal-shell-head">
              <div>
                <h2>编辑数量统计表</h2>
                <p>
                  {draft.month} · {draft.iacuc}
                </p>
              </div>
              <ActionButton onClick={closeEditor}>关闭</ActionButton>
            </div>
            <div className="modal-shell-body">
              <div className="react-quantity-layout quantity-edit-context">
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
                        tone="primary"
                        type="submit"
                      >
                        保存统计表
                      </ActionButton>
                    </Tooltip>
                  }
                />
              </div>
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
