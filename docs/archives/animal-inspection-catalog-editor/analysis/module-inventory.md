# Module Inventory — 巡检目录相关模块

| Module                       | Responsibility                        | Dependencies       | Files | Lines | Complexity | S.U.P.E.R           |
| :--------------------------- | :------------------------------------ | :----------------- | ----: | ----: | :--------- | :------------------ |
| catalog.py                   | 目录文件导入为版本化 DB 行            | config, db, shared |     1 |  ~120 | Medium     | S🟢 U🟢 P🟡 E🟢 R🟢 |
| catalog_payload.py           | 目录 payload 展示（参考图 URL 改写）  | shared             |     1 |   ~40 | Low        | S🟢 U🟢 P🟡 E🟢 R🟢 |
| animal_management/service.py | 巡检业务（录入、结论、附件、审计）    | 目录、附件仓库     |     1 |  ~750 | High       | S🟡 U🟢 P🟡 E🟢 R🟡 |
| legacy.py（目录路由段）      | GET 目录路由 + 鉴权                   | animal_management  |     1 |     — | High       | S🟡 U🟢 P🟡 E🟢 R🟡 |
| model.ts                     | 前端目录分组/区域重组（含硬编码过滤） | contracts          |     1 |  ~230 | Medium     | S🟡 U🟢 P🟡 E🟢 R🟡 |
| InspectionStandards.tsx      | 巡检标准只读展示                      | api, model         |     1 |   ~90 | Low        | S🟢 U🟢 P🟡 E🟢 R🟢 |
| InspectionModuleForms.tsx    | 目录渲染为录入表单                    | model, contracts   |     1 |  ~360 | Medium     | S🟡 U🟢 P🟡 E🟢 R🟡 |

> S.U.P.E.R 评分：🟢 合规 / 🟡 部分 / 🔴 违规。评分基于代码现状。

## Module Details

### 目录数据层（catalog.py + catalog_payload.py）

- **Responsibility**：把 xbehav JSON 资源导入为版本化表；对外输出 active 版本 payload（含参考图 URL 改写）
- **Public API**：`ensure_catalog_rows`、`catalog_payload`、`prepare_catalog_payload`
- **Transformation Notes**：新增草稿/发布能力时，工作源从「文件导入」转为「DB 行编辑」；文件仅作种子

### 前端重组层（model.ts）

- **Responsibility**：把目录节点按模块/分类/子分类分组；异常模块做区域重组
- **S.U.P.E.R 关键问题**：`abnormalAnimalBodyRegions` 内含硬编码过滤（跳过 3 个节点）、改名（`renameFurSkinItemName`）、分组覆盖（`*_GROUP_OVERRIDES`）——目录数据与表单渲染不一致的根源；编辑器落地后应迁移进目录 config（P3）

### 巡检标准页（InspectionStandards.tsx）

- **Responsibility**：只读展示 active 目录摘要（版本、模块卡片、条目数）
- **Transformation Notes**：加「编辑标准」管理员模式；计数改用 `moduleItemCount`（已修）
