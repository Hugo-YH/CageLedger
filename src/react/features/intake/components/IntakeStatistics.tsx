import { BarChartOutlined, CalendarOutlined, CopyOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Collapse, Flex, Skeleton, Space, Statistic, Tag, Typography } from "antd";
import { useMemo, useRef, useState } from "react";

import type { IntakeBatch } from "../../../api/contracts";
import { useIntakeStatisticsPrincipals } from "../../../api/intakeStatistics";
import {
  buildIntakeStatistics,
  intakeStatisticsAnimals,
  intakeStatisticsCages,
  intakeStatisticsCode,
  intakeStatisticsDate,
  intakeStatisticsPersonName,
  intakeStatisticsText,
  type IntakeStatisticsPerson,
} from "../../../../domain/intakeStatistics";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import { Modal, ModalPresence } from "../../../components/ui";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import { copyTextToClipboard } from "../../../utils/clipboard";

export function IntakeStatistics({ selectedItems, disabled }: { selectedItems: IntakeBatch[]; disabled: boolean }) {
  const [snapshot, setSnapshot] = useState<IntakeBatch[] | null>(null);
  return (
    <>
      <Button
        icon={<BarChartOutlined aria-hidden />}
        disabled={disabled || !selectedItems.length}
        onClick={() => setSnapshot(selectedItems.map((item) => ({ ...item })))}
      >
        统计
      </Button>
      <ModalPresence>
        {snapshot ? <IntakeStatisticsModal items={snapshot} onClose={() => setSnapshot(null)} /> : null}
      </ModalPresence>
    </>
  );
}

