import { useEffect, useState } from "react";
import { Button, Empty, Form, Input, Select, Space, Table, Tag } from "antd";

import {
  useConfirmReimbursementAllocation,
  useCreateReimbursementAllocation,
  useLegacyReimbursements,
  useMigrateLegacyReimbursement,
  useReimbursementClaim,
  useReimbursementClaims,
  useReverseReimbursementAllocation,
  useSettlementObligations,
} from "../../../api/reimbursementLedger";
import type { SessionUser } from "../../../api/contracts";
import { formatMoney, ModalShell, PageState } from "../../../components/WorkspaceUi";

const PAGE = { limit: 20, offset: 0 };
const claimStatusLabels: Record<string, string> = {
  pending_submission: "待提交",
  reimbursing: "报销中",
  completed: "已完成",
  void: "已作废",
};

function moneyColumn(title: string, dataIndex: string) {
  return {
    title,
    dataIndex,
    align: "right" as const,
    render: (value: number) => formatMoney(value),
  };
}

export function ObligationsPanel() {
  const [month, setMonth] = useState("");
  const [sourcePi, setSourcePi] = useState("");
  const query = useSettlementObligations({ ...PAGE, month, sourcePi });
  const items = query.data?.items || [];
  return (
    <section className="ledger-section" aria-label="结算应收列表">
      <div className="command-bar">
        <Form component={false} layout="inline">
          <Form.Item>
            <Input
              aria-label="结算月份"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Form.Item>
          <Form.Item>
            <Input.Search
              aria-label="费用产生项目负责人"
              value={sourcePi}
              onChange={(event) => setSourcePi(event.target.value)}
              placeholder="费用产生项目负责人"
            />
          </Form.Item>
        </Form>
        <Tag variant="filled">{query.data?.page.total || 0} 笔应收</Tag>
      </div>
      {query.isPending ? <PageState title="正在同步结算应收..." /> : null}
      {query.isError ? <PageState title="结算应收加载失败" retry={() => query.refetch()} /> : null}
      {!query.isPending && !query.isError ? (
        <Table
          className="antd-data-table reimbursement-table"
          columns={[
            { title: "结算月份", dataIndex: "month" },
            { title: "费用产生项目负责人", dataIndex: "sourcePi" },
            {
              title: "IACUC",
              render: (_, item) => (
                <Space size={4}>
                  {item.iacuc}
                  {item.obligationKind === "adjustment" ? <Tag color="gold">调整</Tag> : null}
                </Space>
              ),
            },
            moneyColumn("应缴", "payableAmount"),
            moneyColumn("已核销", "allocatedAmount"),
            moneyColumn("待核销", "outstandingAmount"),
            { title: "关联报销单", dataIndex: "claimCount", align: "right" },
            {
              title: "状态",
              render: (_, item) => (
                <Tag color={item.status === "settled" ? "green" : "gold"}>
                  {item.status === "settled" ? "已核销" : "待核销"}
                </Tag>
              ),
            },
          ]}
          dataSource={items}
          locale={{ emptyText: <Empty description="当前没有可结算应收" /> }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 960 }}
        />
      ) : null}
    </section>
  );
}

export function ClaimsPanel({ user, onOpen }: { user: SessionUser; onOpen: (id: string) => void }) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const query = useReimbursementClaims({ ...PAGE, keyword, status });
  const items = query.data?.items || [];
  return (
    <section className="ledger-section" aria-label="报销单列表">
      <div className="command-bar">
        <Form component={false} layout="inline">
          <Form.Item>
            <Input.Search
              aria-label="检索报销单"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="检索报销单号或经费负责人"
            />
          </Form.Item>
          <Form.Item>
            <Select
              aria-label="报销单状态"
              options={[
                { label: "全部状态", value: "all" },
                ...Object.entries(claimStatusLabels).map(([value, label]) => ({ label, value })),
              ]}
              value={status}
              onChange={setStatus}
            />
          </Form.Item>
        </Form>
        <Tag variant="filled">{query.data?.page.total || 0} 张报销单</Tag>
      </div>
      {query.isPending ? <PageState title="正在加载报销单..." /> : null}
      {query.isError ? <PageState title="报销单加载失败" retry={() => query.refetch()} /> : null}
      {!query.isPending && !query.isError ? (
        <Table
          className="antd-data-table reimbursement-table"
          columns={[
            { title: "报销单号", dataIndex: "documentNumber" },
            { title: "经费负责人", dataIndex: "fundingOwner" },
            {
              title: "经费明细",
              render: (_, item) => item.fundingLineCount ?? item.fundingLines?.length ?? "-",
              align: "right",
            },
            moneyColumn("报销总额", "totalAmount"),
            moneyColumn("已分摊", "allocatedAmount"),
            moneyColumn("未分摊", "unallocatedAmount"),
            { title: "附件", dataIndex: "attachmentCount", align: "right" },
            { title: "状态", render: (_, item) => <Tag>{claimStatusLabels[item.status]}</Tag> },
            {
              title: "操作",
              fixed: "right",
              render: (_, item) => (
                <Button size="small" onClick={() => onOpen(item.id)}>
                  详情
                </Button>
              ),
            },
          ]}
          dataSource={items}
          locale={{
            emptyText: <Empty description={user.role === "admin" ? "尚未创建报销单" : "尚未创建本人报销单"} />,
          }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 1050 }}
        />
      ) : null}
    </section>
  );
}

