import {
  API_BILLING_OCCUPANCIES_URL,
  API_BILLING_WORKFLOWS_URL,
  API_QUANTITY_SHEETS_URL,
  ENTITY_API_URLS,
} from "./endpoints.js";
import { queryUrl } from "./client.js";

export function buildQuantitySheetsUrl({ month = "", iacuc = "", pi = "", roomId = "", limit = 50, offset = 0 } = {}) {
  return queryUrl(API_QUANTITY_SHEETS_URL, { month, iacuc, pi, roomId, limit, offset });
}

export function buildBillingWorkflowsUrl({ month = "", status = "todo", limit = 50, offset = 0 } = {}) {
  return queryUrl(API_BILLING_WORKFLOWS_URL, { month, status, limit, offset });
}

export function buildAuditLogsUrl({ limit = 200, offset = 0 } = {}) {
  return queryUrl(ENTITY_API_URLS.auditLogs, { limit, offset });
}

export function buildBillingOccupanciesUrl({ month = "", iacuc = "", pi = "" } = {}) {
  return queryUrl(API_BILLING_OCCUPANCIES_URL, { month, iacuc, pi });
}

export function buildBillingStatementUrl(statementId) {
  return `/api/billing-statements/${encodeURIComponent(statementId)}`;
}

export function buildBillingWorkflowLinesUrl(workflowId, versionId = "") {
  return queryUrl(`${API_BILLING_WORKFLOWS_URL}/${encodeURIComponent(workflowId)}/lines`, { versionId });
}

