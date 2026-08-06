# Task Breakdown — 巡检标准在线编辑器

## Overview

- **Total Phases**: 4（P0 后端 / P1 前端编辑 / P2 一致性 / P3 硬编码摘除）
- **Total Tasks**: 11
- **Estimated Total Effort**: XL

## 已确认任务定义（Phase 2）

在「巡检标准」页为管理员提供在线编辑基础评估、进阶评估、异常动物（小鼠）评估三个模块内容：新增/修改/删除条目、修改分类与描述、新增/替换参考图；保存为草稿、服务端校验、发布为新 active 版本；历史版本保留、可回滚；录入表单与标准页同源一致；写接口管理员专属，目录 GET 保持登录可见；单草稿模型 + 乐观锁；图片存 `data/animal-inspection-images/`（Docker volume），种子图首启幂等拷贝。

## S.U.P.E.R Design Constraints

- **S**: 每个新模块单职责（校验/草稿/发布/图片分开）
- **U**: 数据单向：DB → 服务 → API → 前端；无反向依赖
- **P**: 目录草稿/发布契约用显式 schema（`catalog_schema.py`）；跨层 I/O 全部可序列化
- **E**: 图片目录、版本号等从 config/环境注入，不硬编码
- **R**: 前端异常模块分区映射最终迁入目录 config，替换目录数据不影响渲染

## Phase P0: 后端目录草稿、发布与图片（后端）

**Goal**: 目录具备草稿/发布状态机与管理员写接口，图片可运行时上传
**Prerequisite**: 无
**S.U.P.E.R Focus**: P（先定义 schema 契约）、U（单向数据流）

| #   | Task                                                                                                                                        | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria                            |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------ | :------- | :----- | :--------- | :--- | :-------- | :--------------------------------------------- |
| 1   | 目录结构校验模块 `catalog_schema.py`（纯函数：code 唯一、parent 存在且同模块、module 存在、nodeType/input_type 合法、referenceImages 存在） | P0       | M      | —          | A    | S, P      | 单元测试覆盖合法/非法目录                      |
| 2   | 草稿接口：`GET/PUT /api/animal-inspection-catalog/draft`（无草稿时克隆 active；保存前校验；管理员）                                         | P0       | M      | 1          | A    | U, P      | 管理员可保存草稿，房间管理员 403，非法结构 400 |
| 3   | 发布接口：`POST /api/animal-inspection-catalog/draft/publish`（active→history，draft→active，版本号 `manual-YYYYMMDD-HHMM`，审计日志）      | P0       | S      | 2          | A    | U, R      | 发布后 GET 返回新 active，旧版本可查           |
| 4   | 参考图：`POST /api/animal-inspection-catalog/images`（multipart，类型/大小白名单）+ data 目录存储 + 种子图首启迁移 + 参考图路由 data 回退   | P0       | M      | —          | A    | E, R      | 上传返回 URL，路由可读；重启后图片仍在         |

## Phase P1: 前端在线编辑（前端）

**Goal**: 管理员在巡检标准页完成条目增删改与图片维护
**Prerequisite**: P0
**S.U.P.E.R Focus**: U、R

| #   | Task                                                                                                          | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria                              |
| :-- | :------------------------------------------------------------------------------------------------------------ | :------- | :----- | :--------- | :--- | :-------- | :----------------------------------------------- |
| 5   | 巡检标准页编辑模式：目录树（模块→分类→子分类→条目）+ 节点表单（名称/类型/input_type/选项/处置建议）+ 保存草稿 | P1       | XL     | 2          | B    | S, U      | 管理员可增删改条目并保存草稿；房间管理员只见只读 |
| 6   | 图片管理：节点表单参考图区（上传/替换/删除/缩略图）                                                           | P1       | M      | 4, 5       | B    | R         | 上传即落盘并绑定节点引用，可替换删除             |
| 7   | 发布确认：差异摘要（新增/修改/删除计数）+ 只读视图草稿提示                                                    | P1       | M      | 3, 5       | B    | P         | 发布前显示差异，发布后标准页更新                 |

## Phase P2: 一致性收尾

**Goal**: 历史版本管理、目录数据清理、全量验证
**Prerequisite**: P1
**S.U.P.E.R Focus**: R、P

| #   | Task                                                                   | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria                     |
| :-- | :--------------------------------------------------------------------- | :------- | :----- | :--------- | :--- | :-------- | :-------------------------------------- |
| 8   | 历史版本查看与回滚（发布某个 history 版本为 active）                   | P1       | S      | 3          | C    | R         | 可查看旧版本并回滚                      |
| 9   | 目录数据清理：删除前端跳过的 3 个节点、合并重名项（发布为新版本）      | P1       | M      | 5          | C    | P         | 标准页计数与表单一致，录入表单不变      |
| 10  | 契约与回归：api-contracts 文档、服务端/前端测试、e2e 覆盖编辑-发布链路 | P0       | M      | 2–9        | D    | P         | `npm run check` + 19 e2e + 新增测试全绿 |

## Phase P3: 前端硬编码摘除

**Goal**: 异常模块分区/改名/过滤逻辑迁移进目录 config，前端仅按数据渲染
**Prerequisite**: P2
**S.U.P.E.R Focus**: R

| #   | Task                                                                            | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria                      |
| :-- | :------------------------------------------------------------------------------ | :------- | :----- | :--------- | :--- | :-------- | :--------------------------------------- |
| 11  | `ABNORMAL_BODY_REGIONS`/改名/过滤/分组覆盖迁入节点 config，摘除 model.ts 硬编码 | P2       | L      | 9          | C    | R         | 表单渲染与目录数据直接一致，无硬编码过滤 |

### Parallel Lanes

| Lane | Tasks    | Combined Effort | Merge Risk                  | Key Files                                                   |
| :--- | :------- | :-------------- | :-------------------------- | :---------------------------------------------------------- |
| A    | 1–4      | M               | Low                         | server_app/domains/animal_management/catalog*.py, legacy.py |
| B    | 5–7      | XL              | Medium（与 A 接口契约联动） | InspectionStandards.tsx, model.ts                           |
| C    | 8, 9, 11 | M               | Low                         | catalog 数据 + 前端 model                                   |
| D    | 10       | M               | Low                         | tests, docs                                                 |

## Milestones

- M1: P0 完成 — 管理员可在线保存草稿并发布，图片可上传
- M2: P1 完成 — 巡检标准页可在线编辑三类模块内容
- M3: P2 完成 — 历史回滚、目录数据清理、全量验证通过
- M4: P3 完成 — 前端硬编码摘除，目录成为唯一内容源
