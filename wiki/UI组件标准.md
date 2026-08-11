# UI 组件标准

全系统界面以 Ant Design 为桌面和平板基线，移动端使用 antd-mobile。业务页面通过 `src/react/components/ui/` 的适配组件保持统一视觉和交互。

## 组件选型

| 场景       | 标准组件                                                     |
| ---------- | ------------------------------------------------------------ |
| 页面框架   | `Layout`、`Sider`、`Menu`、`Breadcrumb`                      |
| 页面操作   | `Button`、`Space`、`Dropdown`、`Tooltip`                     |
| 表单       | `Form`、`Input`、`Select`、`DatePicker`、`Switch`、`Upload`  |
| 列表与筛选 | `Table`、`Pagination`、`Tag`、`Badge`                        |
| 反馈       | `App.useApp()`、`message`、`notification`、`Result`、`Empty` |
| 浮层       | `Modal`、`Drawer`、`Popover`、`Image.PreviewGroup`           |

## 操作层级

- `primary`：每个操作区的主任务，例如保存、提交、发起流程。
- `default`：常规操作，例如新建、打印、导出。
- `text` 或 `link`：低频跳转和辅助操作。
- `danger`：删除、撤销和作废，始终搭配确认流程。
- `icon`：紧凑操作，提供可访问名称和 Tooltip。

所有按钮提供默认、悬停、按下、焦点、禁用和 loading 状态。重复提交通过 loading 与禁用状态控制。

## 表单、表格与浮层

- 表单使用标签、必填标记、就近错误信息和字段帮助。输入框、选择框与日期选择器按同一列宽和高度布局。
- 表格使用服务端分页、表头筛选与排序、数值右对齐、状态 Tag、固定操作列和横向滚动边界提示。
- Tooltip 只承载短说明；复杂说明使用 Popover 或 Modal。浮层使用 Portal，避开视口、安全区、导航和其他浮层。
- Modal 使用紧凑标题栏、可滚动正文和固定底部操作区；关闭后焦点返回触发元素。

## 动效与可访问性

按压反馈使用 100ms，Tooltip/Popover 使用 200ms，抽屉和 Modal 使用 300ms，对应 Ant Design 官方动效时长。动画只使用 `transform` 和 `opacity`，`prefers-reduced-motion` 保留状态反馈并移除位移与缩放。交互控件保留可见焦点和键盘路径。

完整约定见 `docs/contracts/ui-component-standard.md`、`docs/contracts/ui-color-system.md` 与 `docs/contracts/ui-interaction-system.md`。
