# 前端性能、Ant Design 与交互升级归档

本任务从 2026-08-31 至 2026-09-04 完成，以生产可合并为验收标准，保持 API、权限、SQLite、结算、打印和业务规则兼容。核心实现提交为 `d1b8f47`，动效收口提交为 `afac280`。

## 修改概览

- 查询层统一取消、重试、缓存、搜索防抖和批量失效策略，旧请求不能覆盖新草稿。
- 通用 DataTable 统一列宽、选择、固定操作列、横向滚动、表头语义和偏好持久化。
- Ant Design ConfigProvider、CSS token、深色主题、控件高度、按钮层级和 Portal 样式采用同一契约。
- 主要页面保持同一组件树跨断点响应，避免切换布局时丢失表单草稿或媒体资源。
- 表单、Modal 和批量操作补齐 loading、防重、错误、重试、关闭清理与焦点恢复。
- 动效统一为 140/220/280ms 与 `cubic-bezier(0.2, 0, 0, 1)`，移除持续装饰动画并支持 reduced-motion。
- 生产启动统一使用项目 Python 3.13 运行时，避免系统 Python 3.9 导致构建后服务无法启动。

## 性能优化

- 35 个只读 Query 入口接入 AbortSignal；网络错误、408、429 和 5xx 最多重试一次，写入不重试。
- IACUC 联想搜索使用 250ms 防抖和标准化 key；分页列表使用稳定占位数据，批量写入只在整批结束后刷新。
- 数量录入大网格拆出 memo 组件；动态笼位图继续使用 TanStack Virtual。业务 Table 均为服务端分页，每页数据量有限，因此未叠加收益不足的表格虚拟化。
- App、工作区页面、移动导航和 Dashboard 均按需加载。图表运行时为独立延迟块 1,455.25kB（gzip 426.53kB），浏览器断言确认进入图表视口前不会请求。
- 当前 10 万记录基准与 2026-08-31 同规格基线对比：

| 查询 | 基线 P95 | 当前 P95 | 结论 |
| ---- | -------: | -------: | ---- |
| Dashboard 房间月查询 | 4.50ms | 4.36ms | 无回退 |
| 数量表筛选项 | 1.59ms | 1.63ms | 0.04ms 波动 |
| 数量表深分页 | 0.21ms | 0.19ms | 无回退 |
| Intake 20 并发 | 7.17ms | 3.48ms | 改善 |
| 结算候选 20 并发 | 14.38ms | 14.04ms | 无回退 |

本地生产进程完整 5 分钟窗口记录 11 个请求，HTTP P95 19ms、SQLite P95 0.2ms、慢请求 0、锁错误 0。该样本用于确认本地链路，不代替发布后的生产同流量趋势。

## UI、交互与动效

- 表头统一左对齐，文本按语义左对齐、数字右对齐、选择居中、操作列右固定。
- 固定操作列通过弹性占位贴合容器右侧；调整一列不再挤压其他列，键盘也可按 16px 步长调整。
- 页面、工具栏、筛选、内容、分页和操作区在 1440、1200、1180、992、768、760、390 与 844×390 视口下无页面级横向溢出；需要横向滚动的 Table 由表格内容区单独承担。
- Loading 使用 Skeleton/Table loading，失败使用可重试状态，空列表使用 Empty；写入按钮在请求和关联刷新期间保持 loading。
- 系统主题变化无需导航或刷新即可同步 Ant 组件；按钮、输入框、日期选择器和只读控件保持 32px 默认高度。
- 页面进入和微交互仅使用 opacity/transform；Modal、Drawer、Dropdown 保留 Ant 原生 motion；reduced-motion 下持续时间降为 1ms 并移除位移、缩放。

## 修复的潜在 Bug

- 浏览器拒绝 localStorage/sessionStorage 时应用白屏。
- 760px 断点更换组件树导致数量表草稿、扫码视频或错误状态丢失。
- IACUC、详情和全选请求乱序覆盖用户较新的选择。
- 批量操作逐项刷新形成请求风暴，连续点击产生重复写入。
- Modal 关闭后迟到成功回调关闭新弹窗，重开时残留旧表单或隐藏 Popconfirm。
- DataTable 字符串宽度参与数值计算、resizeKey 串表、固定操作列离开容器或遮挡按钮。
- 月份选择器被业务表格样式撑宽，中文月份未生效。
- `npm start` 调用系统 Python 3.9，导致 `datetime.UTC` 导入失败且服务未监听。

## 主要修改文件

- 查询与状态：`src/react/api/`、`src/react/hooks/`、`src/react/state/`
- 通用 UI：`src/react/components/AppErrorBoundary.tsx`、`src/react/components/TaskFeedback.tsx`、`src/react/components/ui/DataTable.tsx`、`src/react/components/ui/AntdProvider.tsx`
- 业务页面：`src/react/features/billing/`、`intake/`、`scanner/`、`workflows/`、`settings/`、`animal-management/`
- 样式与契约：`src/styles/`、`docs/contracts/frontend-state.md`、`docs/contracts/ui-component-standard.md`
- 回归：`tests/e2e/` 与各 API、hook、组件单测
- 运行入口：`package.json`、`scripts/python_runtime.mjs`、`scripts/check_python_runtime.mjs`

## 验证结果

- Node 22.12.0、Python 3.13：通过。
- `npm run verify:full`：通过。
- Vitest：40 个文件、253 项通过。
- Python unittest：216 项通过。
- Playwright：70/70 通过；公共夹具阻断 console warning/error 和 pageerror。
- Ant Design doctor：16/16；lint、deprecated、a11y 问题均为 0。
- `npm run smoke:api`：9/9 通过。
- `npm run benchmark`：10,000 笼位、100,000 记录通过。
- `npm start`：生产构建后使用项目 Python 3.13 正常监听 5173。
- 架构门禁：0 blocker；样式归属、UI 契约、文档构建和 `git diff --check` 通过。

## 仍存在的技术债务

- 图表延迟块 gzip 426.53kB，虽不进入首屏，仍可在图表种类继续增长时评估更轻的图表实现。
- 架构报告保留 12 项规模 warning 和 19 个尺寸热点；本任务没有为追求行数而进行无收益拆分。
- Python 测试仍输出既有的未关闭 SQLite/文件 ResourceWarning，未影响结果，但应在后续后端资源治理中清理。
- 自动化浏览器目前以 Chromium 为权威入口；Safari/WebKit 仍建议在正式发布前做人工冒烟。
- 本地性能历史样本流量较小；发布后应在管理员性能历史中对比同等生产流量窗口的 HTTP/SQLite P95、慢请求、锁错误和缓存命中率。

过程分析、计划和进度证据位于本目录的 `analysis/`、`plan/` 与 `progress/`。
