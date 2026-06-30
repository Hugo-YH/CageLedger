# CageLedger 模块清单

| 模块                                 | 当前规模 | 责任                                               | 复杂度   | S.U.P.E.R           |
| ------------------------------------ | -------: | -------------------------------------------------- | -------- | ------------------- |
| `server.py`                          | 8,187 行 | schema、兼容迁移、鉴权、路由、领域规则、导入、装配 | Critical | S🔴 U🟡 P🔴 E🟢 R🔴 |
| `server_app/repositories/billing.py` |   878 行 | 数量统计、结算、流程版本持久化                     | High     | S🔴 U🟢 P🟡 E🟢 R🟡 |
| `server_app/services/billing.py`     |   273 行 | 结算流程事务                                       | High     | S🟡 U🟢 P🟡 E🟢 R🟡 |
| `server_app/services/quantity.py`    |   228 行 | 数量统计表转移同步                                 | High     | S🟢 U🟢 P🟡 E🟢 R🟡 |
| `src/react/api/contracts.ts`         |   409 行 | 全部前端 API 类型                                  | Medium   | S🔴 U🟢 P🟡 E🟢 R🟡 |
| `QuantitySheetView.tsx`              | 1,037 行 | 查询、草稿、录入表、列表、预览、保存               | Critical | S🔴 U🟡 P🟡 E🟢 R🔴 |
| `CagesView.tsx`                      |   751 行 | 房间、虚拟笼架、笼位编辑、待进驻                   | High     | S🔴 U🟡 P🟡 E🟢 R🟡 |
| `IntakeView.tsx`                     |   586 行 | 消息识别、录入、列表、接收                         | High     | S🔴 U🟡 P🟡 E🟢 R🟡 |
| `WorkflowCenterView.tsx`             |   456 行 | 台账列表、流程详情、报销编辑                       | High     | S🟡 U🟡 P🟡 E🟢 R🟡 |
| `RoomsView.tsx`                      |   481 行 | 房间、笼架、笼位生成与账号范围                     | High     | S🟡 U🟡 P🟡 E🟢 R🟡 |
| `src/styles.css`                     | 8,589 行 | tokens、全局、组件、全部业务页、响应式             | Critical | S🔴 U🟡 P🔴 E🟢 R🔴 |
| `generate_demo_data.py`              |   954 行 | CLI、数据库构建、全部演示领域数据                  | High     | S🔴 U🟢 P🟡 E🟡 R🟡 |
| `releaseNotes.ts`                    |   929 行 | 发布记录静态数据                                   | Low      | S🟢 U🟢 P🟢 E🟢 R🟢 |

## 依赖现状

- 前端 45 个运行模块、106 条内部依赖、0 个循环。
- `contracts.ts` 被 26 个模块引用，是前端拆分的主要兼容端口。
- 后端模块依赖保持 `server.py -> services -> repositories` 方向，领域服务通过依赖字典调用 `server.py` 中的函数。
- repository 未反向依赖 HTTP；这一边界继续保留。

## 目标模块责任

### Web 与持久化平台

- `server_app/web/`：请求上下文、Router、认证、响应和 handler 生命周期。
- `server_app/persistence/`：连接、schema 注册、幂等迁移和索引。

### 后端领域

- `administration`：账号、审计、系统信息。
- `iacuc`：CSV 解析、索引写入和项目字段同步。
- `intake`：笼卡批次、QR ID、接收确认。
- `cages`：房间、笼架、笼位、占用和待进驻。
- `quantity`：数量统计表、行规范化和转移镜像。
- `billing`：动物/笼日、价格、减免、PI 合表和结算单。
- `workflow`：结算版本、状态推进和审计事件。
- `reimbursement`：报销台账、累计欠缴和 Excel 导入。

### 前端领域

每个 feature 的 View 只负责查询装配和页面布局；高频草稿进入 hook，表格、表单、弹窗和预览进入独立组件。跨领域 transport、QueryClient 和基础 UI 保持共享。
