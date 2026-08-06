# 巡检标准在线编辑器 — Progress Tracker

- **Tracking Mode**: `LOCAL_ONLY`
- **分支**: `beta`

## References

- [Project Overview](../analysis/animal-inspection-catalog-editor/project-overview.md)
- [Module Inventory](../analysis/animal-inspection-catalog-editor/module-inventory.md)
- [Risk Assessment](../analysis/animal-inspection-catalog-editor/risk-assessment.md)
- [Task Breakdown](../plan/animal-inspection-catalog-editor/task-breakdown.md)
- [Dependency Graph](../plan/animal-inspection-catalog-editor/dependency-graph.md)
- [Milestones](../plan/animal-inspection-catalog-editor/milestones.md)

## Phase Checklist

- [x] Phase P0: 后端草稿/发布/图片 (4/4 tasks) — [phase-0-backend.md](phase-0-backend.md)
- [x] Phase P1: 前端在线编辑 (3/3 tasks) — [phase-1-frontend.md](phase-1-frontend.md)
- [x] Phase P2: 一致性收尾 (3/3 tasks) — [phase-2-consistency.md](phase-2-consistency.md)
- [x] Phase P3: 前端硬编码摘除 (1/1 tasks) — [phase-3-hardcode-removal.md](phase-3-hardcode-removal.md)

## Adaptive Control State

```yaml
adaptive:
  drift_score: 0
  strategy: "bottom-up（先数据契约，再 UI，最后清理）"
  thresholds:
    annotate: 3
    replan: 5
    rescope: 7
  total_tasks: 11
  completed_tasks: 11
  last_updated: "2026-08-06T08:40:00+08:00"
```

## Task Telemetry Log

| Task                 | Effort | S.U.P.E.R | Unplanned Deps | Notes                                                                                      |
| :------------------- | :----- | :-------- | :------------- | :----------------------------------------------------------------------------------------- |
| T1 catalog_schema.py | M      | S, P      | —              | 父级引用同时支持节点 id 与 code；参考图存在性校验需注入 image_root                         |
| T2 草稿接口          | M      | U, P      | T1             | 单草稿模型；GET 无草稿时克隆 active；PUT 乐观锁 expectedUpdatedAt                          |
| T3 发布接口          | S      | U, R      | T2             | active→history、draft→active、manual-YYYYMMDD-HHMM；写审计                                 |
| T4 图片上传          | M      | E, R      | —              | data 目录 + 种子幂等迁移 + 路由回退；白名单 jpg/png/webp ≤5MB                              |
| T5 编辑模式          | XL     | S, U      | T2             | 目录树 + 节点表单 + 草稿保存；antd v6 弃用项清理；表单转换与 diff 归一修复                 |
| T6 图片管理          | M      | R         | 4, 5           | 上传即落盘并绑定节点引用；替换/删除/缩略图                                                 |
| T6 图片管理          | M      | R         | 4, 5           | 上传即落盘并绑定节点引用；替换/删除/缩略图                                                 |
| T7 发布确认          | M      | P         | 3, 5           | 差异摘要弹窗 + 只读视图草稿提示；发布后标准页更新                                          |
| T8 历史版本回滚      | S      | U, R      | 3              | versions 列表 + restore（历史内容发布为新版本）；种子版本 payload 无 moduleCode 的校验修复 |
| T9 目录数据清理      | M      | P         | 5              | 删除 4 个节点（3 跳过 + 1 去重合并）；种子升 v2；渲染集不变（125/32/26）                   |
| T10 契约与回归       | M      | P         | 2–9            | api-contracts + 3 条 e2e（编辑-发布/房管只读/版本回滚）+ 全量验证                          |
| T11 硬编码摘除       | L      | R         | 9              | 区域/分组/改名迁入 config.presentation；删除 8 条重名条目；渲染签名一致                    |

## Current Status

全部 11/11 完成。巡检标准支持在线编辑、图片、草稿/发布、历史版本回滚；目录数据已清理并配置化（233 节点，v3），异常模块表单渲染完全由目录 config 驱动，model.ts 无硬编码过滤。

## Next Steps

1. 实现 `catalog_schema.py` 校验模块（T1）
2. 草稿接口（T2）→ 发布接口（T3）→ 图片上传（T4）
3. 每完成一个任务更新本文件与对应 phase 文件

## Session Log

- 2026-08-05：启动规范驱动流程，完成 Phase 0-5 文档与子技能，开始 P0 实现
- 2026-08-05：完成 P0 全部 4 个任务（校验/草稿/发布/图片），后端测试 113 全绿，API 冒烟通过
- 2026-08-06：完成 P1 全部 3 个任务（编辑模式/图片管理/发布确认），Playwright 浏览器验收通过，npm run check 全绿
- 2026-08-06：完成 P2 全部 3 个任务（历史版本回滚/目录数据清理/契约与回归），22 条 e2e 全绿
- 2026-08-06：完成 P3（区域/分组/改名迁入 config，摘除 model.ts 硬编码），11/11 全部完成，归档至 docs/archives/animal-inspection-catalog-editor/
