import { App, Button, Modal, Popconfirm, Space, Tag, Typography } from "antd";
import { RollbackOutlined } from "@ant-design/icons";

import { PageSkeleton } from "../../components/WorkspaceUi";
import { useAnimalInspectionCatalogVersions, useRestoreInspectionCatalogVersion } from "../../api/animalManagement";

export function InspectionVersionHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const versions = useAnimalInspectionCatalogVersions(open);
  const restore = useRestoreInspectionCatalogVersion();

  function handleRestore(version: string) {
    restore.mutate(version, {
      onSuccess: () => {
        message.success("已回滚并发布为新版本");
        onClose();
      },
      onError: (error) => {
        message.error(error instanceof Error ? error.message : "回滚失败");
      },
    });
  }

  const items = versions.data?.items || [];
  return (
    <Modal
      className="inspection-version-modal"
      open={open}
      title="目录版本历史"
      onCancel={onClose}
      footer={null}
      width={680}
    >
      {versions.isLoading ? (
        <PageSkeleton compact label="巡检版本" rows={3} variant="detail" />
      ) : items.length === 0 ? (
        <Typography.Text type="secondary">暂无版本记录</Typography.Text>
      ) : (
        <div className="inspection-version-list">
          {items.map((item) => {
            const isActive = item.isActive;
            return (
              <div className={`inspection-version-row${isActive ? " is-active" : ""}`} key={item.version}>
                <div className="inspection-version-meta">
                  <Space size={8} wrap>
                    <Typography.Text code>{item.version}</Typography.Text>
                    <Tag color={isActive ? "green" : "default"}>{isActive ? "当前生效" : "历史"}</Tag>
                  </Space>
                  <Typography.Text type="secondary">{item.source}</Typography.Text>
                  <Typography.Text type="secondary">
                    {item.importedAt.replace("T", " ").slice(0, 16)} · {item.nodeCount} 条巡检内容
                  </Typography.Text>
                </div>
                <Popconfirm
                  title="回滚到该版本？"
                  description="该版本内容将发布为新版本并立即生效，当前生效版本转为历史。"
                  okText="确认回滚"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={isActive || restore.isPending}
                  onConfirm={() => handleRestore(item.version)}
                >
                  <Button size="small" icon={<RollbackOutlined />} disabled={isActive || restore.isPending}>
                    回滚
                  </Button>
                </Popconfirm>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
