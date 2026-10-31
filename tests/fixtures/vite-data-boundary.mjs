import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, normalizePath, resolveConfig } from "vite";

// Exercise a copy of the actual config. Never create or request files in the project's data tree.
const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "cageledger-vite-boundary-")));
const root = join(temporary, "Data", "project with spaces");
const marker = "SYNTHETIC_PROTECTED_CONTENT_NO_REAL_DATA";
const requests = [];
let vite;
const upstream = createHttpServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url, body });
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ synthetic: true, method: request.method, path: request.url, body }));
});

try {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeFile(join(root, "vite.config.ts"), await readFile(join(project, "vite.config.ts")));
  await symlink(await realpath(join(project, "node_modules")), join(root, "node_modules"), "dir");
  const protectedFiles = [
    "data/database/synthetic boundary.sqlite",
    "data/database/synthetic.sqlite-wal",
    "data/database/files/nested/synthetic.png",
    "data/runtime.json",
    ".env",
    ".env.production",
    ".npmrc",
    ".yarnrc.yml",
    ".git/config",
    ...["crt", "pem", "key", "p12", "pfx", "cer", "der"].map((extension) => `synthetic.${extension}`),
  ];
  for (const name of protectedFiles) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), marker, { mode: 0o600 });
  }
  await mkdir(join(root, "src"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "src/control.ts"), 'document.body.dataset.control = "synthetic-control";');
  await writeFile(join(root, "assets/public-control.txt"), "synthetic-public-control");
  await writeFile(join(root, "index.html"), '<script type="module" src="/src/control.ts"></script>');
  const defaults = await resolveConfig({ root, configFile: false, logLevel: "silent" }, "serve");
  const actual = await resolveConfig({ root: project, logLevel: "silent" }, "serve");
  assert.deepEqual(actual.server.fs.deny, [...defaults.server.fs.deny, normalizePath(join(project, "data/**"))]);
  await new Promise((done, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", done);
  });
  // Vite treats port 0 as its default port; reserve an ephemeral port explicitly.
  const portProbe = createHttpServer();
  await new Promise((done, reject) => {
    portProbe.once("error", reject);
    portProbe.listen(0, "127.0.0.1", done);
  });
  const vitePort = portProbe.address().port;
  await new Promise((done, reject) => portProbe.close((error) => (error ? reject(error) : done())));
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  vite = await createServer({
    root,
    configFile: join(root, "vite.config.ts"),
    cacheDir: join(temporary, "cache"),
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: vitePort,
      strictPort: false,
      proxy: { "/api": upstreamOrigin, "/docs": { target: upstreamOrigin, ws: true } },
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.deepEqual(vite.config.server.fs.deny, [...defaults.server.fs.deny, normalizePath(join(root, "data/**"))]);
  const blocked = [];
  for (const name of protectedFiles) {
    const absolute = normalizePath(join(root, name));
    for (const route of [
      `/${encodeURI(name)}`,
      `/${encodeURI(name)}?raw`,
      `/@fs/${encodeURI(absolute)}`,
      `/@fs${encodeURI(absolute)}?raw`,
    ]) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 403, route);
      assert.equal((await response.text()).includes(marker), false, route);
      blocked.push(route);
    }
  }
  for (const route of [
    "/%64ata/database/synthetic%20boundary.sqlite",
    "/data/database/synthetic%20boundary.sqlite?import&raw",
    "/data//database/synthetic%20boundary.sqlite",
    "/src/../data/database/synthetic%20boundary.sqlite",
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 403, route);
    assert.equal((await response.text()).includes(marker), false, route);
    blocked.push(route);
  }
  for (const [route, expected] of [
    ["/", "/src/control.ts"],
    ["/src/control.ts", "synthetic-control"],
    ["/public-control.txt", "synthetic-public-control"],
    [`/@fs/${encodeURI(normalizePath(join(root, "src/control.ts")))}`, "synthetic-control"],
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).includes(expected), route);
  }
  const api = await fetch(origin + "/api/synthetic-boundary?check=1", { method: "POST", body: "synthetic-body" });
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), {
    synthetic: true,
    method: "POST",
    path: "/api/synthetic-boundary?check=1",
    body: "synthetic-body",
  });
  const docs = await fetch(origin + "/docs/synthetic-control?check=1");
  assert.equal(docs.status, 200);
  assert.equal((await docs.json()).path, "/docs/synthetic-control?check=1");
  assert.equal(requests.length, 2, "Only synthetic proxy requests reached the upstream");
  console.log(
    JSON.stringify({
      defaultsPreserved: true,
      protectedFiles: protectedFiles.length,
      forbiddenRequests: blocked.length,
      normalControls: 4,
      proxyControls: 2,
      dataNamedParentAndSpaces: true,
      realProjectDataRequested: false,
    }),
  );
} finally {
  if (vite) await vite.close();
  upstream.closeAllConnections();
  await new Promise((done) => upstream.close(done));
  await rm(temporary, { recursive: true, force: true });
}
