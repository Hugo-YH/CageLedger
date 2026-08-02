import { formatMoney } from "../../../components/WorkspaceUi";

export const LEDGER_OBLIGATIONS_PATH = "/api/reimbursement-ledger/obligations";
export const LEDGER_CLAIMS_PATH = "/api/reimbursement-ledger/claims";
export const LEDGER_LEGACY_PATH = "/api/reimbursement-ledger/legacy-records";

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
