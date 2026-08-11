# CageLedger UI 颜色与交互语义

本契约约束 React 工作台的颜色、状态、按钮、表格和浮层。颜色源位于 `src/styles/tokens.css`、`src/react/components/ui/AntdProvider.tsx` 和 `src/styles/features/antd-system.css`。页面通过 `src/react/components/ui/` 使用 Ant Design 组件与项目语义适配器。`data-theme="light"` 和 `data-theme="dark"` 映射 Ant 的浅色、深色算法，系统偏好由应用解析为当前主题。

## 基础层

| 语义       | 变量                                                               | 用途                             |
| ---------- | ------------------------------------------------------------------ | -------------------------------- |
| 页面与卡片 | `--bg`、`--panel`、`--panel-soft`、`--surface-*`                   | 页面背景、工作区、卡片、工具栏   |
| 控件与浮层 | `--control-bg*`、`--toolbar-bg`、`--surface-overlay`、`--backdrop` | 输入控件、吸附工具栏、弹窗与遮罩 |
| 文字       | `--text`、`--text-strong`、`--muted`、`--text-subtle`              | 正文、标题、辅助信息与次级说明   |
| 边界       | `--line`、`--line-strong`                                          | 卡片、输入、表格和分区           |
| 品牌       | `--ant-color-primary`、`--primary`、`--primary-soft`               | 当前入口、主操作、焦点           |
| 阴影       | `--shadow`、`--shadow-soft`、`--shadow-lift`、`--shadow-pop`       | 页面层、悬浮层、弹窗             |
| 焦点       | `--focus-ring*`                                                    | 键盘焦点和危险/警示焦点          |
| 动效       | `--motion-*`、`--ease-*`                                           | hover、展开、弹窗和页面切换      |

## 业务状态层

| 状态 | 变量                     | 典型场景                       |
| ---- | ------------------------ | ------------------------------ |
| 选中 | `--selection-*`          | 勾选行、当前批次、当前统计表   |
| 预留 | `--reserved-*`           | 已预约笼位、待进驻预留         |
| 盘点 | `--inspect-*`            | 二维码识别、后续盘点确认       |
| 成功 | `--green`、`--success-*` | 在用、保存成功、流程完成       |
| 待办 | `--todo-*`               | 待提交、待处理、开放任务       |
| 警示 | `--amber`、`--warning-*` | 缺字段、待检查、异常但可继续   |
| 危险 | `--danger*`              | 删除、失败、冲突和不可恢复动作 |
| 财务 | `--finance-*`            | 报销、经费、欠缴和财务状态     |
| 信息 | `--info-*`               | 详情、帮助和只读说明           |

状态色表达业务含义。选中态使用连续行底色，单元格之间不增加彩色竖线；表格结构线继续使用 `--line`。

主色种子固定为 Ant Design 官方蓝 `#1677ff`。白字紧凑控件、14px 链接和危险文字操作使用官方深色阶 `#0958d9`、`#cf1322`，保证正文对比度达到 WCAG AA。

## 组件与按钮层级

| 类                                 | 语义                 | 示例                     |
| ---------------------------------- | -------------------- | ------------------------ |
| Ant / 适配器                       | 语义                 | 示例                     |
| ---------------------------------- | -------------------- | ------------------------ |
| `ActionButton tone="primary"`      | 当前操作区唯一主操作 | 保存、确认、正式入驻     |
| `ActionButton tone="secondary"`    | 常规次操作           | 编辑、导出、展开         |
| `ActionButton tone="tertiary"`     | 低权重动作           | 关闭、取消、辅助入口     |
| `ActionButton tone="destructive"`  | 破坏性动作           | 删除、撤回、退出         |
| `ActionButton tone="icon"`         | 紧凑图标操作         | 表格行内工具             |

同一操作区保留一个最强主按钮。展开和收起使用不同状态：展开态使用浅主色底和强调边框，收起态使用普通次操作色；按钮文字和 `aria-expanded` 同步。

流程推进采用 `primary`，预览与详情采用 `secondary` 或 `tertiary`。工具栏从左到右固定为范围摘要、辅助操作、唯一主操作，主操作通过 `CommandBar` 固定在右侧。

## 交互状态

| 状态     | 规则                                           |
| -------- | ---------------------------------------------- |
| Default  | 对比度满足正文和边界识别                       |
| Hover    | 调整底色、边框和阴影，保持控件尺寸稳定         |
| Active   | 使用轻微按压反馈，不改变布局                   |
| Focus    | 使用 3px 透明语义焦点环                        |
| Disabled | 降低对比度，保留标签可读性和语义色来源         |
| Loading  | 保持原按钮宽度，禁止重复提交                   |
| Expanded | 浅主色底、强调边框、方向明确的图标或文字       |
| Selected | 连续浅色背景和行级边界，不绘制单元格彩色分隔条 |

