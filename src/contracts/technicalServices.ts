import type { BillingStatementResponse, SettlementCandidate } from "./billing";

export interface TechnicalServiceCatalogItem {
  id: string;
  name: string;
  unit: string;
  internalPrice: number;
  externalPrice: number;
  version: string;
  source: string;
  notes: string;
}

export interface TechnicalServiceSheet {
  id: string;
  month: string;
  iacuc: string;
  facility: "zhujiang" | "bioisland";
  customerType: "internal" | "external";
  serviceId: string;
  serviceName: string;
  unit: string;
  unitPrice: number;
  priceSnapshot?: TechnicalServiceCatalogItem;
  project: string;
  pi: string;
  owner: string;
  funding: string;
  manager: string;
  notes: string;
  updatedAt: string;
  rows: Array<{ id?: string; date: string; quantity: number; amount?: number }>;
  totalAmount: number;
  totalQuantity: number;
  serviceDayCount: number;
  protected?: boolean;
}

export interface TechnicalServicePreview extends BillingStatementResponse {
  sourceVersions: Record<string, string>;
}

export type TechnicalServiceCandidate = SettlementCandidate;

export interface TechnicalServiceListParams {
  month?: string;
  keyword?: string;
  limit: number;
  offset: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  columnFilters?: Record<string, string[]>;
}
