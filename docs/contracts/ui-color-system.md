# CageLedger UI 配色语义规范

本文件约束前端颜色使用方式。目标是让页面状态、业务含义和交互反馈保持一致，后续新增模块优先复用 `src/styles.css` 的语义变量。

## 颜色分层

| 层级 | 变量 | 用途 |
| --- | --- | --- |
| 品牌主色 | `--primary`、`--primary-dark`、`--primary-ink`、`--primary-soft` | 主按钮、主导航、当前焦点、主业务入口、主色浅底 |
| 基础表面 | `--bg`、`--panel`、`--surface-*` | 页面背景、卡片、工具栏、输入区域 |
| 文字与边框 | `--text`、`--muted`、`--line`、`--line-strong` | 正文、辅助文字、分割线、表格线 |
| 表格 | `--table-head`、`--table-row-hover` | 表头、普通悬停行 |
| 选中态 | `--selection-soft`、`--selection-line`、`--selection-shadow` | 勾选行、当前批次、当前对象 |
| 预留态 | `--reserved`、`--reserved-soft`、`--reserved-line`、`--reserved-text` | 已预约笼位、待进驻预留、预留图例 |
| 盘点态 | `--inspect`、`--inspect-soft`、`--inspect-line` | 后续扫码盘点、识别命中、盘点确认 |
| 成功态 | `--green`、`--success-soft`、`--success-line` | 在用、完成、保存成功、有效记录 |
| 待办态 | `--todo-soft`、`--todo-line`、`--todo-text` | 待处理、待提交、批量操作提示 |
| 警示态 | `--amber`、`--warning-soft`、`--warning-line` | 待检查、缺字段、格式提醒 |
| 危险态 | `--danger`、`--danger-soft`、`--danger-line` | 删除、失败、冲突、不可恢复动作 |
| 财务态 | `--finance-soft`、`--finance-line`、`--finance-text` | 报销、经费、财务流程和金额状态 |

## 使用规则

1. 页面主操作使用 `--primary`，例如保存、发起流程、开始识别。
2. 次级操作使用浅底描边，边框走 `--line` 或 `--line-strong`。
3. 表格勾选行、批量选择、当前对象统一使用 `--selection-*`。
4. 笼位“已预约”和待进驻预留统一使用 `--reserved-*`。
5. 扫码盘点相关命中、连续识别、已盘点状态统一使用 `--inspect-*`。
6. 表单错误、缺类型、缺日期、缺伦理号统一使用 `--warning-*`；保存失败和删除确认使用 `--danger-*`。
7. 财务登记、报销状态、欠缴汇总优先使用 `--finance-*`，金额数字保持正文色或危险色。
8. 普通说明和帮助提示使用 `--info-*`，页面内长期可见的状态提示使用对应业务状态色。

## 新增颜色流程

新增颜色先判断是否能归入现有语义层级。确需新增时按下面格式加入 `:root`：

```css
--业务名: #123456;
--业务名-soft: #f2f7f5;
--业务名-line: #c8dad5;
--业务名-text: #0b5f56;
```

新增后同步更新本文件，并在代码里使用变量名表达业务语义。

## 常见映射

| 场景 | 使用变量 |
| --- | --- |
| 待接收批次表格勾选行 | `--selection-*` |
| 数量统计表当前录入行 | `--selection-*` 或 `--primary` 细边 |
| 笼位图已预约 | `--reserved-*` |
| 笼卡识别成功 | `--inspect-*` |
| 保存成功通知 | `--success-soft`、`--success-line` |
| 保存失败通知 | `--danger-soft`、`--danger-line` |
| 缺字段提醒 | `--warning-soft`、`--warning-line` |
| 报销中、财务流程 | `--finance-*` |

## 审查清单

- 新样式优先使用语义变量。
- 表格选中态统一使用 `--selection-*`。
- 笼位状态图例、卡片和预览使用同一组状态变量。
- 危险、警示、成功、财务状态保持各自语义色。
- 新增硬编码色值需要有明确场景，并补充到本文件。
