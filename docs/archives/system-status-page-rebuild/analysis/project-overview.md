# Project Overview

## Preliminary Direction

将“关于系统”重建为面向管理员的运行状态页：展示当前服务进程的请求、缓存和 SQLite 性能指标，移除低价值静态环境清单，并保留普通用户仍需要的版本、文档、证书与本机主题入口。

## Current Architecture

```mermaid
flowchart LR
  UI[SystemView] --> Hooks[TanStack Query hooks]
  Hooks --> API[/api/system/info\n/api/system/environment]
  API --> Domain[administration.system]
  Domain --> Metrics[performance snapshot]
  Metrics --> Cache[in-process cache]
  Metrics --> DB[SQLite instrumentation]
  Metrics --> HTTP[request instrumentation]
```

当前页面位于 `src/react/features/settings/SystemView.tsx`，由工作区状态键 `system` 懒加载。管理员运行状态来自 `/api/system/environment`；后端已返回进程内性能快照，但前端 TypeScript 契约和页面尚未消费该字段。

## Technology Stack

| Layer      | Current                                                  | Target             |
| :--------- | :------------------------------------------------------- | :----------------- |
| Frontend   | React 19、TypeScript、Vite、Ant Design 6、TanStack Query | 保持不变           |
| Backend    | Python 3.13 标准库 HTTP 服务                             | 保持不变           |
| Storage    | SQLite                                                   | 保持不变           |
| Monitoring | 进程内计数与最近 512 个延迟样本                          | 管理员状态页可视化 |

## Entry Points

- `src/react/features/shell/ReactWorkspace.tsx`：关于系统导航和懒加载入口。
- `src/react/features/settings/SystemView.tsx`：当前页面。
- `src/react/api/administration.ts`：系统信息和运行环境 hooks。
- `server_app/domains/administration/system.py`：系统信息、运行环境与更新检查。
- `server_app/performance.py`：进程级性能指标。

## Build & Run

- 开发：`npm run dev`
- 基础检查：`npm run check`
- 浏览器回归：`npm run test:e2e`
- API 冒烟：`npm run smoke:api`
- 性能基准：`npm run benchmark`

## Testing Baseline

Python 已覆盖指标百分位、命中率、管理员权限和环境响应；Playwright 目前只覆盖页面标题、证书下载与四档视口无横向溢出，缺少指标、角色差异和可访问性断言。

## Project Governance Baseline

- 共享指令：`AGENTS.md`
- API、状态、样式与测试契约：`docs/contracts/`
- 样式归属：`src/styles/style-ownership.json`
- 无 `CLAUDE.md`；不新增竞争性记忆文件。

## External Integrations

更新检查可访问私有 Gitea Release；系统状态本身只读取本进程内指标与 SQLite 只读状态。
