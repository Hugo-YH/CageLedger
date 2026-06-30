# CageLedger 项目模块化归档

本项目以 `d0fd449` 为基线，在 `codex/project-modularization` 分支完成后端平台与领域边界、React 页面、API contracts、CSS、演示数据和 E2E 的模块化拆分。

## 验证结果

- `npm run check`：通过，含 Prettier、ESLint、Stylelint、Markdownlint、Ruff、ShellCheck、TypeScript、Vitest、Python unittest 和架构强制门禁。
- `npm run test:e2e`：9 项通过，覆盖登录导航、笼卡、数量统计、权限、公开扫码、可访问性和三档视觉契约。
- API smoke：隔离 SQLite 下 8 个端点通过。
- 旧库迁移：正式库副本在临时目录完成幂等迁移，可读取 26 张表和 3 个用户。
- 性能：1 万笼位、10 万记录下，单查询 P95 最高 1.65 ms，20 并发 P95 6.58 ms。
- 构建：Vite 生产构建通过，主 CSS 129.63 kB，业务页面继续独立拆包。
- 离线包：`CageLedger-offline-v0.5.25.tar.gz` 生成成功。
- Docker：当前开发机缺少 Docker CLI，镜像实构由 Gitea CI 或发布机补充。

## 兼容边界

- `server.py` 保持精简启动与装配入口。
- `server_app/legacy.py` 保留迁移期 HTTP 路由和历史导出兼容，新增业务进入 `server_app/domains/`。
- `server_app/services/`、`src/react/api/contracts.ts` 和 `src/styles.css` 保留兼容转发或导入。
- HTTP、SQLite、权限、结算、打印与导出契约保持现有行为。

执行过程资料副本位于本目录的 `analysis/`、`plan/` 和 `progress/`。
