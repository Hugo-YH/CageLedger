export type SettlementSource = "quantity_sheet" | "cage_map" | "pi_merged_technical_service";

export interface SettlementTarget {
  pi: string;
  month: string;
  sourceType: SettlementSource;
}

export interface InitiateSettlementPayload extends SettlementTarget {
  sourceVersions?: Record<string, string>;
}

export interface ReviewedServiceSettlement {
  pi: string;
  month: string;
  sourceVersions: Record<string, string>;
}

/** Compatibility payload for callers using the original combined action. */
export interface GenerateBillingStatementPayload extends InitiateSettlementPayload {
  persist?: boolean;
}

/** Exports retain the existing server-side source normalization. */
export interface SettlementExportTarget {
  month: string;
  pi: string;
  sourceType: string;
}
