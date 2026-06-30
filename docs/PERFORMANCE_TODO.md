# CageLedger 性能待办

本清单面向当前 React 代码。迁移前优化记录保留在 `docs/archives/cageledger-react-performance/`。

## 当前基线

- React 业务页面按域懒加载。
- TanStack Query 管理服务端状态，默认 staleTime 15 秒。
- 首页使用 summary bootstrap，笼位页使用 room bootstrap。
- 笼位图使用 TanStack Virtual。
- 待接收、数量统计表、流程、报销和日志使用服务端分页。
- Python 服务提供 gzip、ETag、静态资源内存缓存和 `Server-Timing`。
- SQLite 使用结构化热字段、索引和 WAL。
- `npm run benchmark` 覆盖大数据查询基准。

## P1：保持迁移后稳定性

- 为大笼位图增加固定回归：不同列数、虚拟行高度、空笼位和长文本都不重叠。
- 为数量统计表增加 30 行录入、同日多类型、转入转出、预览和打印的 E2E。
- 为流程中心增加分页、详情、登记报销和状态推进的请求次数断言。
- 对 React 懒加载失败增加可重试错误边界，避免单个 chunk 失败形成空白页。
- 在 CI 中记录 Vite chunk 体积，识别意外引入的大依赖。

## P2：缩小数据和失效范围

- 继续将 `src/react/api/contracts.ts` 中稳定的 `Record<string, unknown>` 替换为明确类型。
- 统计 mutation 的查询失效范围，优先更新当前详情并失效相关列表根键。
- IACUC 上传后根据派生字段影响范围失效查询，控制全局刷新次数。
- 房间、笼架和笼位写入后优先更新当前 room bootstrap，再刷新 summary。
- 结算预览使用 month + PI + sourceType 查询键，避免重复生成相同草稿。

## P2：后端查询与事务

- 将新增高频路由持续下沉到 `server_app/services/` 和 `repositories/`。
- 新筛选列同步增加结构化列和索引，并使用 `EXPLAIN QUERY PLAN` 验证。
- 监控 quantity sheets、reimbursement records、workflow lines 的 p95 和返回体大小。
- 结算生成保持按月、PI 和 IACUC 定向读取，避免 assembled full state。
- 大型 IACUC 上传分阶段记录解析、快照、同步和索引耗时。

## P3：前端包体与样式

- 保持 scanner 的二维码识别依赖只在扫码页面加载。
- 评估将 `src/styles.css` 按 shell、features、print 拆分，同时保留统一 token 入口。
- 检查 SystemView 文档内容和 BillingView 是否继续形成最大业务 chunk。
- 对低频系统设置页面维持懒加载，首页首包保持 React、Query 和 dashboard 必需代码。

## P3：可观测性

- 保留 API `Server-Timing` 和低噪声 `[perf]` 日志。
- benchmark 输出记录数据规模、查询名、p50、p95 和失败阈值。
- 浏览器性能排查记录请求数、传输体积、React commit 次数和长任务。
- NAS 部署记录 CPU、内存、SQLite 文件大小和 WAL checkpoint 情况。

## 验证命令

```bash
npm run check
npm run build
npm run test:e2e
npm run smoke:api
npm run benchmark
```

性能改动需要同时提供基线和修改后数据，测试数据库使用临时目录。
