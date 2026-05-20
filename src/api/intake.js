import { ENTITY_API_URLS } from "./endpoints.js";
import { queryUrl } from "./client.js";

export function buildIntakeBatchesUrl({ status = "", month = "", limit = 5, offset = 0 } = {}) {
  return queryUrl(ENTITY_API_URLS.intakeBatches, {
    status: status && status !== "all" ? status : "",
    month,
    limit,
    offset,
  });
}

export function buildPlacementTasksUrl({ roomId = "", month = "", status = "", limit = 5, offset = 0 } = {}) {
  return queryUrl(ENTITY_API_URLS.placementTasks, { roomId, month, status, limit, offset });
}

