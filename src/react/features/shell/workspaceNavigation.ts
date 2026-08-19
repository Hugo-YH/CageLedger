import type { WorkspaceView } from "../../state/ui";

export type BillingSidebarItem = {
  section?: string;
  view?: WorkspaceView;
  label?: string;
  description?: string;
  icon?: "grid" | "calculator" | "book" | "refresh";
};

export function isWorkspaceView(value: string): value is WorkspaceView {
  return [
    "dashboard",
    "cages",
    "intake-entry",
    "intake-batches",
    "cage-card-scanner",
    "animal-inspection-entry",
    "animal-inspection-findings",
    "animal-inspection-records",
    "animal-inspection-standards",
    "billing-cage-map",
    "billing-quantity-entry",
    "billing-quantity-saved",
    "billing-settlement",
    "billing-monthly-summary",
    "workflow-center",
    "rooms",
    "data",
    "system",
    "users",
    "logs",
  ].includes(value);
}

export function billingSidebarItems(canExportMonthlySummary: boolean): BillingSidebarItem[] {
  const items: BillingSidebarItem[] = [
    { section: "数量统计表" },
    {
      view: "billing-quantity-entry",
      label: "录入数量统计表",
      description: "按伦理号和房间录入月度变化",
      icon: "calculator",
    },
    {
      view: "billing-quantity-saved",
      label: "已保存数量统计表",
      description: "检索、预览和维护历史统计表",
      icon: "book",
    },
    { section: "结算管理" },
    {
      view: "billing-settlement",
      label: "结算管理",
      description: "自动合并负责人名下伦理并出单",
      icon: "calculator",
    },
    { view: "workflow-center", label: "单据跟踪", description: "跟踪结算流程、报销和累计未缴", icon: "refresh" },
  ];
  if (canExportMonthlySummary) {
    items.push({
      view: "billing-monthly-summary",
      label: "汇总导出",
      description: "导出 IACUC 和设施维度的月度 Excel",
      icon: "book",
    });
  }
  return items;
}
