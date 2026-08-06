import { Alert, Descriptions, Empty, Modal, Tag, Typography } from "antd";

import type { InspectionCatalogDiff } from "../../api/contracts";

const CHANGE_LABELS = {
  added: { text: "新增", color: "green" },
  modified: { text: "修改", color: "orange" },
  removed: { text: "删除", color: "red" },
} as const;

export function InspectionPublishModal({
  open,
  diff,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  diff: InspectionCatalogDiff;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const changedCount = diff.added + diff.modified + diff.removed;
  return (
    <Modal
      className="inspection-publish-modal"
      open={open}
      title="发布巡检标准目录"
      okText="确认发布"
      cancelText="再检查一下"
      confirmLoading={pending}
      onCancel={onCancel}
      onOk={onConfirm}
      width={560}
    >
      <Alert
        type="warning"
        showIcon
        title="发布后新版本立即生效"
        description="旧版本转为历史版本并保留，录入表单与巡检标准页将使用新目录；已提交的巡检记录引用旧目录，不受影响。"
      />
      <Descriptions className="inspection-publish-summary" column={3} size="small">
        <Descriptions.Item label="新增">
          <Typography.Text type="success">{diff.added}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="修改">
          <Typography.Text type="warning">{diff.modified}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="删除">
          <Typography.Text type="danger">{diff.removed}</Typography.Text>
        </Descriptions.Item>
      </Descriptions>
      <Typography.Paragraph type="secondary" className="inspection-publish-count">
        共 {changedCount} 处内容变化，发布后不可直接撤销，可通过历史版本回滚。
      </Typography.Paragraph>
      {diff.nodes.length ? (
        <div className="inspection-publish-diff-list">
          {diff.nodes.map((item) => {
            const label = CHANGE_LABELS[item.change];
            return (
              <div className={`inspection-publish-diff-item is-${item.change}`} key={`${item.change}-${item.code}`}>
                <Tag color={label.color}>{label.text}</Tag>
                <Typography.Text code>{item.code}</Typography.Text>
                <Typography.Text ellipsis className="inspection-publish-diff-name">
                  {item.name}
                </Typography.Text>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有内容变化" />
      )}
    </Modal>
  );
}
