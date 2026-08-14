# CageLedger UI 组件标准

## 组件来源

- 桌面与平板端使用 `antd`；移动端使用 `antd-mobile`。
- `src/react/components/ui/` 是页面使用的统一适配层。
- 页面组件优先组合 `ActionButton`、`CommandBar`、`WorkspaceToolbar`、Ant `Form`、`Table`、`Card`、`Modal`、`Drawer`、`Empty` 与 `Result`。
- 笼位图、数量台账网格、巡检评分、图表与打印模板可保留专用 DOM；数量台账中的输入、选择、日期与确认操作使用 Ant `Input`、`Select`、`DatePicker` 或 `Modal`，通用操作、状态与浮层使用适配层。

## 视觉与交互

- 主操作使用 `primary`；常规操作使用默认按钮；低频操作使用 text/link；破坏性操作使用 danger。主色种子为 `#1677ff`，白字主按钮与正文链接采用 Ant 官方深色阶保证 AA 对比度。
- 控件高度采用 Ant 默认 `32px`，紧凑操作使用 `24px`，强调操作使用 `40px`。
- 颜色、阴影、圆角、层级与动效通过 Ant Theme 和 `src/styles/tokens.css` 的语义 Token 提供。
- Tooltip 用于简短说明；Popver 用于可点击说明；Modal 和 Drawer 用于完整任务。
- 图标按钮提供 `aria-label` 和 Tooltip；表单错误与字段使用 `aria-describedby` 关联。
- 首屏远程数据、路由懒加载和详情弹窗加载统一使用 `PageSkeleton` 与 Ant `Skeleton`。骨架屏提供 `role="status"`、`aria-busy="true"` 和明确加载名称；错误态继续使用 `PageState`，空态继续使用 `Empty`。

## 响应式与动效

- `761px` 以上使用桌面 Ant Layout；`760px` 以下使用 antd-mobile TabBar 与 Popup。
- 动效使用 transform 和 opacity：按压 100ms、浮层 200ms、Drawer/Modal 300ms，对应 Ant Design 的 `motionDurationFast`、`motionDurationMid`、`motionDurationSlow`。
- `prefers-reduced-motion` 下保留状态色与透明度，移除位移与缩放。

## 布局归属与改动流程

- 一个组件的网格、尺寸、间距和断点只由一个样式层负责。唯一归属登记在 [`style-ownership.md`](./style-ownership.md) 与 `src/styles/style-ownership.json`；Shell 规则归属 `shell.css`，通用组件归属 `components.css`，领域页面归属对应 feature CSS，Ant Token 覆盖归属主题层。
- 通用样式只定义 Token、基础状态和跨页面可复用行为。通用样式不得直接改变业务组件的 `grid-template-columns`、固定宽度、定位或断点布局。
- 领域组件使用完整的作用域选择器，例如 `.animal-management-workspace .inspection-module-picker`。组件改造同步清理旧 class、旧媒体查询和已失效的同名选择器。
- 同名 class 出现多个定义时，变更前必须列出来源、加载顺序和适用断点；完成后保留唯一的布局定义，状态样式通过修饰类或 Ant 状态类补充。
- 自适应网格优先使用 `repeat(auto-fit, minmax(...))`；桌面、平板与移动端分别验证列数、最小宽度、文字截断和操作可达性。固定窄列只用于明确的紧凑控件。
- 页面级视觉修复完成前检查 computed style：`display`、`grid-template-columns`、`gap`、`min-width`、`overflow`、`position` 和 `z-index` 必须与组件规范一致。

## UI 回归门禁

- 布局、导航、表格、表单、弹窗、浮层和响应式改动都需要桌面、1180px、760px、手机横屏四档验证。
- 视觉回归同时覆盖默认、hover、focus-visible、disabled、loading 和内容溢出状态；交互组件额外覆盖键盘焦点与关闭/返回路径。
- 截图差异出现时先定位样式来源与 computed style，再修改组件规则。禁止连续叠加页面级覆盖规则处理同一视觉问题。
- 组件存在遗留样式时，任务验收包含“旧规则已删除或已迁移”的代码检查；保留规则需写明仍服务的组件与断点。

## 项目门户

- `/` 提供公开项目门户，只呈现产品定位、能力、流程和资源入口。
- `/app` 是登录、会话判断和运营工作台的固定入口；公开扫码路径继续独立。
- 门户使用 Ant `Layout`、`Typography`、`Button`、`Card`、`Steps`、`Tag`、`Anchor`
  与 `Divider`，共享主题 Token，不读取任何业务数据。
- 桌面端使用顶部锚点导航；移动端保持单列内容与固定系统入口。

## 质量门禁

- `npm run check:ui-contract` 校验适配层、文档、`transition: all` 与未登记高 z-index；`npm run check:style-ownership` 校验唯一样式归属、Ant 选择器边界与层级 Token；`npm run check:antd-design` 执行本地 `antd doctor`、`antd usage`、`antd lint` 并输出机器可读报告。
- 新页面和公共组件通过 `npm run check`、键盘导航、浅色/深色与移动端截图验收。