function IntakeStatisticsModal({ items, onClose }: { items: IntakeBatch[]; onClose: () => void }) {
  const codes = useMemo(
    () => [...new Set(items.map((item) => intakeStatisticsCode(item.iacuc)).filter(Boolean))].sort(),
    [items],
  );
  const projects = useIntakeStatisticsPrincipals(codes);
  const report = useMemo(() => buildIntakeStatistics(items, projects.data || {}), [items, projects.data]);
  const waiting = codes.length > 0 && projects.isPending;
  const unavailable = waiting || projects.isFetching || projects.isError;
  const unresolved = Object.values(projects.data || {}).some((item) => item.issue);
  const { message } = App.useApp();
  const latest = useLatestRequest();
  const copying = useRef(false);
  const [copyPending, setCopyPending] = useState(false);

  async function copyReport() {
    if (copying.current || unavailable) return;
    copying.current = true;
    setCopyPending(true);
    const isCurrent = latest.begin();
    try {
      const copied = await copyTextToClipboard(intakeStatisticsText(report));
      if (!isCurrent()) return;
      if (copied) void message.success("统计结果已复制");
      else void message.error("复制失败，请允许浏览器访问剪贴板后重试。");
    } finally {
      copying.current = false;
      if (isCurrent()) setCopyPending(false);
    }
  }

  return (
    <Modal
      open
      centered
      width={760}
      title={
        <Space>
          <BarChartOutlined aria-hidden />
          接收批次统计
        </Space>
      }
      onCancel={onClose}
      footer={
        <Flex className="intake-statistics-footer" align="center" justify="space-between" gap={12} wrap>
          <Typography.Text type="secondary">仅统计本次勾选的 {report.batches} 批</Typography.Text>
          <Space>
            <Button onClick={onClose}>关闭</Button>
            <Button
              type="primary"
              icon={<CopyOutlined aria-hidden />}
              disabled={unavailable}
              loading={copyPending}
              onClick={() => void copyReport()}
            >
              复制统计结果
            </Button>
          </Space>
        </Flex>
      }
    >
      <div data-feature="intake" className="intake-statistics">
        <Typography.Paragraph type="secondary" className="intake-statistics-description">
          按预约接收日期、饲养间和项目负责人汇总。笼数以最终笼卡张数为准，直接取材单独统计。
        </Typography.Paragraph>
        {waiting ? (
          <div role="status" aria-label="正在查询项目汇总表负责人">
            <Typography.Paragraph>正在查询项目汇总表负责人…</Typography.Paragraph>
            <Skeleton active paragraph={{ rows: 5 }} />
          </div>
        ) : projects.isError ? (
          <Alert
            type="error"
            showIcon
            title="无法查询项目负责人"
            action={<Button onClick={() => void projects.refetch()}>重试</Button>}
          />
        ) : (
          <>
            <div className="intake-statistics-overview">
              <Card size="small" className="intake-statistics-metric intake-statistics-metric-primary">
                <Statistic
                  title={report.unknownCages ? "已确定饲养笼数" : "饲养笼数"}
                  value={report.cages}
                  suffix="笼"
                />
                <Typography.Text type="secondary">
                  {report.unknownCages ? `另有 ${report.unknownCages} 批笼数待确认` : "按最终笼卡张数统计"}
                </Typography.Text>
              </Card>
              <Card size="small" className="intake-statistics-metric">
                <Statistic title="已选批次" value={report.batches} suffix="批" />
                <Typography.Text type="secondary">共 {report.days.length} 个接收日期分组</Typography.Text>
              </Card>
              <Card size="small" className="intake-statistics-metric">
                <Statistic title="直接取材" value={report.animals} suffix="只" />
                <Typography.Text type="secondary">
                  {report.samplingBatches} 批 · 不计笼数{report.unknownAnimals ? " · 数量待确认" : ""}
                </Typography.Text>
              </Card>
            </div>
            {report.issues.length ? (
              <Alert
                type="warning"
                showIcon
                title={`有 ${report.issues.length} 批信息待确认`}
                description="这些批次仍在下方列出；未确定的笼数或只数不计入已知合计。"
                action={
                  unresolved ? (
                    <Button
                      size="small"
                      icon={<ActionIcon name="refresh" />}
                      loading={projects.isFetching}
                      onClick={() => void projects.refetch()}
                    >
                      重新查询
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {projects.isFetching ? <Typography.Text role="status">正在重新查询项目负责人…</Typography.Text> : null}
            {report.days.map((day) => (
              <Card
                key={day.date}
                size="small"
                className="intake-statistics-day"
                title={
                  <Flex align="center" justify="space-between" gap={8} wrap>
                    <Space>
                      <CalendarOutlined aria-hidden />
                      <span>{intakeStatisticsDate(day.date)}</span>
                    </Space>
                    <Typography.Text className="intake-statistics-count">{intakeStatisticsCages(day)}</Typography.Text>
                  </Flex>
                }
              >
                {day.rooms.map((room) => (
                  <section
                    key={room.name}
                    className="intake-statistics-room"
                    aria-label={`${intakeStatisticsDate(day.date)} ${room.name}`}
                  >
                    <Flex
                      className="intake-statistics-room-heading"
                      align="center"
                      justify="space-between"
                      gap={8}
                      wrap
                    >
                      <Typography.Text strong>{room.name}</Typography.Text>
                      <Typography.Text strong className="intake-statistics-count">
                        {intakeStatisticsCages(room)}
                      </Typography.Text>
                    </Flex>
                    <PeopleRows people={room.people} />
                  </section>
                ))}
                {day.samplingBatches ? (
                  <section className="intake-statistics-room" aria-label={`${intakeStatisticsDate(day.date)} 直接取材`}>
                    <Flex
                      className="intake-statistics-room-heading"
                      align="center"
                      justify="space-between"
                      gap={8}
                      wrap
                    >
                      <Space>
                        <Tag color="blue">直接取材</Tag>
                        <Typography.Text type="secondary">无需笼卡</Typography.Text>
                      </Space>
                      <Typography.Text strong className="intake-statistics-count">
                        {day.samplingBatches} 批 · {intakeStatisticsAnimals(day)}
                      </Typography.Text>
                    </Flex>
                    <PeopleRows people={day.sampling} sampling />
                  </section>
                ) : null}
              </Card>
            ))}
            {report.issues.length ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: "issues",
                    label: `查看待确认明细（${report.issues.length} 批）`,
                    children: (
                      <ul className="intake-statistics-issues">
                        {report.issues.map((issue) => (
                          <li key={issue.id}>
                            <Typography.Text strong>{issue.batchNo}</Typography.Text>
                            <Typography.Text type="secondary"> · {issue.iacuc || "IACUC 未填写"}</Typography.Text>
                            <div>{issue.reasons.join("；")}</div>
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]}
              />
            ) : null}
            <Typography.Text type="secondary" className="intake-statistics-note">
              项目负责人以项目汇总表为准。复制内容包含全部日期分组及待确认信息。
            </Typography.Text>
          </>
        )}
      </div>
    </Modal>
  );
}

function PeopleRows({ people, sampling = false }: { people: IntakeStatisticsPerson[]; sampling?: boolean }) {
  return (
    <ul className="intake-statistics-people">
      {people.map((person) => (
        <li key={person.key}>
          <Typography.Text type={person.pi ? undefined : "warning"} className="intake-statistics-person-name">
            {intakeStatisticsPersonName(person)}
          </Typography.Text>
          <span className="intake-statistics-person-total">
            <Typography.Text type="secondary">{person.batches} 批</Typography.Text>
            <Typography.Text strong className="intake-statistics-count">
              {sampling ? intakeStatisticsAnimals(person) : intakeStatisticsCages(person)}
            </Typography.Text>
          </span>
        </li>
      ))}
    </ul>
  );
}
