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

### P5 批量操作请求收敛（已完成）

待接收批次的“标记已打印”和“确认接收”改为单次批量请求：服务端在一个 SQLite 事务内完成权限校验、状态转换、任务生成和审计写入。数量统计表批量打印也改为一次读取全部详情，选中 N 条时的详情请求从 N 次收敛为 1 次。

### P6 Dashboard 按月数据读取（已完成）

Dashboard 的饲养间图表按 `month` 筛选、按 `room_name` 排序。新增 `quantity_sheets(month, room_name)` 索引后，SQLite 直接按月份有序读取，避免按饲养间跳跃扫描。10 万记录基准中该查询 P95 为 5.17ms。

### P7 静态资源冷启动压缩（已完成）

构建阶段预生成大于 1KB 的静态资源 gzip 文件，Python 服务优先发送与源文件同步的预压缩版本。交互图表主 chunk 的首次响应直接发送 419.6KB 压缩文件，避免请求链路中的实时压缩。

### P8 Dashboard 图表预取（已完成）

侧栏指向“总览”时，前端并行预取 Dashboard 页面模块与交互图表模块；键盘和移动端激活总览时也会在页面切换前启动加载。首屏继续按需加载图表包。

### P9 Dashboard 数据缓存（已完成）

Dashboard 总览缓存从 15 秒延长到 60 秒。数量表、接收批次、基础设施和结算候选写入路径均显式失效该缓存，因此读取继续复用聚合结果，写入后立即构建新快照。

## 已实施改动

| 改动                                                   | 位置                                                                | 效果                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------ |
| 保存只校验当前表+镜像表                                | `server_app/legacy.py`                                              | 211 张表规模 47.6ms → 0.26ms               |
| 无转出行跳过申请全量读取                               | `server_app/domains/quantity/service.py`                            | 消除每次保存的全表 JSON 解析               |
| datalist 上限 80、前缀优先、空输入为空                 | `src/domain/iacuc.ts` + QuantitySheetView                           | 1032 项 → ≤80 项                           |
| 移动端导航独立懒加载 chunk，桌面不挂载                 | `src/react/features/shell/MobileNavigation.tsx` + ReactWorkspace    | antd-mobile 不进桌面首屏（429KB → 0）      |
| DashboardView 懒加载                                   | ReactWorkspace                                                      | 首屏下载约 421KB（gzip）                   |
| 移除 `antd-mobile/es/global` JS 副作用导入，样式转 CSS | `src/main.tsx`、`styles/index.css`                                  | 切断 modulepreload 强制预下载              |
| Sheet 从 antd-mobile Popup 改 antd Drawer              | `src/react/components/ui/Sheet.tsx`                                 | 移动端浮层不再依赖移动包（当前无页面引用） |
| lockfile 与版本同步                                    | `package-lock.json`                                                 | 补齐缺失传递依赖，修复安装失败             |
| 录入区整组件 memo                                      | `QuantityEditorPages.tsx`                                           | IACUC 输入不再连带 31 行录入区重渲染       |
| react/query vendor 独立分包                            | `vite.config.ts`                                                    | 首屏 7 个文件 1396KB，依赖块缓存稳定       |
| IACUC 服务端 `?q=` 搜索                                | `server_app/web/iacuc.py` + IntakeView                              | 定向查询 8.9KB，前缀优先、上限可配         |
| 审计列表 before/after 截断                             | `server_app/repositories/entities.py`                               | 20 条 66KB → 15.7KB                        |
| `/api/iacuc-index` 路由迁出 legacy                     | `server_app/web/iacuc.py`                                           | legacy.py 保持 6898 行，不触硬上限         |
| 待接收批次批量打印、确认接收                           | `server_app/legacy.py` + `src/react/features/intake/IntakeView.tsx` | N 条写入请求 → 1 次事务请求                |
| 数量统计表批量打印详情读取                             | `server_app/legacy.py` + `SavedQuantitySheets.tsx`                  | N 条详情请求 → 1 次请求                    |
| Dashboard 按月饲养间数据索引                           | `server_app/persistence/indexes.py`                                 | `month` 过滤与 `room_name` 排序直接走索引  |
| 静态资源构建期 gzip                                    | `scripts/build_all.mjs` + `server_app/static.py`                    | 大资源首次请求跳过 Python 实时压缩         |
| Dashboard 图表导航预取                                 | `src/react/features/shell/ReactWorkspace.tsx`                       | 导航准备阶段并行下载页面和图表模块         |
| Dashboard 读取缓存延长                                 | `server_app/domains/dashboard_overview.py`                          | 聚合结果由 15 秒复用至 60 秒               |

复核结果：`npm run check` 通过（70 前端测试 + 138 Python 测试 + lint/格式/类型/架构/UI 契约/文档），`npm run benchmark` 在 1 万笼位、10 万记录的临时库中通过，`npm run build` 完成。数量统计表筛选候选 P95 为 1.57ms，20 并发结算候选 P95 为 13.59ms。

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
