# CageLedger 综合系统性能优化：审计与基线

状态：`LOCAL_ONLY`（私有 Gitea，本地文件跟踪）。分支 `codex/ant-design-ui-refactor`（v1.0.0-beta4.1）。

## 任务方向

对全系统做性能优化：前端包体、加载瀑布、渲染与数据获取，后端 API 延迟、缓存、SQLite 查询与导出链路。审计基于本机数据基线：1032 条 IACUC 申请、当月 211 张数量统计表、74 个 SQLite 索引。

## 热点清单（按影响排序）

### P0 数量统计表保存整月重算（已完成）

`save_quantity_sheet` 实测约 67ms：`validate_custom_billing_segments` 对当月全部 211 张表 × 31 天逐日重算（51.6ms），`read_applications_by_iacuc` 无转出行也全量读 1032 条申请（10.7ms）。已改为只校验当前表 + 受影响镜像表，无转出行时跳过申请读取，211 张表规模 47.6ms → 0.26ms。

### P1 IACUC 匹配与录入区重渲染（已完成）

录入页 datalist 上限 80、前缀优先、空输入为空；`QuantityEditorPages` 整组件 memo；IntakeView 改为单条定向搜索，不再拉全量索引。

### P2 前端包体（已完成）

react/react-dom 与 @tanstack 独立 vendor chunk；移动端导航与 Dashboard 懒加载；首屏初始请求 7 个文件共 1396KB（gzip 约 425KB）。

### P3 IACUC 索引全量下发给多页面（已完成）

服务端 `?q=` 搜索：实测定向查询 8.9KB（全量 1.75MB 的 1/200）；IntakeView 单条匹配走定向接口，QuantitySheetView 与 SavedQuantitySheets 保留全量缓存（datalist 与到期日映射需要）。

### P4 审计列表瘦身（已完成）

审计列表响应的 before/after 快照替换为截断标记：20 条从约 66KB 降到 15.7KB，详情字段继续保留在写入响应中。

## 已实施改动

| 改动                                                   | 位置                                                             | 效果                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------ |
| 保存只校验当前表+镜像表                                | `server_app/legacy.py`                                           | 211 张表规模 47.6ms → 0.26ms               |
| 无转出行跳过申请全量读取                               | `server_app/domains/quantity/service.py`                         | 消除每次保存的全表 JSON 解析               |
| datalist 上限 80、前缀优先、空输入为空                 | `src/domain/iacuc.ts` + QuantitySheetView                        | 1032 项 → ≤80 项                           |
| 移动端导航独立懒加载 chunk，桌面不挂载                 | `src/react/features/shell/MobileNavigation.tsx` + ReactWorkspace | antd-mobile 不进桌面首屏（429KB → 0）      |
| DashboardView 懒加载                                   | ReactWorkspace                                                   | 首屏下载约 421KB（gzip）                   |
| 移除 `antd-mobile/es/global` JS 副作用导入，样式转 CSS | `src/main.tsx`、`styles/index.css`                               | 切断 modulepreload 强制预下载              |
| Sheet 从 antd-mobile Popup 改 antd Drawer              | `src/react/components/ui/Sheet.tsx`                              | 移动端浮层不再依赖移动包（当前无页面引用） |
| lockfile 与版本同步                                    | `package-lock.json`                                              | 补齐缺失传递依赖，修复安装失败             |
| 录入区整组件 memo                                      | `QuantityEditorPages.tsx`                                        | IACUC 输入不再连带 31 行录入区重渲染       |
| react/query vendor 独立分包                            | `vite.config.ts`                                                 | 首屏 7 个文件 1396KB，依赖块缓存稳定       |
| IACUC 服务端 `?q=` 搜索                                | `server_app/web/iacuc.py` + IntakeView                           | 定向查询 8.9KB，前缀优先、上限可配         |
| 审计列表 before/after 截断                             | `server_app/repositories/entities.py`                            | 20 条 66KB → 15.7KB                        |
| `/api/iacuc-index` 路由迁出 legacy                     | `server_app/web/iacuc.py`                                        | legacy.py 保持 6898 行，不触硬上限         |

复核结果：`npm run check` 通过（45 前端测试 + 63 Python 测试 + lint/格式/类型/架构/UI 契约/文档），完整 Playwright e2e 19 条通过，`git diff --check` 通过。本地 5173 生产模式服务最新构建。

## 后续观察项

- 大列表 DataTable 虚拟化：现有列表均为服务端分页（每页 5-20 条），虚拟化收益低，结合 ant-design 收敛进度再评估。
- antd 核心块（ui 596KB）保持 Rolldown 默认按需分包；若继续放大，可对 `@ant-design/cssinjs` 等核心单独分组。
- IACUC 全量索引仍由两个页面各自缓存（客户端 5 分钟 + 服务端 15 秒），数据量增长后再评估服务端索引。

## 验证命令

```bash
npm run check
npm run build
npm run test:e2e
npm run smoke:api
npm run benchmark
```

性能改动需要同时提供基线和修改后数据；测试数据库使用临时目录。
