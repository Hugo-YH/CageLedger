# CageLedger UI 组件标准

## 组件来源

- 桌面与平板端使用 `antd`；移动端使用 `antd-mobile`。
- `src/react/components/ui/` 是页面使用的统一适配层。
- 页面组件优先组合 `ActionButton`、`CommandBar`、`WorkspaceHeader`、Ant `Form`、`Table`、`Card`、`Modal`、`Drawer`、`Empty` 与 `Result`。
- 笼位图、数量台账网格、巡检评分、图表与打印模板可保留专用 DOM，通用操作、状态与浮层使用适配层。

## 视觉与交互

- 主操作使用 `primary`；常规操作使用默认按钮；低频操作使用 text/link；破坏性操作使用 danger。
- 控件高度采用 Ant 默认 `32px`，紧凑操作使用 `24px`，强调操作使用 `40px`。
- 颜色、阴影、圆角、层级与动效通过 Ant Theme 和 `src/styles/tokens.css` 的语义 Token 提供。
- Tooltip 用于简短说明；Popver 用于可点击说明；Modal 和 Drawer 用于完整任务。
- 图标按钮提供 `aria-label` 和 Tooltip；表单错误与字段使用 `aria-describedby` 关联。

## 响应式与动效

- `761px` 以上使用桌面 Ant Layout；`760px` 以下使用 antd-mobile TabBar 与 Popup。
- 动效使用 transform 和 opacity：按压 120ms、浮层 160ms、Drawer/Modal 220ms。
- `prefers-reduced-motion` 下保留状态色与透明度，移除位移与缩放。

## 项目门户

- `/` 提供公开项目门户，只呈现产品定位、能力、流程和资源入口。
- `/app` 是登录、会话判断和运营工作台的固定入口；公开扫码路径继续独立。
- 门户使用 Ant `Layout`、`Typography`、`Button`、`Card`、`Steps`、`Tag`、`Anchor`
  与 `Divider`，共享主题 Token，不读取任何业务数据。
- 桌面端使用顶部锚点导航；移动端保持单列内容与固定系统入口。

## 质量门禁

- `npm run check:ui-contract` 校验适配层、文档、`transition: all` 与未登记高 z-index。
- 新页面和公共组件通过 `npm run check`、键盘导航、浅色/深色与移动端截图验收。
