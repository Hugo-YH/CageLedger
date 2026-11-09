import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig } from "vitepress";
import type { Plugin } from "vite";

import { emitLlms } from "./emit-llms.mjs";
import { pageRoutes } from "./page-routes.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const documentationEditBranch = process.env.CAGELEDGER_DOCS_EDIT_BRANCH ?? "main";
const documentationRepository = "https://git.cellnucle.us/hugo/cageledger";

function serveLlmIndex(): Plugin {
  return {
    name: "cageledger-serve-llms-index",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
        if (pathname !== "/llms.txt" && pathname !== "/docs/llms.txt") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(readFileSync(resolve(repositoryRoot, "wiki", "LLMs.md"), "utf8"));
      });
    },
  };
}

function contributorsFor(filePath: string): string[] {
  if (!filePath.endsWith(".md")) {
    return [];
  }

  try {
    const relativePath = relative(repositoryRoot, resolve(repositoryRoot, "wiki", filePath));
    const output = execFileSync("git", ["log", "--format=%aN", "--", relativePath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [
      ...new Set(
        output
          .split("\n")
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ].slice(0, 6);
  } catch {
    return [];
  }
}

const wikiLinkTargets = Object.fromEntries(
  Object.entries(pageRoutes).map(([source, route]) => [source.replace(/\.md$/, ""), `/${route.replace(/\.md$/, "")}`]),
);

export default defineConfig({
  lang: "zh-CN",
  title: "CageLedger",
  description: "实验动物笼位管理与计费系统文档",
  base: "/docs/",
  // Concurrent previews and isolated tests must not replace each other's optimized modules.
  cacheDir: process.env.CAGELEDGER_DOCS_PORT
    ? `.vitepress/cache/dev-${process.env.CAGELEDGER_DOCS_PORT}`
    : ".vitepress/cache/standalone",
  cleanUrls: true,
  vite: {
    plugins: [serveLlmIndex()],
  },
  buildEnd: emitLlms().buildEnd,
  lastUpdated: process.env.CAGELEDGER_DOCS_LAST_UPDATED !== "false",
  transformPageData(pageData) {
    return {
      frontmatter: {
        ...pageData.frontmatter,
        contributors: contributorsFor(pageData.filePath),
      },
    };
  },
  rewrites: pageRoutes,
  markdown: {
    config(markdown) {
      markdown.renderer.rules.table_open = () =>
        '<div class="doc-table-scroll" role="region" aria-label="表格，可横向滚动查看" tabindex="0"><table>';
      markdown.renderer.rules.table_close = () => "</table></div>";
      markdown.inline.ruler.before("emphasis", "cageledger-wiki-links", (state, silent) => {
        const start = state.pos;
        if (state.src.slice(start, start + 2) !== "[[") {
          return false;
        }
        const end = state.src.indexOf("]]", start + 2);
        if (end < 0) {
          return false;
        }
        const name = state.src.slice(start + 2, end).trim();
        const target = wikiLinkTargets[name];
        if (!target) {
          return false;
        }
        if (!silent) {
          const open = state.push("link_open", "a", 1);
          open.attrSet("href", target);
          const text = state.push("text", "", 0);
          text.content = name;
          state.push("link_close", "a", -1);
        }
        state.pos = end + 2;
        return true;
      });
    },
  },
  themeConfig: {
    logo: "/cageledger-icon.svg",
    nav: [
      { text: "使用指南", link: "/guide/" },
      { text: "部署运维", link: "/operations/" },
      { text: "开发维护", link: "/development/" },
      { text: "更新日志", link: "/releases/" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始使用",
          items: [
            { text: "指南导航", link: "/guide/" },
            { text: "产品概览", link: "/guide/overview" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "工作台导航", link: "/guide/navigation" },
            { text: "业务流程", link: "/guide/business-flow" },
          ],
        },
        {
          text: "接收、检疫与饲养",
          items: [
            { text: "笼卡与接收", link: "/guide/cage-cards" },
            { text: "检疫管理", link: "/guide/quarantine" },
            { text: "笼位与房间", link: "/guide/rooms-and-cages" },
            { text: "动物巡检", link: "/guide/animal-inspection" },
            { text: "实验人员信息", link: "/guide/researchers" },
          ],
        },
        {
          text: "费用与单据",
          items: [
            { text: "数量统计表", link: "/guide/quantity-sheets" },
            { text: "饲养费核算", link: "/guide/billing" },
            { text: "技术服务费", link: "/guide/technical-services" },
            { text: "结算与报销", link: "/guide/settlement-and-reimbursement" },
          ],
        },
        {
          text: "查询与帮助",
          items: [
            { text: "操作手册索引", link: "/guide/user-manual" },
            { text: "常见问题", link: "/guide/faq" },
            { text: "帮助与反馈", link: "/guide/feedback" },
          ],
        },
      ],
      "/operations/": [
        {
          text: "部署上线",
          items: [
            { text: "运维导航", link: "/operations/" },
            { text: "部署与运行", link: "/operations/deployment" },
            { text: "HTTPS 与证书", link: "/operations/https-and-certificate" },
            { text: "环境变量", link: "/operations/environment" },
          ],
        },
        {
          text: "配置与数据",
          items: [
            { text: "系统配置", link: "/operations/configuration" },
            { text: "账号与权限", link: "/operations/accounts-and-permissions" },
            { text: "数据管理与 IACUC", link: "/operations/data-and-iacuc" },
            { text: "供应商简称映射", link: "/operations/supplier-aliases" },
          ],
        },
        {
          text: "运行维护",
          items: [
            { text: "备份与恢复", link: "/operations/backup-and-maintenance" },
            { text: "故障排查", link: "/operations/troubleshooting" },
          ],
        },
      ],
      "/development/": [
        {
          text: "加入项目",
          items: [
            { text: "开发导航", link: "/development/" },
            { text: "当前版本与兼容边界", link: "/development/current-baseline" },
            { text: "本地开发", link: "/development/local-development" },
            { text: "项目结构", link: "/development/project-structure" },
            { text: "开发规范", link: "/development/contributing" },
          ],
        },
        {
          text: "架构与接口",
          items: [
            { text: "前端架构", link: "/development/frontend-architecture" },
            { text: "后端架构", link: "/development/backend-architecture" },
            { text: "API 与数据模型", link: "/development/api-and-data-model" },
            { text: "API 接口清单", link: "/development/api-inventory" },
          ],
        },
        {
          text: "质量与交付",
          items: [
            { text: "UI 组件标准", link: "/development/ui-component-standard" },
            { text: "测试与质量", link: "/development/testing-and-quality" },
            { text: "文档图文与引用", link: "/development/documentation-media" },
            { text: "发布与交付", link: "/development/release-and-delivery" },
          ],
        },
      ],
      "/releases/": [{ text: "发行记录", items: [{ text: "更新日志", link: "/releases/" }] }],
    },
    socialLinks: [{ icon: "github", link: "https://git.cellnucle.us/hugo/cageledger" }],
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                noResultsText: "未找到相关内容",
                resetButtonTitle: "清除搜索",
                footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
              },
            },
          },
        },
      },
    },
    outline: { label: "本页目录", level: [2, 3] },
    docFooter: { prev: "上一篇", next: "下一篇" },
    sidebarMenuLabel: "文档目录",
    returnToTopLabel: "返回顶部",
    darkModeSwitchLabel: "切换主题",
    lastUpdated: { text: "最后更新", formatOptions: { dateStyle: "medium" } },
    editLink: {
      pattern: `${documentationRepository}/_edit/${documentationEditBranch}/wiki/:path`,
      text: "编辑此页",
    },
    footer: {
      message: "Apache-2.0 Licensed",
      copyright: "中山大学中山眼科中心 · 实验动物中心",
    },
  },
});
