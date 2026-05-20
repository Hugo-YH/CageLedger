#!/usr/bin/env node

const baseUrl = process.env.CAGELEDGER_SMOKE_BASE_URL || "http://localhost:5173";
const username = process.env.CAGELEDGER_SMOKE_USERNAME || process.env.CAGELEDGER_ADMIN_USERNAME || "admin";
const password = process.env.CAGELEDGER_SMOKE_PASSWORD || process.env.CAGELEDGER_ADMIN_PASSWORD || "admin123";

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${payload.error || text}`);
  }
  return { response, payload };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

const health = await request("/api/health");
const login = await request("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const cookie = cookieFrom(login.response);
const authHeaders = cookie ? { Cookie: cookie } : {};

const checks = [
  "/api/bootstrap?scope=summary",
  "/api/intake-batches?limit=5&offset=0",
  "/api/placement-tasks?limit=5&offset=0",
  "/api/quantity-sheets?limit=5&offset=0",
  "/api/billing-workflows?limit=5&offset=0",
  "/api/principal-identities",
];

for (const path of checks) {
  await request(path, { headers: authHeaders });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      version: health.payload.system?.version || "",
      checks: checks.length + 2,
    },
    null,
    2,
  ),
);
