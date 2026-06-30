# CageLedger 全项目拆分任务

## Overview

- **Total Phases**: 6
- **Total Tasks**: 26
- **Estimated Effort**: XL
- **Strategy**: 领域内分层、兼容转发、小步替换

## S.U.P.E.R Constraints

- 单文件保持单一责任，核心规则可脱离 HTTP/React/SQLite 测试。
- 依赖固定为 route/view → service/hook → repository/rules。
- 跨模块输入输出使用显式类型或可序列化结构。
- 配置继续来自 `server_app/config.py` 和现有环境变量。
- 每个阶段通过架构检查、业务测试和兼容验收后进入下一阶段。

## Phase 1：行为基线与架构门禁

| ID  | Task                        | Priority | Effort | Depends | Lane | SUPER | Acceptance                                 |
| --- | --------------------------- | -------- | ------ | ------- | ---- | ----- | ------------------------------------------ |
| 1.1 | 建立规格、进度与项目 Skill  | P0       | S      | -       | A    | S,P   | 文档与 Skill 校验通过                      |
| 1.2 | 增加后端业务与 API 特征测试 | P0       | L      | 1.1     | A    | U,P   | QR、计费、减免、转移、权限与响应契约有测试 |
| 1.3 | 增加前端/打印视觉与交互基线 | P0       | M      | 1.1     | B    | P,R   | 固定数据截图与模板测试可重复               |
| 1.4 | 新增 report-only 架构检查   | P0       | M      | 1.1     | C    | S,U   | 输出循环、越层和规模报告，不阻断现有热点   |

## Phase 2：后端平台层

| ID  | Task                                             | Priority | Effort | Depends | Lane | SUPER | Acceptance                   |
| --- | ------------------------------------------------ | -------- | ------ | ------- | ---- | ----- | ---------------------------- |
| 2.1 | 提取 persistence schema、migration 和 index 注册 | P0       | L      | 1.2     | A    | S,U,R | 旧库迁移顺序与结果一致       |
| 2.2 | 提取 web request、response、auth 和 Router       | P0       | L      | 1.2     | B    | S,P,R | HTTP 契约测试一致            |
| 2.3 | 将 Handler 改为统一路由分发                      | P0       | L      | 2.1,2.2 | A    | U,R   | handler 只管理 HTTP 生命周期 |
| 2.4 | 收敛 server.py 装配与兼容导出                    | P0       | M      | 2.3     | A    | S,R   | server.py 不超过 250 行      |

## Phase 3：后端领域拆分

| ID  | Task                                      | Priority | Effort | Depends | Lane | SUPER   | Acceptance                        |
| --- | ----------------------------------------- | -------- | ------ | ------- | ---- | ------- | --------------------------------- |
| 3.1 | 拆 administration、audit、system 与 iacuc | P1       | L      | 2.4     | A    | S,U     | route/service/repository 边界明确 |
| 3.2 | 拆 intake、QR 与 cages/placement          | P0       | XL     | 2.4     | B    | S,P,R   | 笼卡和入驻回归一致                |
| 3.3 | 拆 quantity sheets 与 transfer            | P0       | XL     | 3.2     | A    | S,U,P   | 转移镜像和结余结果一致            |
| 3.4 | 拆 billing、减免、PI 合表与 workflow      | P0       | XL     | 3.3     | A    | S,U,P,R | 固定数据逐日金额完全一致          |
| 3.5 | 拆 reimbursement 与 Excel import          | P0       | L      | 3.4     | A    | S,P,R   | 台账累计与导入结果一致            |

## Phase 4：前端领域拆分

| ID  | Task                              | Priority | Effort | Depends     | Lane | SUPER | Acceptance                     |
| --- | --------------------------------- | -------- | ------ | ----------- | ---- | ----- | ------------------------------ |
| 4.1 | 拆 API contracts 与 Query hooks   | P0       | M      | 1.4         | A    | P,R   | 兼容入口重导出，查询键一致     |
| 4.2 | 拆 QuantitySheetView              | P0       | XL     | 4.1,3.4     | A    | S,U,R | 高频录入、预览、保存与列表一致 |
| 4.3 | 拆 CagesView 与 IntakeView        | P0       | XL     | 4.1,3.2     | B    | S,U,R | 虚拟笼架、笼卡和接收一致       |
| 4.4 | 拆 Workflow、Rooms 与管理页面     | P1       | L      | 4.1,3.5     | C    | S,U   | 页面与权限回归一致             |
| 4.5 | 拆 release notes 与共享工作区组件 | P2       | M      | 4.2,4.3,4.4 | A    | S,R   | 公共组件单一责任，导出保持兼容 |

## Phase 5：CSS、脚本与测试结构

| ID  | Task                               | Priority | Effort | Depends | Lane | SUPER | Acceptance                    |
| --- | ---------------------------------- | -------- | ------ | ------- | ---- | ----- | ----------------------------- |
| 5.1 | 按原级联顺序拆分 CSS               | P0       | L      | 4.5     | A    | S,R   | 三档截图与拆分前一致          |
| 5.2 | 清理重复 CSS 和修正区              | P1       | M      | 5.1     | A    | S,R   | 单文件低于预算且视觉一致      |
| 5.3 | 拆 demo data、release notes 与 E2E | P1       | L      | 4.5     | B    | S,R   | 原 CLI 与测试命令一致         |
| 5.4 | 启用 CI 架构强制门禁并更新契约     | P0       | M      | 5.2,5.3 | A    | U,P   | 循环、越层和规模回归会阻断 CI |

## Phase 6：全链路验收与归档

| ID  | Task                                 | Priority | Effort | Depends | Lane | SUPER | Acceptance                      |
| --- | ------------------------------------ | -------- | ------ | ------- | ---- | ----- | ------------------------------- |
| 6.1 | 运行旧库迁移、API、E2E 与打印回归    | P0       | L      | 5.4     | A    | P,R   | 全部兼容矩阵通过                |
| 6.2 | 运行 benchmark、构建和包体对比       | P1       | M      | 5.4     | B    | E,R   | 性能与包体无显著回退            |
| 6.3 | 验证离线包、Docker 和 Gitea workflow | P0       | M      | 6.1,6.2 | A    | E,R   | 正式制品可运行                  |
| 6.4 | 更新发布记录并归档规格资料           | P1       | S      | 6.3     | A    | R     | 资料进入 archives，工作目录清理 |
