import { Alert, Button, Flex, Table, Typography } from "antd";
import { useRef, useState } from "react";

import type { IntakeBatchListItem } from "../../../api/contracts";
import { DateInput, Modal } from "../../../components/ui";

function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) > 0 &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function IntakeReceiptConfirmDialog({
  items,
  pending,
  error,
  blocked,
  onClose,
  onConfirm,
}: {
  items: IntakeBatchListItem[];
  pending: boolean;
  error: string;
  blocked: boolean;
  onClose: () => void;
  onConfirm: (dates: Record<string, string>) => Promise<void>;
}) {
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, validDate(item.intakeDate) ? item.intakeDate : ""])),
  );
  const busy = useRef(false);
  const ready = !blocked && items.every((item) => dates[item.id] && validDate(dates[item.id]));
  async function confirm() {
    if (!ready || busy.current) return;
    busy.current = true;
    try {
      await onConfirm(dates);
    } finally {
      busy.current = false;
    }
  }
  return (
    <Modal
      open
      title="确认实际接收日期"
      aria-label="确认实际接收日期"
      width={640}
      closable={!pending}
      keyboard={!pending}
      mask={{ closable: !pending }}
      onCancel={onClose}
      footer={
        <Flex justify="end" gap={8}>
          <Button disabled={pending} onClick={onClose}>
            {blocked ? "返回列表重新选择" : "取消"}
          </Button>
          <Button
            aria-label="确认已接收"
            type="primary"
            loading={pending}
            disabled={!ready}
            onClick={() => void confirm()}
          >
            确认已接收
          </Button>
        </Flex>
      }
    >
      <Flex data-feature="intake" vertical gap={16}>
        <Typography.Paragraph>
          共 {items.length} 个批次。日期按原记录预填，请按实际到货情况核对；确认后保存实际接收日期，预约日期保持不变。
        </Typography.Paragraph>
        <Table<IntakeBatchListItem>
          className="intake-receipt-confirm-table"
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={items}
          scroll={{ y: 360 }}
          columns={[
            { title: "批次号", dataIndex: "batchNo" },
            {
              title: "房间",
              dataIndex: "roomName",
              width: 80,
              responsive: ["md"],
              render: (value: string) => value || "—",
            },
            {
              title: "实际接收日期",
              width: 180,
              render: (_, item) => (
                <DateInput
                  label={`${item.batchNo} 实际接收日期`}
                  value={dates[item.id]}
                  required
                  disabled={pending}
                  onChange={(value) => setDates((current) => ({ ...current, [item.id]: value }))}
                />
              ),
            },
          ]}
        />
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </Flex>
    </Modal>
  );
}
