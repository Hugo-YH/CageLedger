import { Alert, Button, Collapse, Flex, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import { HelpPopover } from "../../components/ui";

function highlightComparisonValues(warning: string) {
  const pattern =
    /(?:证载(?:品系|性别|供应商|规格|等级)为 |预约(?:标准品系|预填(?:性别|供应商|规格|等级))为 )([^，；。\n]+)|(?:证载明细数量合计 |预约预填数量 )(-?\d+(?:\.\d+)?)|(?:合格证明细合计|预约预填)(\d+只)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of warning.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3];
    const start = match.index + match[0].length - value.length;
    parts.push(warning.slice(cursor, start));
    parts.push(
      <Typography.Text key={start} mark strong>
        {value}
      </Typography.Text>,
    );
    cursor = start + value.length;
  }
  parts.push(warning.slice(cursor));
  return parts;
}

export function ReceptionCertificateReview({
  refreshFailed,
  sourceChanged,
  recognitionSourceChanged,
  canWrite,
  warnings,
  error,
  onRetry,
}: {
  refreshFailed: boolean;
  sourceChanged: boolean;
  recognitionSourceChanged: boolean;
  canWrite: boolean;
  warnings: string[];
  error: string;
  onRetry: () => void;
}) {
  return (
    <>
      <Alert
        showIcon
        type="warning"
        title={
          <Flex gap={4} align="center">
            <span>请对照原件核对性别、数量和预约差异后保存</span>
            <HelpPopover
              label="合格证核对提醒说明"
              placement="bottomRight"
              icon={<ExclamationCircleOutlined aria-hidden="true" />}
            >
              <Flex vertical gap={8}>
                <Typography.Text>
                  AI 可能识别错误；点击“核对并保存”即表示已人工核对。登记单独保存，预约资料保持原值。
                </Typography.Text>
                {warnings.length ? (
                  <Typography.Text>
                    {highlightComparisonValues(warnings.slice(0, 2).join(" "))}
                    {warnings.length > 2 ? " 其余提示详见下方核对说明。" : ""}
                  </Typography.Text>
                ) : null}
              </Flex>
            </HelpPopover>
          </Flex>
        }
      />
      {refreshFailed ? (
        <Alert
          showIcon
          type="error"
          title="合格证详情刷新失败，当前草稿已保留"
          action={<Button onClick={onRetry}>重试</Button>}
        />
      ) : null}
      {sourceChanged ? (
        <Alert
          showIcon
          type="warning"
          title="预约、申请汇总表或登记版本已变化"
          description="当前草稿已保留。请记录需要保留的内容，关闭后重新打开最新资料，再重新识别或核对原件后手工确认。"
        />
      ) : null}
      {recognitionSourceChanged ? (
        <Alert
          showIcon
          type="warning"
          title="识别或登记所依据的预约版本已变化"
          description="当前草稿已保留。请重新识别，或逐项核对原件后手工确认；后台结果不会自动替换编辑内容。"
        />
      ) : null}
      {!canWrite ? <Alert showIcon type="info" title="当前账号仅可查看合格证及已确认登记" /> : null}
      <Collapse
        className="reception-certificate-warnings"
        classNames={{ body: "reception-certificate-warning-body" }}
        items={[
          {
            key: "warnings",
            label: `识别核对提示${warnings.length ? `（${warnings.length} 条提示）` : ""}`,
            children: (
              <Flex vertical gap={8}>
                {warnings.length ? (
                  <ol className="reception-certificate-warning-list">
                    {warnings.map((warning) => (
                      <li key={warning} className="reception-certificate-warning-item">
                        <Typography.Text>{highlightComparisonValues(warning)}</Typography.Text>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Typography.Text>请逐项核对合格证编号、品系、等级、供应商、性别和数量。</Typography.Text>
                )}
              </Flex>
            ),
          },
        ]}
      />
      {error ? <Alert showIcon type="error" title={error} /> : null}
    </>
  );
}
