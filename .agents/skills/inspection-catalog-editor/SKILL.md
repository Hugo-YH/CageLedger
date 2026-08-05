---
name: inspection-catalog-editor
description: 巡检标准在线编辑器的规范开发子技能。用于在 CageLedger 中实现或修改动物巡检目录（基础/进阶/异常动物评估）的草稿编辑、发布、校验、参考图上传与前端编辑模式。触发场景：修改 animal_management 目录相关后端接口、InspectionStandards 编辑模式、目录数据清理、ABNORMAL_BODY_REGIONS 硬编码摘除。
---

# 巡检标准在线编辑器

## 工作流

1. 开始任何工作前，先读 `docs/progress/MASTER.md`（跨会话连续性协议）和 `docs/progress/phase-N-*.md`，确认当前任务
2. 每完成一个任务：跑 S.U.P.E.R Code Review Checklist → 更新进度文件勾选项 → 在 MASTER.md 的 Telemetry Log 记录 effort/S.U.P.E.R/未计划依赖
3. 全部完成后触发归档：`docs/archives/animal-inspection-catalog-editor/`

## S.U.P.E.R 架构原则（必须内联遵守）

> Write code like building with LEGO — each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

- **S — Single Purpose**：每个模块/文件/函数只解决一个问题；说不出单一职责就要拆分。Litmus：一句话能描述模块职责。
- **U — Unidirectional Flow**：数据单向 input → processing → output；依赖指向内层，无环。Litmus：核心逻辑能否零外部服务跑单测。
- **P — Ports over Implementation**：先定义接口契约（JSON schema/类型），跨模块 I/O 必须可序列化。Litmus：换数据源/渲染层不碰核心逻辑。
- **E — Environment-Agnostic**：配置从环境/配置文件注入，依赖显式声明，进程无状态。Litmus：换机器零改动可跑。
- **R — Replaceable Parts**：任意层可替换且不影响其他层。Litmus：替换组件只动该模块。

## S.U.P.E.R Code Review Checklist（每个任务完成后必跑）

1. 该模块/函数是否只有一个职责？2. 依赖是否单向无环？3. 跨模块 I/O 是否有显式 schema/类型？4. 是否无硬编码路径/配置？5. 替换某层是否只动该层？6. 是否避免循环导入？7. 错误路径是否返回结构化错误？8. 新增接口是否管理员鉴权？9. 是否补了对应测试？10. 是否更新了契约文档？

**评分**：全部通过 → 任务完成；1-2 项失败 → 先修复；3 项以上失败 → 停下重构。

## 本任务关键约束（来自 risk-assessment）

- 目录草稿/发布契约必须先在 `catalog_schema.py` 定义，再写接口
- 图片存 `data/animal-inspection-images/`（Docker volume），种子图首启幂等迁移；类型白名单 jpg/png/webp ≤5MB
- 单草稿模型 + `expectedUpdatedAt` 乐观锁；写接口 `role=admin`
- P0 阶段新增条目限定在现有分类/子分类 code 下，保证异常模块表单可见
- 发布 = 旧 active → history、draft → active，版本号 `manual-YYYYMMDD-HHMM`，写审计日志
- 不要改动答案快照语义（历史记录引用旧目录不受影响）

## 进度更新

- 完成一个任务后：勾选 `docs/progress/phase-N-*.md` 对应项 → 更新 `docs/progress/MASTER.md` 的 Phase Checklist 计数、Current Status、Task Telemetry Log（effort/S.U.P.E.R/未计划依赖）
- 会话开始和结束都要更新 MASTER.md 的 Current Status

## 自适应控制

MASTER.md 的 Adaptive Control State 维护 `drift_score`；超过阈值（annotate 3 / replan 5 / rescope 7）必须停下执行对应响应动作并告知用户。
