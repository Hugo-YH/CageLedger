import type { ComponentProps, ReactNode } from "react";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import { ActionButton, ModalPresence } from "../../../components/ui";
import { ModalShell, PageSkeleton, PageState } from "../../../components/WorkspaceUi";
import { IntakeEntryPanel } from "./IntakePanels";
import type { useIntakeEditor } from "../hooks/useIntakeEditor";

export type IntakeEditorFormProps = Omit<ComponentProps<typeof IntakeEntryPanel>, "headActions">;

export function IntakeEditorDialog({
  editor,
  form,
  roomFeedback,
  mergeFeedback,
  saving,
  roomsReady,
}: {
  editor: ReturnType<typeof useIntakeEditor>;
  form: IntakeEditorFormProps;
  roomFeedback: ReactNode;
  mergeFeedback: ReactNode;
  saving: boolean;
  roomsReady: boolean;
}) {
  return (
    <ModalPresence>
      {editor.dialogOpen ? (
        <ModalShell key="intake-editor" ariaLabel="编辑待接收批次" className="intake-edit-modal" onClose={editor.close}>
          <div className="modal-shell-head">
            <div>
              <h2>编辑待接收批次</h2>
              <p>{editor.editRead.target?.batchNo || editor.draft.batchNo}</p>
            </div>
            <ActionButton onClick={editor.close}>关闭</ActionButton>
          </div>
          <div className="modal-shell-body">
            {roomFeedback}
            {mergeFeedback}
            {editor.editRead.target ? (
              editor.editRead.error ? (
                <PageState
                  title="批次详情加载失败"
                  detail={editor.editRead.error.message}
                  retry={editor.editRead.retry}
                />
              ) : (
                <PageSkeleton compact label="批次详情与房间信息" variant="form" />
              )
            ) : (
              <IntakeEntryPanel
                {...form}
                headActions={
                  <ActionButton
                    icon={<ActionIcon name="save" />}
                    disabled={!roomsReady || editor.recognition.reading}
                    loading={saving}
                    tone="primary"
                    type="submit"
                  >
                    保存待接收批次
                  </ActionButton>
                }
              />
            )}
          </div>
        </ModalShell>
      ) : null}
    </ModalPresence>
  );
}
