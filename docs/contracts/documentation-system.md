# 文档系统契约

## 目的

`wiki/` 是 CageLedger 的公开文档源。VitePress 将其构建为 `/docs/`，Gitea Wiki 保留迁移入口。文档站服务使用者、部署维护者和开发维护者，内容与当前实现保持一致。

当前版本与兼容边界统一从 [current-baseline.md](current-baseline.md) 核对；整个 `docs/` 的入口见 [README](../README.md)。页面存在、测试导入和旧更新日志不作为当前 UI 可达证据。

## 信息架构

| 区域       | 读者     | 内容                                           |
| ---------- | -------- | ---------------------------------------------- |
| 指南       | 操作人员 | 产品概览、业务流程、工作台导航和各业务模块操作 |
| 部署与运维 | 管理员   | 安装、环境变量、账号权限、数据、备份和故障排查 |
| 开发维护   | 开发人员 | 本地开发、架构、接口、UI 标准、测试和发布      |
| 更新日志   | 所有读者 | 按版本维护的用户可见变更记录                   |

## 事实来源

| 文档内容                    | 权威来源                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| 依赖版本、命令和 Node 范围  | `package.json`、`.nvmrc`                                                                          |
| Python 运行时和测试启动方式 | `.python-version`、`scripts/run_python.mjs`、`scripts/check_python_runtime.mjs`                   |
| 端口和开发进程              | `scripts/dev.mjs`、`vite.config.ts`、`server_app/config.py`                                       |
| 接口、权限和响应            | `server_app/web/router_registry.py`、实际 handler/service、`api-inventory.json` 与 API 契约       |
| 前端导航和工作区            | `ReactWorkspace.tsx`、`workspaceNavigation.ts`、`MobileNavigation.tsx`、角色／功能开关和实际 View |
| 未接入的历史组件            | `frontend-lifecycle.json` 与 `check:frontend-lifecycle` 的生产依赖核对；测试路径单独解释          |
| 业务规则和输出              | `src/domain/`、`server_app/domains/`、`src/react/print/`、`server_app/pdf/`                       |
| 云端发布和制品              | `cloud-development.md`、`cloud_release.py`、`cloud_registry.py`、受管打包脚本和运行环境锁         |
| Mac 手动备用发布            | `release_local.sh` 与 `release-engineering.md` 中的平台专用边界                                   |

## 代理指令

项目代理入口为 `AGENTS.md`，技能与指令维护见 [agent-instructions.md](agent-instructions.md)。开发验证统一维护在 [testing-strategy.md](testing-strategy.md)，其他文档引用该矩阵，不复制平行门禁。

## 修改规则

1. 新增或调整用户功能时，同步修改对应的指南页面。
2. 修改环境变量、端口、部署、测试或发布脚本时，同步修改运维或开发页面。
3. 修改 API、权限、缓存或数据模型时，同步修改开发参考页和相关契约。
4. 发布前在 `wiki/更新日志.md` 写入面向使用者的版本说明，再运行 `npm run release:notes:sync`。
   系统内更新记录与 Gitea Release 使用同一解析器；发布流程验证目标版本，并在创建／更新 Release 时写入完整 Markdown 正文。附件上传及公开后回读校验正文，说明缺失或不匹配不能报告发布成功。
5. 按 [测试策略](testing-strategy.md) 验证修改的文档；纯文字修改只检查修改文件的格式、lint、链接与 diff，不默认文档构建或完整检查。文档导航、结构、配置或渲染能力变化时按需运行 `npm run check:docs`。共享生产构建已包含文档，不再由 `check` 重复构建；共享构建关闭 Git 更新时间，使相同源码内容的输出可复用。

## 历史与生成内容

- `docs/archives/` 保留历史记录；原 `plan/`、`progress/`、性能清单和演示路径可留短索引。只归档与修正链接，不把当年的失败、未验证项或待办改写成已完成。
- `wiki/更新日志.md` 保留各版本当时的变更说明，不批量替换历史术语。当前使用说明另行修正。历史说明不授权当前写库、测试或发布。
- `wiki/API接口清单.md` 由 `api-inventory.json` 和 `scripts/api_inventory.py` 生成；`src/react/releaseNotesDocs.ts` 等由更新日志生成，不手工编辑派生内容。
- 新增 Wiki 页面同时登记 `.vitepress/page-routes.mjs`、侧栏和 `LLMs.md`。链接检查区分 VitePress 重写地址、Markdown 源文件与归档相对地址，不能仅靠文件是否同名判断。

## 写作规则

- 页面按任务组织，首屏说明适用对象、入口和完成结果。
- 命令、端口、路径、环境变量和角色名称使用可直接执行或定位的值。
- 页面使用相对 VitePress 链接；代码路径使用反引号。
- 历史背景进入 `docs/archives/`，当前文档只描述当前受支持行为。
