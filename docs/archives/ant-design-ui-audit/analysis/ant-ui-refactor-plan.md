# CageLedger Ant Design 全量收敛计划

状态：`LOCAL_ONLY`，待实施确认。

## Phase 1：主题与壳层

- 以 `ConfigProvider` Token 为视觉唯一来源，删除 `apple-ux.css`、`ux-foundation.css` 与 `legacy-responsive.css` 中覆盖 Ant 原语的规则。
- 将工作区头部收敛为面包屑、标题、状态 Tag 与必要的 `extra` 操作；业务页面移除渐变标题背景和装饰性卡片标题。
- 使用标准 `Layout.Sider` 收起触发器，统一菜单对齐、当前项、账号区与移动导航。

## Phase 2：基础适配层

- 扩展 `ActionButton`、`DataTable`、`FormField`、`PageSection`、`PageFeedback`、`AppDialog` 与 `AppDrawer`。
- `DataTable` 固定 `pagination.position = ["bottomRight"]`，窄屏改为 `bottomCenter`；总数、页码与页尺寸进入同一分页容器。
- 统一空态、加载、错误、成功提示和破坏性确认。

## Phase 3：高频列表与表单

- 先迁移待接收批次、已保存数量统计表、项目负责人结算列表、系统数据/账号列表。
- 再迁移数量统计表头部表单、计费扩展、结算与报销台账、笼位编辑器。
- 通用字段全面替换为 Ant Form 控件；数量输入网格保留专用 DOM 与领域交互。

## Phase 4：业务域与移动端

- 迁移笼卡、笼位、动物巡检、流程中心、系统设置和项目门户。
- 760px 以下改用 antd-mobile 的移动组件；页面内容单列化，表格保持可见横向滚动与固定关键列。

## Phase 5：清理和验收

- 删除失效视觉规则，CSS 留下 Token、壳层、业务专用视觉、打印四层。
- 添加 UI 契约门禁：阻止页面直接使用普通原生控件与历史通用视觉类。
- 验证 `npm run check`、`npm run build`、`.venv` Python 3.13 的 E2E、API smoke、PDF/Excel 和四档截图。
