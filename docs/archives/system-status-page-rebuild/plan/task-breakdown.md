# Task Breakdown

## Overview

- **Total Phases**: 1
- **Total Tasks**: 3
- **Planned Delivery Batches**: 1（LOCAL_ONLY，不创建 PR）
- **Estimated Total Effort**: L

## Confirmed Task Definition

将“关于系统”彻底重建为符合 Ant Design 的系统状态页。管理员可查看当前服务进程的缓存、请求和 SQLite 性能；普通账号不获取或显示运维指标。移除页面中的 CPU、Python、主机名、数据库路径、维护人员等低价值信息，保留兼容 API、版本入口、证书工具和本机主题设置。

## Design Direction

- **Subject**: 实验动物设施管理员使用的运行仪表。
- **Palette**: Ant Blue `#1677ff`、Success `#52c41a`、Warning `#faad14`、Error `#ff4d4f`、中性表面色由现有语义 Token 提供。
- **Type**: 沿用应用正文栈；性能数字启用 tabular numbers 作为数据字体角色。
- **Layout**: 运行脉搏带 → 缓存/请求/SQLite 诊断卡 → 客户端工具与本机偏好。
- **Signature**: 一条按诊断顺序排列的运行脉搏带，不使用无业务含义的渐变或装饰编号。

## S.U.P.E.R Design Constraints

- 页面组件按产品头、运行状态、工具和偏好拆分，顶层只负责编排。
- 指标契约先于渲染实现，所有字段可序列化。
- 不改变现有接口权限或删除兼容字段。
- 系统页布局唯一归属 `administration.css`。

## Phase 1: Contract, Rebuild and Validation

**Goal**: 一次完成契约、页面重建、样式收敛和回归保护。

| #   | Task                            | Priority | Effort | Depends On | Lane | Batch | S.U.P.E.R | Test Expectation                         | Memory Impact     | Acceptance Criteria                                              |
| :-- | :------------------------------ | :------- | :----- | :--------- | :--- | :---- | :-------- | :--------------------------------------- | :---------------- | :--------------------------------------------------------------- |
| 1.1 | 补齐性能指标前端/API 契约       | P0       | S      | —          | A    | P1-B1 | P, U      | 类型检查、Python shape 测试              | 更新 API/状态契约 | 请求、缓存、DB、阈值结构完整；明确进程级语义                     |
| 1.2 | 重建 SystemView 与唯一 CSS 归属 | P0       | L      | 1.1        | A    | P1-B1 | S, E, R   | antd lint、样式门禁、格式化函数测试      | 登记样式组件族    | 管理员看到诊断；普通账号不请求指标；移除静态环境清单；四档无溢出 |
| 1.3 | 扩展 E2E、文档与全量验证        | P1       | M      | 1.2        | A    | P1-B1 | U, P, R   | Playwright、Axe、check、smoke、benchmark | 更新测试/API 文档 | 权限、刷新、空样本、四档视口和可访问性有自动回归                 |

### Parallel Lanes

| Lane | Tasks           | Combined Effort | Merge Risk | Key Files                                      |
| :--- | :-------------- | :-------------- | :--------- | :--------------------------------------------- |
| A    | 1.1 → 1.2 → 1.3 | L               | High       | SystemView、contracts、administration CSS、E2E |

任务共享契约和页面热点，不满足并行执行的低重叠条件，采用 Tier 0 由主代理顺序实施。

### Delivery Batches

| Batch | Tasks         | Execution Waves     | Goal and Grouping Rationale           | Combined Validation                                            | Split Rationale                  |
| :---- | :------------ | :------------------ | :------------------------------------ | :------------------------------------------------------------- | :------------------------------- |
| P1-B1 | 1.1、1.2、1.3 | W1: 1.1 → 1.2 → 1.3 | 契约、UI 与测试构成同一兼容和回滚单元 | targeted tests + `npm run check` + browser + smoke + benchmark | 单阶段默认批次；LOCAL_ONLY 无 PR |
