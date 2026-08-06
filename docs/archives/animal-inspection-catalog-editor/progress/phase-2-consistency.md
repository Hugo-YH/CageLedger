# Phase P2: 一致性收尾

- [x] T8 历史版本查看与回滚 — 验收：可查看旧版本并回滚
- [x] T9 目录数据清理（删除被跳过节点、合并重名）— 验收：标准页计数与表单一致
- [x] T10 契约与回归（api-contracts、测试、e2e）— 验收：check + e2e 全绿

## Notes

- 完成：2026-08-06。
- T8：`GET /api/animal-inspection-catalog/versions` + `POST .../versions/{version}/restore`（回滚=把历史版本内容发布为新 active，旧 active 转 history，写审计）；前端「版本历史」弹窗，回滚前 Popconfirm。
- T9：种子数据删除 4 个节点（3 个前端跳过的 + 1 个被去重合并的 皮下肿胀），241 节点；种子版本升为 `cageledger-v2-20260806`；模型验证渲染集不变（125 条异常项、32/26 基础/进阶）。
- T9 修复：restore 校验种子导入版本时改用重构节点（原始 payload 无 moduleCode）；导入/发布/回滚统一降级所有旧 active，版本列表按有效 active 标记 `isActive`。
- T10：api-contracts 补 versions/restore；新增 `tests/e2e/inspection-catalog.spec.ts` 3 条（编辑-发布、房管只读、版本历史回滚）；`npm run check` + 22 e2e 全绿。
