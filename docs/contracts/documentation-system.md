# 文档系统契约

## 目的

`wiki/` 是 CageLedger 的公开文档源。VitePress 将其构建为 `/docs/`，Gitea Wiki 保留迁移入口。文档站服务使用者、部署维护者和开发维护者，内容与当前实现保持一致。

## 信息架构

| 区域       | 读者     | 内容                                           |
| ---------- | -------- | ---------------------------------------------- |
| 指南       | 操作人员 | 产品概览、业务流程、工作台导航和各业务模块操作 |
| 部署与运维 | 管理员   | 安装、环境变量、账号权限、数据、备份和故障排查 |
| 开发维护   | 开发人员 | 本地开发、架构、接口、UI 标准、测试和发布      |
| 更新日志   | 所有读者 | 按版本维护的用户可见变更记录                   |

## 事实来源

| 文档内容                    | 权威来源                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| 依赖版本、命令和 Node 范围  | `package.json`、`.nvmrc`                                                         |
| Python 运行时和测试启动方式 | `.python-version`、`scripts/run_python.mjs`、`scripts/check_python_runtime.mjs`  |
| 端口和开发进程              | `scripts/dev.mjs`、`vite.config.ts`、`server_app/config.py`                      |
| 接口、权限和响应            | `server_app/legacy.py`、`server_app/domains/`、`docs/contracts/api-contracts.md` |
| 前端导航和工作区            | `src/react/features/shell/`、各业务 View                                         |
| 业务规则和输出              | `src/domain/`、`server_app/services/`、`src/react/print/`、`server_app/pdf/`     |
| 发布和离线制品              | `scripts/release_local.sh`、`scripts/package_offline*.sh`                        |

## 修改规则

1. 新增或调整用户功能时，同步修改对应的指南页面。
2. 修改环境变量、端口、部署、测试或发布脚本时，同步修改运维或开发页面。
3. 修改 API、权限、缓存或数据模型时，同步修改开发参考页和相关契约。
4. 发布前在 `wiki/更新日志.md` 写入面向使用者的版本说明，再运行 `npm run release:notes:sync`。
5. 文档修改通过 `npm run check:docs`；完整 `npm run check` 也包含文档构建。

## 写作规则

- 页面按任务组织，首屏说明适用对象、入口和完成结果。
- 命令、端口、路径、环境变量和角色名称使用可直接执行或定位的值。
- 页面使用相对 VitePress 链接；代码路径使用反引号。
- 历史背景进入 `docs/archives/`，当前文档只描述当前受支持行为。
