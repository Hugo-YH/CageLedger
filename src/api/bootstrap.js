import { API_BOOTSTRAP_URL } from "./endpoints.js";
import { queryUrl } from "./client.js";

export function buildBootstrapUrl(scope = "summary", roomId = "") {
  return queryUrl(API_BOOTSTRAP_URL, { scope, roomId });
}

