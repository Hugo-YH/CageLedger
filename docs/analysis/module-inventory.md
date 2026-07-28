# CageLedger UI 模块清单

| 领域               | 当前实现                                         | 主要偏差                                         | 迁移优先级 | 目标组件                                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------ | ---------- | --------------------------------------------------------------- |
| 应用壳层           | `ReactWorkspace` 已使用 `Layout.Sider` 和 `Menu` | 历史侧栏、账号区、收起触发器与移动端样式叠加     | P0         | `Layout`、`Menu`、`Drawer/Popup`、`TabBar`                      |
| 工作区头部与命令栏 | `WorkspaceHeader`、`CommandBar`                  | 渐变标题、重复工具栏与自定义摘要芯片             | P0         | `Breadcrumb`、`Typography`、`Flex`、`Space`、`Button`、`Tag`    |
| 列表基础设施       | `DataTable` 与 `Pager`                           | 原生 `dense-table`、独立分页布局、行内操作不一致 | P0         | `Table`、`Pagination`、`Dropdown`、`Tooltip`、`Empty`           |
| 笼卡与待接收批次   | intake 录入与列表混合                            | 原生列表、输入与批量操作条                       | P1         | `Form`、`Table`、`Card`、`Drawer`、`Upload`                     |
| 笼位管理           | 动态笼位图与编辑器                               | 专用图形区域外仍有通用原生控件                   | P1         | 专用笼位图 + `Form`、`Drawer`、`Descriptions`                   |
| 动物管理           | 巡检已部分使用 Ant 表单与表格                    | 自定义评分面板、帮助层与移动布局需要收敛         | P1         | `Collapse`、`Segmented`、`Modal`、`Image.PreviewGroup`、`Table` |
| 数量统计表         | 录入网格、保存列表、结算候选                     | 普通列表与分页仍为原生表格；录入以外的控件未统一 | P1         | 专用数量网格 + `Form`、`Table`、`Pagination`、`Drawer`          |
| 结算与报销         | 报销台账已有 `Table`、`Form`                     | 结算候选与台账上下文、操作层级不统一             | P1         | `Tabs`、`Table`、`Descriptions`、`Modal`、`Result`              |
| 系统设置           | 房间、账号、数据、日志                           | 22 个原生通用控件                                | P2         | `Form`、`Table`、`Upload`、`Popconfirm`、`Alert`                |
| 项目门户           | Ant `Layout/Card/Steps` 与自定义展示样式         | 视觉修饰与运营工作台标准未分层                   | P2         | `Layout`、`Grid`、`Card`、`Steps`、`Anchor`                     |

## 约束

- 组件迁移保持路由、API 请求、TanStack Query key、权限判断和测试选择器稳定。
- 结算、减免、梯度、IACUC、核销与导出逻辑保持业务模块内部，UI 迁移只替换呈现与交互容器。
- `DataTable` 支持受控列、服务端筛选、排序、跨页选择、固定操作列与响应式滚动，作为业务列表的唯一入口。