export function ReconciliationPanel({ user, onOpenClaim }: { user: SessionUser; onOpenClaim: (id: string) => void }) {
  const claims = useReimbursementClaims({ ...PAGE, status: "all" });
  const obligations = useSettlementObligations({ ...PAGE });
  const [claimId, setClaimId] = useState("");
  const [lineId, setLineId] = useState("");
  const [obligationId, setObligationId] = useState("");
  const [amount, setAmount] = useState("");
  const detail = useReimbursementClaim(claimId);
  const create = useCreateReimbursementAllocation();
  const confirm = useConfirmReimbursementAllocation();
  const reverse = useReverseReimbursementAllocation();
  const [reverseTarget, setReverseTarget] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const selected = detail.data?.item;
  const lines = selected?.fundingLines || [];
  const selectedLine = lines.find((line) => line.id === lineId);
  const allocations = lines.flatMap((line) => line.allocations || []);
  useEffect(() => setLineId(""), [claimId]);
  return (
    <section className="ledger-section reconciliation-section" aria-label="核销中心">
      <Form className="reconciliation-picker" layout="vertical">
        <Form.Item label="报销单">
          <Select
            allowClear
            options={(claims.data?.items || []).map((claim) => ({
              label: `${claim.documentNumber} · ${claim.fundingOwner}`,
              value: claim.id,
            }))}
            placeholder="请选择报销单"
            value={claimId || undefined}
            onChange={(value) => setClaimId(value || "")}
          />
        </Form.Item>
        <Form.Item label="经费明细">
          <Select
            allowClear
            disabled={!selected}
            options={lines.map((line) => ({
              label: `${line.fundBookNo} · 可用 ${formatMoney(line.unallocatedAmount)}`,
              value: line.id,
            }))}
            placeholder="请选择经费本号"
            value={lineId || undefined}
            onChange={(value) => setLineId(value || "")}
          />
        </Form.Item>
        <Form.Item label="结算应收">
          <Select
            allowClear
            options={(obligations.data?.items || [])
              .filter((item) => item.outstandingAmount > 0)
              .map((item) => ({
                label: `${item.month} · ${item.sourcePi} · ${item.iacuc} · 待核销 ${formatMoney(item.outstandingAmount)}`,
                value: item.id,
              }))}
            placeholder="请选择结算应收"
            value={obligationId || undefined}
            onChange={(value) => setObligationId(value || "")}
          />
        </Form.Item>
        <Form.Item label="本次金额">
          <Input
            inputMode="decimal"
            min="0"
            step="0.01"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={selectedLine ? String(selectedLine.unallocatedAmount) : "0.00"}
          />
        </Form.Item>
        <Form.Item>
          <Button
            disabled={!claimId || !lineId || !obligationId}
            loading={create.isPending}
            type="primary"
            onClick={() =>
              void create
                .mutateAsync({ claimId, fundingLineId: lineId, obligationId, amount: Number(amount) })
                .then(() => {
                  setAmount("");
                  void detail.refetch();
                })
            }
          >
            创建草稿
          </Button>
        </Form.Item>
      </Form>
      {selected ? (
        <div className="reconciliation-context">
          <strong>费用产生项目负责人</strong>
          <span>将在每条分摊中显示</span>
          <Button size="small" onClick={() => onOpenClaim(selected.id)}>
            编辑报销单
          </Button>
        </div>
      ) : null}
      <Table
        className="antd-data-table reimbursement-table"
        columns={[
          { title: "费用产生负责人", dataIndex: "sourcePi" },
          { title: "报销经费负责人", dataIndex: "fundingOwner" },
          { title: "IACUC", dataIndex: "iacuc" },
          { title: "经费本号", dataIndex: "fundBookNo" },
          moneyColumn("本次金额", "amount"),
          {
            title: "状态",
            render: (_, item) => (
              <Tag color={item.status === "confirmed" ? "green" : item.status === "draft" ? "gold" : "default"}>
                {item.status === "draft" ? "草稿" : item.status === "confirmed" ? "已确认" : "已撤销"}
              </Tag>
            ),
          },
          {
            title: "操作",
            fixed: "right",
            render: (_, item) => (
              <Space size={4}>
                {user.role === "admin" && item.status === "draft" ? (
                  <Button
                    size="small"
                    loading={confirm.isPending}
                    onClick={() => void confirm.mutateAsync(item.id).then(() => void detail.refetch())}
                  >
                    确认
                  </Button>
                ) : null}
                {user.role === "admin" && item.status === "confirmed" ? (
                  <Button danger size="small" type="text" onClick={() => setReverseTarget(item.id)}>
                    撤销
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
        dataSource={allocations}
        locale={{ emptyText: <Empty description="选择报销单后可创建与查看核销分摊" /> }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 960 }}
      />
      {reverseTarget ? (
        <ModalShell ariaLabel="撤销核销" className="reimbursement-reverse-dialog" onClose={() => setReverseTarget("")}>
          <div className="modal-shell-head">
            <h2>撤销核销</h2>
          </div>
          <div className="modal-shell-body">
            <p>撤销后会恢复经费明细与结算应收余额。</p>
            <Form layout="vertical">
              <Form.Item label="撤销原因">
                <Input.TextArea
                  rows={3}
                  value={reverseReason}
                  onChange={(event) => setReverseReason(event.target.value)}
                />
              </Form.Item>
            </Form>
          </div>
          <div className="modal-shell-actions">
            <Button onClick={() => setReverseTarget("")}>取消</Button>
            <Button
              danger
              loading={reverse.isPending}
              type="primary"
              disabled={!reverseReason.trim()}
              onClick={() =>
                void reverse.mutateAsync({ id: reverseTarget, reason: reverseReason }).then(() => {
                  setReverseTarget("");
                  setReverseReason("");
                  void detail.refetch();
                })
              }
            >
              确认撤销
            </Button>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

export function LegacyPanel({ user }: { user: SessionUser }) {
  const query = useLegacyReimbursements(PAGE);
  const migrate = useMigrateLegacyReimbursement();
  const items = query.data?.items || [];
  return (
    <section className="ledger-section" aria-label="历史台账">
      <p className="ledger-guidance">
        历史台账保留只读展示。具备报销单号、经费本号及匹配结算应收的记录可由管理员迁入新核销体系。
      </p>
      <Table
        className="antd-data-table reimbursement-table"
        columns={[
          { title: "月份", render: (_, item) => String(item.month || "-") },
          { title: "费用产生负责人", render: (_, item) => String(item.pi || "-") },
          { title: "报销单号", render: (_, item) => String(item.reimbursementFormNo || "-") },
          { title: "经费本号", render: (_, item) => String(item.fundBookNo || "-") },
          { title: "应缴", align: "right", render: (_, item) => formatMoney(Number(item.payableAmount || 0)) },
          { title: "已缴", align: "right", render: (_, item) => formatMoney(Number(item.paidAmount || 0)) },
          {
            title: "迁入",
            fixed: "right",
            render: (_, item) =>
              user.role === "admin" && item.migrationEligible ? (
                <Button
                  size="small"
                  loading={migrate.isPending}
                  onClick={() => void migrate.mutateAsync(String(item.id))}
                >
                  迁入
                </Button>
              ) : (
                <Tag>待核对</Tag>
              ),
          },
        ]}
        dataSource={items}
        locale={{ emptyText: <Empty description="当前没有历史台账记录" /> }}
        pagination={false}
        rowKey={(item) => String(item.id)}
        scroll={{ x: 860 }}
      />
    </section>
  );
}
