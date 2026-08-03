# 样式归属契约

## 目标

每个 UI 组件族的布局、尺寸、定位和响应式规则仅由一个样式文件拥有。Ant Design 提供通用组件基础，业务样式通过 `data-feature` 限定，通用交互通过 `data-ui` 限定。

机器可读清单位于 [`src/styles/style-ownership.json`](../../src/styles/style-ownership.json)。它是样式导入顺序、所有者和迁移状态的唯一来源。

## 固定层级

1. 共享品牌 Token：`brand-tokens.css`
2. 应用 Token 与 Ant reset：`tokens.css`、Ant reset、antd-mobile reset
3. 元素基线：`base.css`
4. Shell：`shell.css`
5. 通用组件：`components.css`、`ux-foundation.css`
6. Ant 全局边界：`antd-system.css`
7. 业务域：`intake.css`、`billing.css`、`animal-management.css`、`administration.css`、`project-home.css`
8. 打印：仅由打印模板及其专属样式管理

`core.css`、`legacy-responsive.css`、`react.css`、`responsive.css`、`apple-ux.css` 与 `mobile.css` 处于登记的兼容期。迁移完成后删除文件和导入，禁止继续向这些文件增加规则。

## 组件边界

| 组件族     | 根标识                        | 唯一所有者          | 允许范围                 |
| ---------- | ----------------------------- | ------------------- | ------------------------ |
| 应用壳     | `data-ui="app-shell"`         | `shell.css`         | 侧栏、工作区容器、安全区 |
| 侧栏       | `data-ui="sidebar"`           | `shell.css`         | 桌面导航、移动导航切换   |
| 工作区标题 | `data-ui="workspace-header"`  | `shell.css`         | 上下文标题与元信息       |
| 命令栏     | `data-ui="workspace-toolbar"` | `components.css`    | 操作分组、sticky 行为    |
| 表格       | `data-ui="data-table"`        | `ux-foundation.css` | 容器、横向滚动、分页     |
| 弹窗       | `data-ui="modal"`             | `ux-foundation.css` | 标题、正文、页脚与焦点   |
| 移动导航   | `data-ui="mobile-navigation"` | `shell.css`         | TabBar、Sheet、安全区    |

## 修改流程

1. 使用 `rg` 检索目标 class、`data-ui`、`data-feature` 和媒体查询。
2. 在归属清单中定位唯一所有者，修改该文件。
3. 删除替代规则，禁止以更高选择器追加覆盖。
4. 在桌面、1180px、760px、手机横屏验证 computed style、溢出、hover、focus-visible、disabled 与 loading。
5. 运行 `npm run check:style-ownership`、目标 Playwright 与 `git diff --check`。

## Ant Design 边界

`antd-system.css` 管理 ConfigProvider 对应 Token、全局可访问性修正和必要的 reset 补丁。业务域内的 `.ant-*` 选择器必须由对应的 `data-feature` 或 `data-ui` 根标识限定。新建的未登记全局 Ant 覆盖将由样式门禁阻止。
