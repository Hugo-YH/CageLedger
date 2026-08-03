import { formatMoney } from "../../../components/WorkspaceUi";

export const claimStatusLabels: Record<string, string> = {
  pending_submission: "待提交",
  reimbursing: "报销中",
  completed: "已完成",
  void: "已作废",
};

export function moneyColumn(title: string, dataIndex: string) {
  return {
    title,
    dataIndex,
    align: "right" as const,
    render: (value: number) => formatMoney(value),
  };
}
