# CageLedger Ant Design UI 重构：项目概览

## 目标

将 CageLedger 的运营工作台统一到 Ant Design 6.5.2 与 Ant Design Mobile 5.42.3 的组件、Token 和交互标准。业务 API、SQLite、权限、结算、打印和导出保持现有口径。

## 当前技术基线

- React 19、TypeScript、Vite、TanStack Query、TanStack Virtual。
- `antd@6.5.2`、`@ant-design/icons@6.3.2` 与 `antd-mobile@5.42.3` 已安装。
- Python 标准库 HTTP 服务提供 API 与生产构建静态资源。
- `src/react/components/ui/` 已提供 `ActionButton`、`CommandBar`、`DataTable` 与 Ant `ConfigProvider` 适配入口。

## 审查发现

| 范围     | 现状                                                                                           | 重构结论                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 样式     | 15 个样式文件共 14,177 行；`shell.css`、`components.css`、`billing.css` 与历史 UX 覆盖同时生效 | 建立 Ant Token 单一来源；逐域删除视觉兼容覆盖                                                       |
| 页面壳层 | 已使用 `Layout.Sider`、`Menu`，同时存在旧工作区头部、渐变和卡片修饰                            | 收敛为 `Layout + Sider + Content`，标题使用页面上下文和面包屑，不保留装饰性渐变头部                 |
| 表单     | billing、settings、workflows 仍有 61 个原生 `input/select/textarea/button`                     | 所有普通业务字段迁移至 `Form`、`Input`、`Select`、`DatePicker`、`InputNumber`、`Switch` 与 `Upload` |
| 列表     | 报销与巡检已使用 Ant `Table`；数量统计、结算候选、接收批次和设置仍存在原生表格                 | 统一为受控 `Table`，服务端分页、筛选、排序与跨页选择保留领域状态                                    |
| 分页     | `Pager` 使用 Ant `Pagination`，遗留布局导致部分页面靠左拥挤                                    | 默认统一右对齐 `bottomRight`；窄屏保持居中并与总数同一响应式容器                                    |
| 移动端   | 已接入 `TabBar` 和 `Popup`，页面内容仍受桌面宽度与遗留面板规则影响                             | 760px 以下使用 antd-mobile 容器与单列字段，桌面壳层样式不跨越断点                                   |
| 门户     | 首页使用 Ant 原语，叠加网格、渐变和演示卡片                                                    | 保留产品门户结构，收敛为 Ant Landing 的清晰区块、标准 Card、Grid、Steps 和 Button 层级              |

## Ant 资源使用边界

- Ant Design：运行时组件、主题 Token、企业导航、表单、数据展示与反馈。
- Ant Design Mobile：760px 以下的 TabBar、Popup、Form、Selector、List、Button 与 SafeArea。
- Ant Design Pro / Pro Components：用于信息架构、列表操作和布局模式参考；当前服务端筛选、跨页选择与虚拟化由项目 `DataTable` 适配层承接，避免引入重复的请求状态抽象。
- Kitchen / Sketch：作为设计稿与组件状态审查基线；不进入浏览器运行时依赖。

## 完成定义

- 页面组件不再直接渲染通用原生按钮、输入、选择、文本域、普通列表表格和分页。
- 业务专用 DOM 仅保留笼位图、数量台账网格、巡检评分、图表、打印与 PDF 模板。
- 所有页面在浅色、深色、1280px、1180px、760px、手机横屏及 reduced-motion 下通过视觉与交互验收。
