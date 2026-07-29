import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { defineConfig } from "vitepress";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const documentationEditBranch = process.env.CAGELEDGER_DOCS_EDIT_BRANCH ?? "main";
const documentationRepository = "https://git.cellnucle.us/hugo/cageledger";

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

const pageRoutes = {
  "Home.md": "index.md",
  "产品概览.md": "guide/overview.md",
  "快速开始.md": "guide/getting-started.md",
  "业务流程.md": "guide/business-flow.md",
  "工作台导航.md": "guide/navigation.md",
  "用户操作手册.md": "guide/user-manual.md",
  "笼卡管理.md": "guide/cage-cards.md",
  "笼位与房间管理.md": "guide/rooms-and-cages.md",
  "动物巡检.md": "guide/animal-inspection.md",
  "数量统计表.md": "guide/quantity-sheets.md",
  "饲养费核算.md": "guide/billing.md",
  "结算与报销.md": "guide/settlement-and-reimbursement.md",
  "常见问题.md": "guide/faq.md",
  "部署与运行.md": "operations/deployment.md",
  "系统配置.md": "operations/configuration.md",
  "环境变量.md": "operations/environment.md",
  "账号与权限.md": "operations/accounts-and-permissions.md",
  "数据管理与IACUC索引.md": "operations/data-and-iacuc.md",
  "备份与维护.md": "operations/backup-and-maintenance.md",
  "故障排查.md": "operations/troubleshooting.md",
  "本地开发.md": "development/local-development.md",
  "项目结构.md": "development/project-structure.md",
  "前端架构.md": "development/frontend-architecture.md",
  "后端架构.md": "development/backend-architecture.md",
  "API与数据模型.md": "development/api-and-data-model.md",
  "UI组件标准.md": "development/ui-component-standard.md",
  "测试与质量.md": "development/testing-and-quality.md",
  "开发规范.md": "development/contributing.md",
  "发布与CI-CD.md": "development/release-and-delivery.md",
  "更新日志.md": "releases/index.md",
} as const;

const wikiLinkTargets = Object.fromEntries(
  Object.entries(pageRoutes).map(([source, route]) => [source.replace(/\.md$/, ""), `/${route.replace(/\.md$/, "")}`]),
);

export default defineConfig({
  lang: "zh-CN",
  title: "CageLedger",
  description: "实验动物笼位管理与计费系统文档",
  base: "/docs/",
  cleanUrls: true,
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
      { text: "指南", link: "/guide/overview" },
      { text: "运维", link: "/operations/deployment" },
      { text: "开发", link: "/development/local-development" },
      { text: "更新日志", link: "/releases/" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始使用",
          items: [
            { text: "产品概览", link: "/guide/overview" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "业务流程", link: "/guide/business-flow" },
            { text: "工作台导航", link: "/guide/navigation" },
          ],
        },
        {
          text: "业务操作",
          items: [
            { text: "笼卡管理", link: "/guide/cage-cards" },
            { text: "笼位与房间管理", link: "/guide/rooms-and-cages" },
            { text: "动物巡检", link: "/guide/animal-inspection" },
            { text: "数量统计表", link: "/guide/quantity-sheets" },
            { text: "饲养费核算", link: "/guide/billing" },
            { text: "结算与报销", link: "/guide/settlement-and-reimbursement" },
            { text: "用户操作手册", link: "/guide/user-manual" },
            { text: "常见问题", link: "/guide/faq" },
          ],
        },
      ],
      "/operations/": [
        {
          text: "部署与运维",
          items: [
            { text: "部署与运行", link: "/operations/deployment" },
            { text: "系统配置", link: "/operations/configuration" },
            { text: "环境变量", link: "/operations/environment" },
            { text: "账号与权限", link: "/operations/accounts-and-permissions" },
            { text: "数据管理与 IACUC 索引", link: "/operations/data-and-iacuc" },
            { text: "备份与维护", link: "/operations/backup-and-maintenance" },
            { text: "故障排查", link: "/operations/troubleshooting" },
          ],
        },
      ],
      "/development/": [
        {
          text: "开发维护",
          items: [
            { text: "项目结构", link: "/development/project-structure" },
            { text: "本地开发", link: "/development/local-development" },
            { text: "前端架构", link: "/development/frontend-architecture" },
            { text: "后端架构", link: "/development/backend-architecture" },
            { text: "API 与数据模型", link: "/development/api-and-data-model" },
            { text: "UI 组件标准", link: "/development/ui-component-standard" },
            { text: "测试与质量", link: "/development/testing-and-quality" },
            { text: "开发规范", link: "/development/contributing" },
            { text: "发布与交付", link: "/development/release-and-delivery" },
          ],
        },
      ],
      "/releases/": [{ text: "发行记录", items: [{ text: "更新日志", link: "/releases/" }] }],
    },
    socialLinks: [{ icon: "github", link: "https://git.cellnucle.us/hugo/cageledger" }],
    search: { provider: "local" },
    editLink: {
      pattern: `${documentationRepository}/_edit/branch/${documentationEditBranch}/wiki/:path`,
      text: "编辑此页",
    },
    footer: {
      message: "Apache-2.0 Licensed",
      copyright: "中山大学中山眼科中心 · 实验动物中心",
    },
  },
});
