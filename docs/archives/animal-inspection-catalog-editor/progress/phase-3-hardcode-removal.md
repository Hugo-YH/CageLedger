# Phase P3: 前端硬编码摘除

- [x] T11 `ABNORMAL_BODY_REGIONS`/改名/过滤/分组覆盖迁入 config，摘除 model.ts 硬编码 — 验收：表单渲染与目录数据直接一致

## Notes

- 完成：2026-08-06。
- 数据：异常模块 25 个子分类写入 `config.presentation.region`（区域归属），4 个分组覆盖写 `groupName/groupSortOrder`，fur-skin 10 条写组名，2 条改名写 `displayName`；删除 8 条被旧去重隐藏的重名条目（被毛油腻 ×3、脱毛 ×2、伤口 ×2、被毛竖立 ×1），节点 241 → 233；种子升 `cageledger-v3-20260806`。
- 模型：`abnormalAnimalBodyRegions` 改为纯 config 驱动（区域静态词表保留，归属/分组/改名全部读节点配置）；删除 ABNORMAL_BODY_REGIONS 映射、FUR_SKIN_GROUPS、renameFurSkinItemName、GROUP_OVERRIDES 与 3 个跳过规则。
- 验证：新模型(v3) 与旧模型(v2) 渲染签名完全一致（RENDER_IDENTICAL）；浏览器实测录入表单 7 大区域与分组计数不变，改名条目（皮下肿瘤/皮下肿胀）经 config 渲染。
