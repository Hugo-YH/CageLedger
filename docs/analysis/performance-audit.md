# CageLedger 综合系统性能优化：审计与基线

状态：`LOCAL_ONLY`（私有 Gitea，本地文件跟踪）。分支 `codex/ant-design-ui-refactor`（v1.0.0-beta4.1）。

## 任务方向

对全系统做性能优化：前端包体、加载瀑布、渲染与数据获取，后端 API 延迟、缓存、SQLite 查询与导出链路。审计基于本机数据基线：1032 条 IACUC 申请、当月 211 张数量统计表、74 个 SQLite 索引。

## 热点清单（按影响排序）

### P0 数量统计表保存整月重算

`save_quantity_sheet` 实测约 67ms，构成：`validate_custom_billing_segments` 对当月全部 211 张表 × 31 天逐日重算（51.6ms），`read_applications_by_iacuc` 无转出行也全量读 1032 条申请（10.7ms）。实际只需校验当前表 + 受影响镜像表，无转出行时无需读申请。

### P1 IACUC 匹配与录入区重渲染

`/api/iacuc-index` 全量返回约 1.75MB（1032 项）；录入页 datalist 空输入渲染全部 option、每次敲键重建；`QuantityEditorPages` 仅单元格 memo，IACUC 输入连带 31 行录入区整体重渲染。

### P2 前端包体

构建产物实测（修复后）：入口 index 189KB + antd 核心块 ui 620KB + antd button 块 357KB；业务块中 BillingView 109KB、MobileNavigation 85KB（已独立）、SystemView 70KB、jsQR 130KB（仅扫码页）。antd 6 的组件级 chunk 分散在共享块，未显式建 vendor 边界，首屏 gzip 约 380KB。

### P3 IACUC 索引全量下发给多页面

IntakeView、QuantitySheetView、SavedQuantitySheets 均拉全量索引；IntakeView 仅做单条匹配。可提供服务端 `?q=` 搜索。

### P4 观察项

审计事件分页约 66KB/20 条（含 before/after 全量），仅日志页使用；bootstrap summary 15s 缓存生效（冷 16ms → 热 2ms）；结算候选快照生效；PDF 为常驻 Chromium 单线程队列。量级可控，暂不处理。

## 已实施改动（审计期间落地，未提交）

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 保存只校验当前表+镜像表 | `server_app/legacy.py` | 211 张表规模 47.6ms → 0.26ms |
| 无转出行跳过申请全量读取 | `server_app/domains/quantity/service.py` | 消除每次保存的全表 JSON 解析 |
| datalist 上限 80、前缀优先、空输入为空 | `src/domain/iacuc.ts` + QuantitySheetView | 1032 项 → ≤80 项 |
| 移动端导航独立懒加载 chunk，桌面不挂载 | `src/react/features/shell/MobileNavigation.tsx` + ReactWorkspace | antd-mobile 不进桌面首屏（429KB → 0） |
| DashboardView 懒加载 | ReactWorkspace | 首屏下载约 421KB（gzip） |
| 移除 `antd-mobile/es/global` JS 副作用导入，样式转 CSS | `src/main.tsx`、`styles/index.css` | 切断 modulepreload 强制预下载 |
| Sheet 从 antd-mobile Popup 改 antd Drawer | `src/react/components/ui/Sheet.tsx` | 移动端浮层不再依赖移动包（当前无页面引用） |
| lockfile 与版本同步 | `package-lock.json` | 补齐缺失传递依赖，修复安装失败 |

复核结果：`npm run check` 通过（45 前端测试 + 63 Python 测试 + lint/格式/类型/架构/UI 契约/文档），`npm run build` 产物确认 MobileNavigation 与 DashboardView 独立 chunk，Playwright e2e 19 条全部通过，`git diff --check` 通过。本地 5173 生产模式服务最新构建。

## 剩余优化项

1. `QuantityEditorPages` 整组件 memo，隔离 IACUC 输入的连带重渲染（P1，低风险，main 已有验证实现）
2. antd vendor 显式分包（manualChunks），把 antd 核心从共享业务块中独立出来，改善缓存命中与入口体积（P2）
3. IACUC 索引服务端 `?q=` 搜索接口，IntakeView 等单条匹配页面改为定向查询（P3）
4. 审计事件分页瘦身（P4，可选）
5. 大列表 DataTable 虚拟化与查询失效范围收敛（P2/P3，结合 ant-design 收敛进度）

## 验证命令

```bash
npm run check
npm run build
npm run test:e2e
npm run smoke:api
npm run benchmark
```

性能改动需要同时提供基线和修改后数据；测试数据库使用临时目录。
