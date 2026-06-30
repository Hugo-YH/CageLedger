# 安全说明

## 支持范围

安全修复进入当前 `main` 和最新正式版本。历史版本通过升级到最新容器镜像或 Release 包获得修复。

## 漏洞反馈

涉及账号、权限、公开扫码、数据泄露或部署凭据的问题，请通过 `info@cellnucle.us` 私下报告。报告应包含受影响版本、复现步骤、影响范围和必要日志。公开 Issue 适合一般功能问题。

## 部署基线

- 首次启动立即修改缺省管理员密码 `admin / admin123`。
- 生产环境通过环境变量设置 `CAGELEDGER_ADMIN_USERNAME` 和 `CAGELEDGER_ADMIN_PASSWORD`。
- Gitea Token、容器凭据和反向代理证书保存在部署环境或 Gitea Secrets。
- `CAGELEDGER_GITEA_TOKEN` 使用只读仓库权限，仅供私有仓库更新检查。
- `/app/data` 挂载到受控目录并纳入备份；SQLite、WAL 和 SHM 文件按同一备份策略处理。
- 公网部署启用 HTTPS、安全 Cookie 边界和可信反向代理。

## 应用边界

- Cookie Session 由 `/api/auth/*` 管理。
- 管理接口在后端执行角色和房间权限校验，前端可见性只负责界面体验。
- `/api/public/cage-card/{id}` 是免登录只读接口，只返回扫码查询所需的脱敏字段。
- Animal Record ID 是持久标识，接口和日志避免暴露额外个人信息。
- 文件上传限制请求体大小，并在服务端解析 IACUC、月度台账和欠缴工作簿。

## 开发要求

- 依赖变更提交 lockfile，并查看 `npm audit` 和 Python 依赖来源。
- API 输入按类型、范围和权限校验，错误响应避免泄露路径、SQL 和堆栈。
- SQL 使用参数绑定。
- 日志记录业务动作和必要标识，避免写入口令、Session Cookie 和 Token。
- 安全相关改动运行 `npm run check`、API 冒烟和相关 Playwright 回归。
