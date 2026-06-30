# CageLedger 前端状态契约

本契约约束 React 前端的状态归属、查询缓存和持久化。当前实现以 TanStack Query、页面局部状态和 `UiProvider` 为核心。

## 状态分类

| 类型           | Owner                   | 示例                                           | 生命周期                        |
| -------------- | ----------------------- | ---------------------------------------------- | ------------------------------- |
| 会话状态       | TanStack Query          | 当前用户、角色、房间授权                       | Cookie Session 有效期           |
| 服务端状态     | TanStack Query          | bootstrap、笼卡、笼位、统计表、流程、台账      | staleTime 与精确失效控制        |
| 工作区 UI 状态 | `UiProvider`            | activeView、sidebarCollapsed、settingsExpanded | 当前页面会话                    |
| 持久 UI 偏好   | `uiStorage.ts`          | activeView                                     | localStorage `cageledger.ui.v2` |
| 页面草稿       | feature component       | 表单值、当前分页、筛选、弹窗、选中项           | 页面挂载期间                    |
| 高频录入状态   | 页面局部 state/ref      | 数量统计表单元格、焦点、当前行                 | 输入控件生命周期                |
| 派生状态       | `useMemo` / pure helper | 汇总数、筛选结果、结算展示值                   | 由源状态重算                    |

服务端业务对象不写入 localStorage。旧键 `cageledger.v1` 和 `lahcas.v1` 在 UI 存储迁移时清理。

## QueryClient 默认策略

配置位于 `src/react/api/queryClient.ts`：

| 配置                   | 当前值  | 目的                   |
| ---------------------- | ------- | ---------------------- |
| `staleTime`            | 15 秒   | 合并短时间重复读取     |
| `gcTime`               | 5 分钟  | 保留近期页面缓存       |
| query retry            | 1 次    | 吸收瞬时网络失败       |
| mutation retry         | 0 次    | 避免写入重复执行       |
| `refetchOnWindowFocus` | `false` | 保持高频工作台输入稳定 |

## 查询键

查询键集中在 `src/react/api/queryKeys.ts`。

| 根键                    | 数据                         |
| ----------------------- | ---------------------------- |
| `session`               | 当前会话                     |
| `bootstrap`             | summary、room、full 基础设施 |
| `intake`                | 待接收批次和筛选项           |
| `quantity-sheets`       | 数量统计表列表、详情和筛选项 |
| `billing-workflows`     | 结算流程                     |
| `reimbursement-records` | 报销台账列表与详情           |
| `users`                 | 账号                         |
| `principal-identities`  | PI 身份与减免配置            |
| `iacuc-index`           | IACUC 数据和状态             |
| `audit-events`          | 操作日志分页                 |
| `system`                | 系统信息和更新检查           |

查询键参数包含服务端筛选、排序、分页和 actor scope。对象参数保持可序列化与稳定。

## 加载边界

| 页面       | 初始查询                   | 按需查询                   |
| ---------- | -------------------------- | -------------------------- |
| 主页       | `bootstrap(summary)`       | 无                         |
| 笼卡管理   | intake 当前页              | 筛选项、批次编辑详情       |
| 笼位管理   | `bootstrap(summary)`       | 当前房间 `bootstrap(room)` |
| 饲养费管理 | 数量统计表当前页、房间列表 | 单表详情、IACUC、PI 结算   |
| 流程中心   | 报销台账当前页             | 台账详情、流程版本和明细   |
| 系统设置   | 对应页面的独立查询         | 更新检查、筛选项和上传结果 |
| 公开扫码   | public cage-card endpoint  | 无登录会话依赖             |

业务页面通过 `React.lazy` 加载，首页无需等待笼卡、结算和系统设置代码块。

## 写入和失效规则

| 写入                     | 必须失效或更新的查询                          |
| ------------------------ | --------------------------------------------- |
| 登录                     | 直接写入 `session`                            |
| 登出                     | 清除 session 之外全部查询，写入空会话         |
| 保存/删除/确认接收批次   | `intake` 根键；涉及入驻时同步房间 bootstrap   |
| 保存占用、预留、正式入驻 | 当前 `bootstrap/room/{roomId}`                |
| 保存/删除数量统计表      | `quantity-sheets` 根键                        |
| 生成结算单或发起流程     | 数量统计表、流程、报销台账相关根键            |
| 更新/删除报销台账        | `reimbursement-records` 根键和当前详情        |
| 保存房间、笼架、笼位     | `bootstrap` 根键和设施查询                    |
| 上传 IACUC               | IACUC 状态、完整索引、PI 配置和受影响业务列表 |
| 保存账号                 | `users`                                       |

失效范围与服务端写入范围一致。高频输入期间不触发列表根键失效。

## 表单与焦点规则

- 输入事件更新当前控件所属的局部草稿。
- `Tab`、`Enter` 和日期选择保持焦点顺序稳定。
- 保存前校验在局部草稿上执行，失败时定位到首个问题控件。
- 保存成功后再失效服务端查询，并根据返回对象保持当前选择。
- 弹窗关闭时清理对应草稿和临时预览资源。
- 异步结果只更新仍然有效的页面实例；查询键变化负责隔离旧请求。

## Bootstrap 范围

| scope     | 内容                                                       | 使用场景                                 |
| --------- | ---------------------------------------------------------- | ---------------------------------------- |
| `summary` | rooms、racks、room/rack/dashboard/facility summaries       | 首页和导航摘要                           |
| `room`    | 当前房间 rooms、racks、slots、occupancies、placement tasks | 笼位管理                                 |
| `full`    | 兼容全量数据                                               | 管理和兼容场景，新增页面优先选择专用接口 |

## 持久化规则

- `persistWorkspaceView()` 只写当前工作区。
- “清理本地缓存并刷新”调用 `clearUiStorage()` 后刷新页面。
- 会话由 HttpOnly Cookie 管理。
- 业务草稿默认不跨刷新持久化；需要草稿恢复时建立独立、带版本的存储契约。

## 新状态评审

新增状态前依次判断：

1. 数据是否来自服务端。服务端数据进入 Query cache。
2. 数据是否只属于一个页面。页面局部 state 管理。
3. 数据是否跨多个页面共享。优先通过查询键或明确 Context 共享。
4. 数据是否需要跨刷新保留。仅界面偏好进入带版本 localStorage。
5. 数据是否可以由现有状态推导。使用 pure helper 或 memo 计算。

## 验证要求

- Query key 变化能隔离不同分页和筛选。
- 写入后相关列表、详情和摘要及时更新。
- 高频录入不会因 Query 失效导致失焦。
- 登出后业务查询缓存清空。
- 清理缓存后只清除 UI 偏好，服务端业务数据保持完整。
- React Hooks、查询失效和高频录入改动通过 ESLint、Vitest 和 Playwright 验证。
- 弹窗和异步状态保留键盘焦点、live region 和可访问名称。
