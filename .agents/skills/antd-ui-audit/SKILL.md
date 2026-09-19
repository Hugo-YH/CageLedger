---
name: antd-ui-audit
description: 审查或修复 CageLedger UI 的 Ant 组件一致性、样式归属、响应式与焦点问题。纯 Ant API 查询使用 antd。
---

# CageLedger UI 一致性

以仓库 `docs/contracts/ui-component-standard.md`、`ui-interaction-system.md` 和 `style-ownership.md` 的相关条目为准。范围由用户目标确定：单点问题检查相关页面与共用组件，全系统审查覆盖实际入口和典型数据、编辑、错误状态。用户要求修复时，完成实现与验收；静态检查通过不代表页面效果已验证。

- 用 `rg` 定位目标选择器、data attribute、媒体查询和导入顺序，在 `src/styles/style-ownership.json` 确认唯一布局来源；替换旧规则，不追加覆盖层。
- 沿用 `src/react/components/ui/`、Ant 原语和语义 Token。桌面/平板用 antd，移动导航用 antd-mobile；领域网格与打印可保留专属 DOM。
- 主题基线见 `docs/contracts/antd-design-language.md`，保持官方蓝和项目控件尺寸；组件 API 不确定时使用本地 `antd` Skill 查询。
- 表单、Portal、四档视口、computed style 和截图证据按 `docs/contracts/testing-strategy.md` 的 UI 回归流程执行。
- 输出实际问题、修改和验证结果。只有当前任务确有活动计划时才更新进度；不更新历史归档，也不要求架构评分。