## 表格

- 表头使用 `--table-head`，固定表头保持不透明背景。
- 普通 hover 使用 `--table-row-hover`。
- 选中行使用 `--selection-soft`，首列可使用单条内嵌强调线。
- 状态标签使用业务状态色，整行底色只表达选中、错误或明确的业务异常。
- 操作列按钮高度统一，危险动作保持红色语义。
- 横向滚动容器提供边界提示，表头和首行保持完整可见。

## 表单

- 输入、选择和日期控件使用同一高度、边框和焦点环。
- `focus-within` 可以强调当前字段组，避免改变尺寸。
- 校验错误使用 `--warning-*`，提交失败使用 `--danger-*`。
- checkbox 和 radio 使用原生比例，尺寸通过专用类控制。
- 高频录入行可叠加当前行状态和错误状态，错误状态优先显示。

## 浮层与通知

| 层             | 视觉与定位                                             |
| -------------- | ------------------------------------------------------ |
| 帮助气泡       | `HelpPopover` 与 Ant `Tooltip`，避让 viewport 四周边界 |
| 站内通知       | 固定在浏览器窗口内，成功/警示/失败使用对应语义色       |
| 下拉与日期面板 | 高于页面卡片，保持输入锚点关系                         |
| 业务弹窗       | `position: fixed` 相对 viewport，遮罩覆盖工作区        |
| 确认弹层       | 高于普通业务弹窗，危险动作保持红色焦点                 |

弹窗位置以浏览器窗口为基准。页面滚动不会改变弹窗的可见位置。

- 业务说明、问号帮助和评分解释使用 `HelpPopover` 或 Ant `Tooltip`，由 Ant Portal 挂载到 `document.body`。
- Tooltip 相对触发元素定位，保留 12px 视口安全边距，根据可用空间选择上方、下方、左侧或右侧。
- Tooltip 使用 `autoAdjustOverflow`，滚动与窗口变化时按 Ant 浮层机制重定位。
- Tooltip 层级高于工作区卡片、局部滚动容器和侧边导航；卡片、表格和弹窗正文不承载 Tooltip DOM。
- 原生 `title` 用于截断的静态表格文本与 iframe 等语义标题；按钮、开关、输入和评分控件使用 Tooltip 或紧邻说明文本。

## 动效与可访问性

- 常规过渡使用 `--motion-base` 和 `--ease-standard`。
- hover 不使用大幅位移。
- 弹窗和通知使用透明度与轻微位移。
- `prefers-reduced-motion: reduce` 关闭非必要动画和 transform。
- 帮助提示支持 hover 和 keyboard focus。
- 帮助触发按钮通过 `aria-describedby` 关联 Tooltip；Tooltip 内容保持简短，避免遮挡主要操作。
- 图标按钮提供 `aria-label`，展开控件提供 `aria-expanded`。
- 文字颜色与背景保持可读对比度，颜色之外同时提供文字、图标或结构提示。

## 设计尺度

- 间距使用 4px 基线：`--space-1` 至 `--space-8`。
- 控件默认高度为 `32px`，紧凑操作为 `24px`，强调操作为 `40px`；对应 Ant Design 的默认、`small` 与 `large` 尺寸。
- 面板使用 `--radius-panel`，控件使用 `--radius-control`，状态标签可使用 999px 圆角。
- 层级使用 `--z-sticky`、`--z-nav`、`--z-popover`、`--z-modal`、`--z-toast`；业务页面使用这些语义层级。
- 深色主题保持状态色含义、文本对比度与表格可读性；页面组件引用语义变量。
- `prefers-reduced-transparency: reduce` 使用实色工具栏与弹窗表面；`prefers-contrast: more` 强化结构边界和控件边框。

## 新增颜色流程

1. 先选择现有基础或业务语义。
2. 确需新增时补齐主色、soft、line、text 四个层次。
3. 在 `:root` 定义变量，在组件类中引用变量。
4. 同步本文件，并检查普通、hover、focus、disabled 和选中状态。

```css
--domain: #123456;
--domain-soft: #f3f7f7;
--domain-line: #c8d8d6;
--domain-text: #123f3a;
```

## 审查清单

- 页面主操作、次操作、流程、警示和危险动作层级清楚。
- 同一业务状态在标签、卡片、表格和图例中使用同一变量组。
- 选中行背景连续，单元格边界保持中性。
- 弹窗、通知和帮助气泡在桌面与移动端均相对 viewport 可见，四边没有裁剪和遮挡。
- 焦点、disabled、loading 和 expanded 状态完整。
- 新色值先进入语义变量或 Ant Theme；页面和业务样式不直接写入颜色值。
- 桌面、移动端和低动效模式完成浏览器检查。
