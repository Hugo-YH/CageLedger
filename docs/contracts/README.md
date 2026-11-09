# 工程契约索引

本目录面向代码、文档与交付维护者，集中维护当前工程约束。先核对事实基线，再按本次任务读取相关契约；指南说明如何操作，契约说明实现和验证必须保持的边界。目录外资料从 [docs 入口](../README.md)进入。

## 先确认当前事实

| 契约                                      | 何时阅读                                    |
| ----------------------------------------- | ------------------------------------------- |
| [当前实现与兼容边界](current-baseline.md) | 判断现役页面、隐藏视图、兼容 API 和历史组件 |
| [模块边界](module-boundaries.md)          | 定位修改层次、依赖方向和领域职责            |
| [分支策略](branching.md)                  | 同步 main、beta、rc，准备整合与版本标签     |

页面是否可达需追踪实际导航、View、角色、开关及调用链；文件存在、测试导入和兼容导出不能单独作为证据。历史前端登记在 `frontend-lifecycle.json`，由 `npm run check:frontend-lifecycle` 核对。

## 数据、状态与安全写入

- [前端状态](frontend-state.md)：服务端查询、UI 偏好、局部草稿与写后缓存。
- [API 契约](api-contracts.md)：请求、响应、错误与接口兼容。
- [写入安全](write-safety.md)：权限、事务、业务归属、幂等、审计与迁移。
- [共享性能](shared-performance.md)：目标读模型、分页、投影、缓存及资源预算。

接口清单的机器来源是 `api-inventory.json`，公开页面通过脚本生成；新增路由以实际登记及 handler 为事实源。

## UI、主题与交互

| 任务                     | 契约                                           |
| ------------------------ | ---------------------------------------------- |
| 组件、表单、弹窗与布局   | [UI 组件标准](ui-component-standard.md)        |
| 状态、选择、流程与交互   | [交互系统](ui-interaction-system.md)           |
| 通知、结果、进度与重试   | [操作反馈](ui-feedback.md)                     |
| Ant Design、尺度与响应式 | [Ant Design 视觉语言](antd-design-language.md) |
| 语义颜色、状态和对比度   | [颜色系统](ui-color-system.md)                 |
| 样式来源、作用域和覆盖   | [样式归属](style-ownership.md)                 |

主题唯一源为 `src/theme/visual-system.mjs`，应用与文档消费派生变量。业务打印与长文阅读采用各自用途的版式，具体例外以视觉语言契约为准。

## 质量、核查与恢复

- [测试策略](testing-strategy.md)：按风险选择检查、资源保护、隔离与证据复用；验证矩阵只在此维护。
- [代码质量](code-quality.md)：格式、lint、类型与架构门禁。
- [数据库副本核查](database-copy-review.md)：在副本核对原数据、审计、历史账单与现行计算。
- [备份恢复演练](backup-restore-drill.md)：离线输入、同批附件、校验清单、隔离恢复及结果限制。

## 云端与正式交付

- [云端开发与交付](cloud-development.md)：官方远端、认证、受管构建、Packages、Release 与续传。
- [发布工程](release-engineering.md)：发布身份、运行依赖、完整管线及恢复边界。
- [Mac 手动备用 Runner](macos-gitea-runner.md)：Mac 平台工具、转换器信任和备用执行环境。

`release:cloud` 核验已经准备好的附注标签、ARM64 产物和 Packages 后发表 Release；不自动创建这些输入。普通提交、版本发布、latest 与生产部署分别按授权执行，不能由旧记录推导新授权。

## 文档与代理指令

- [文档系统](documentation-system.md)：读者分层、事实来源、生成内容、历史归档与同步规则。
- [代理指令维护](agent-instructions.md)：`AGENTS.md` 与专项指令的职责、维护和适用边界。

`docs/archives/` 中的旧计划和验收保留原始语境，不作为现行规则。契约变化时同步相关 Wiki 说明；API inventory 和更新记录等生成内容通过各自脚本维护；前端生命周期清单按实际接入状态登记并校验。
