# CageLedger UI 组件标准

## 组件来源

- 通用业务组件使用 `antd`；移动导航使用 `antd-mobile`。
- `src/react/components/ui/` 是页面使用的统一适配层。
- 页面组件优先组合 `ActionButton`、`CommandBar`、`WorkspaceToolbar`、Ant `Form`、`Table`、`Card`、`Modal`、`Drawer`、`Empty` 与 `Result`。
- 笼位图、数量台账网格、巡检评分、图表与打印模板可保留专用 DOM；数量台账中的输入、选择、日期与确认操作使用 Ant `Input`、`Select`、`DatePicker` 或 `Modal`，通用操作、状态与浮层使用适配层。

## 视觉与交互

- 每个操作区最多一个 `primary`；常规操作使用默认按钮；明确标记的低频操作进入“更多”，行内最多两个常用动作；破坏性操作使用 danger 并保留确认。
- 桌面控件 `32px`、紧凑操作 `24px`；手机表单控件 `40px`、输入文字 `16px`，按钮触控目标至少 `44px`。
- 主题唯一来源是 `src/theme/visual-system.mjs`。ConfigProvider 直接消费；`scripts/generate_theme.mjs` 从相同算法生成 `brand-tokens.css`，`tokens.css` 只保留语义映射；文档站消费相同变量。
- 正文 14px/22px，说明 12px/20px；页标题 24px/32px，分区标题 16px/24px；正文 400、标题 600。页面桌面内边距 24px、手机 16px。普通编辑表单最大 1200px，桌面两列、手机一列，专用矩阵独立横向滚动。
- Tooltip 用于简短说明；Popver 用于可点击说明；Modal 和 Drawer 用于完整任务。
- 图标按钮提供 `aria-label` 和 Tooltip；表单错误与字段使用 `aria-describedby` 关联。
- 首屏远程数据、路由懒加载和详情弹窗加载统一使用 `PageSkeleton` 与 Ant `Skeleton`。骨架屏提供 `role="status"`、`aria-busy="true"` 和明确加载名称；错误态继续使用 `PageState`，空态继续使用 `Empty`。

## 响应式与动效

- `768px` 及以上使用桌面 Ant Layout；小于 `768px` 使用 antd-mobile TabBar 与 Popup。
- 动效由 Ant 官方 `motionDurationFast/Mid/Slow`（100/200/300ms）与命名缓动派生。按钮不统一缩放或位移，不添加整页入场和批量行延迟动画。
- 运营工作台和公开入口不使用持续循环的装饰动画；无限动画仅允许用于明确的加载指示器。
- `prefers-reduced-motion` 下保留状态色与透明度，移除位移与缩放。

## 布局归属与改动流程

- 一个组件的网格、尺寸、间距和断点只由一个样式层负责。唯一归属登记在 [`style-ownership.md`](./style-ownership.md) 与 `src/styles/style-ownership.json`；Shell 规则归属 `shell.css`，通用组件归属 `components.css`，领域页面归属对应 feature CSS，Ant Token 覆盖归属主题层。
- 通用样式只定义 Token、基础状态和跨页面可复用行为。通用样式不得直接改变业务组件的 `grid-template-columns`、固定宽度、定位或断点布局。
- 领域组件使用完整的作用域选择器，例如 `.animal-management-workspace .inspection-module-picker`。组件改造同步清理旧 class、旧媒体查询和已失效的同名选择器。
- 同名 class 出现多个定义时，变更前必须列出来源、加载顺序和适用断点；完成后保留唯一的布局定义，状态样式通过修饰类或 Ant 状态类补充。
- 自适应网格优先使用 `repeat(auto-fit, minmax(...))`；桌面、平板与移动端分别验证列数、最小宽度、文字截断和操作可达性。固定窄列只用于明确的紧凑控件。
- 页面结构性改动或样式冲突排查时，检查受影响的 computed style：`display`、`grid-template-columns`、`gap`、`min-width`、`overflow`、`position` 和 `z-index`；局部小改的验证范围按测试策略确定。

## UI 回归门禁

- 验证范围统一遵守 [测试策略](testing-strategy.md) 的局部小改与结构性改动分级，不因涉及表单、弹窗或浮层就默认四档视口和全套检查。
- 只覆盖本次受影响的默认、hover、focus-visible、disabled、loading 和内容溢出状态；交互改变时检查对应键盘焦点与关闭/返回路径。
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
- 新页面和公共组件按测试策略验证相关交互、主题与移动端表现；`npm run check` 留到提交或发布前统一执行，不在每个局部调整后重跑。
