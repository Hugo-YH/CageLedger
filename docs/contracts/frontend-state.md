# 前端状态契约

> Scope: Phase 1 / Task 1.1
> Source: `src/app.js` at CageLedger `0.5.2c`

## 目标

本契约定义前端全局状态的长期边界。后续拆分 `src/app.js` 时，任何新 state helper、API client、view module 都按本页分区读写状态。

## 全局 State Slices

| Slice | Owner | 主要字段 | 写入入口 | 失效条件 |
|:------|:------|:---------|:---------|:---------|
| `session` | app shell | `currentUser`, `remotePersistence` | auth API, bootstrap | 登录、登出、401 |
| `infrastructureSummary` | app shell / room views | `rooms`, `racks` summary, dashboard summary | `/api/bootstrap?scope=summary` | 房间、笼架、笼位、占用写入 |
| `roomInfrastructure` | cage map | selected room slots/racks/occupancies/placement tasks | `/api/bootstrap?scope=room&roomId=...` | 目标房间写入、任务预留、正式入驻 |
| `fullInfrastructure` | billing / data admin | full rooms/racks/slots/occupancies | `/api/bootstrap?scope=full` | 任意基础设施写入 |
| `intake` | intake page | `intakeBatches`, `selectedIntakeBatchIds`, `intakeBatchDraft` | `/api/intake-batches*` | 批次新增、编辑、打印、确认接收、删除 |
| `placement` | cage map | `placementTasks`, `selectedPlacementTaskIds`, `placementAssignmentMode` | `/api/placement-tasks*` | 确认接收、预留、入驻、变更饲养间 |
| `quantitySheets` | billing page | `quantitySheets`, `quantitySheetDraft`, pagination | `/api/quantity-sheets*` | 保存、删除、生成结算单、转入转出同步 |
| `billingWorkflows` | workflow center | `billingWorkflows`, selected detail, pagination | `/api/billing-workflows*` | 生成结算单、推进状态、删除流程 |
| `auditLogs` | logs page | `auditLogs`, pagination | `/api/audit-events` | 服务端返回审计增量后合并；进入日志页时按页拉取 |
| `system` | about/system pages | `systemInfo`, update status, release notes | `/api/system/*`, local constants | 版本变更、手动检查更新 |
| `ui` | app shell | active view, filters, modal, saving flags, pagination | local handlers | 用户交互、视图切换、写入完成 |

## 加载边界

| 场景 | 初始加载 | 按需升级 |
|:-----|:---------|:---------|
| 登录后首屏 | `bootstrap.summary` | 进入房间页后加载 `bootstrap.room` |
| 笼位管理 | 当前房间 summary + room scope | 需要跨房间全量统计时升级到 full |
| 笼卡管理 | intake batches + placement tasks page 1 | 翻页按页加载 |
| 饲养费核算 | quantity sheets page 1 | 选择 cage map source 且具备 month/pi 时加载 billing occupancies |
| 流程中心 | workflows page 1 | 打开详情时加载 versions/events/lines |
| 数据管理 | IACUC status | 上传或查看时加载完整 index |

## 写入合并规则

| 写入动作 | 本地合并 | 后台补拉 | 禁止行为 |
|:---------|:---------|:---------|:---------|
| 保存待接收批次 | upsert 当前批次；合并返回的相关待进驻任务 | 当前 intake/placement 页有分页缺口时按页刷新 | 全量 `loadPersistedState()` |
| 确认接收 | 更新批次、追加任务、合并审计 | 当前房间 placement page 定向刷新 | 重拉 full infrastructure |
| 预留待进驻任务 | 更新 task 和 occupancy；同步当前笼位状态 | 当前 room scope 定向刷新 | 清空全部 placement state |
| 正式入驻 | reserved occupancy 转 active；任务转 active | 当前 room scope 定向刷新 | 重新拉取所有房间 |
| 保存数量统计表 | upsert 当前 sheet；upsert affected sheets；合并审计 | 仅刷新受影响 sheet 或当前分页 | 扫描整月全部 sheets |
| 推进结算流程 | upsert workflow；更新 selected detail events | 当前 workflow detail 可定向刷新 | 重拉全部流程列表 |

## 状态写入顺序

1. 写入 API 返回结构先进入对应 slice。
2. `auditLogs` 只合并服务端返回增量。
3. pagination total/hasMore 只由分页接口更新。
4. `scheduleRender(reason)` 是统一渲染入口。
5. 后台补拉失败时保留用户可见变更，并显示站内通知。

## 拆分目标

| 目标模块 | 责任 |
|:---------|:-----|
| `src/state/session.js` | auth、用户、远端模式 |
| `src/state/infrastructure.js` | summary/room/full 基础设施缓存 |
| `src/state/intake.js` | 待接收批次和待进驻任务本地合并 |
| `src/state/billing.js` | quantity sheets、billing context、workflow |
| `src/api/client.js` | fetch、401、JSON parse、错误标准化 |
| `src/api/*.js` | 按业务域封装 API endpoint |
| `src/views/*.js` | 纯渲染与事件绑定入口 |

## 验收标准

- 后续拆分必须保持现有远端模式与静态模式表现一致。
- 所有跨模块状态读写都能映射到本页 slice。
- 新增写入路径必须声明本地合并策略、后台补拉策略、缓存失效策略。
