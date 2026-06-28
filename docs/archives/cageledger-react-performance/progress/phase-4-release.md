# Phase 4: 切换与发布

**Status**: Complete

- [x] Task 4.1：正式入口切换和旧运行模式清理。正式入口只装载 React，旧渲染器及其专属 API/state/view/print 模块已删除，本地业务快照迁移为仅保存界面偏好。
- [x] Task 4.2：Docker、离线包、版本和 Gitea 发布链更新。运行镜像只包含 Python 服务与 `web-dist`，版本/修订号分离，tag 工作流校验三处版本一致，离线包完成 Python 直启验证。
- [x] Task 4.3：完整回归、性能验收、Wiki 和回滚验证。生产缓存/深链接、权限、API、离线包、v0.5.25 回滚和目标规模基准均通过。

## Notes

- 多阶段 Dockerfile、Gitea Release 的 `npm ci`、离线包预构建和 `src/react/version.ts` 版本同步已实现。
- 离线包已解压并仅使用 Python 启动验证；Docker 客户端在当前机器不可用，镜像构建仍待 CI 或具备 Docker 的环境验证。
- 正式入口已完成 React 单入口切换，后续发布任务直接使用 `web-dist` 制品。
- 历史更新记录完整迁移到 `src/react/releaseNotes.ts`，关于系统按需加载并分页展示 97 个版本。
- 正式构建不再生成旧 `app` chunk，主入口约 25.5 kB；13 项单测、4 项 E2E 和真实数据库浏览器检查通过。
- 离线包为 512 KB，排除 CI、测试和迁移文档；解压后仅使用 Python 成功启动。当前机器无 Docker 兼容客户端，镜像实际构建留给 Gitea CI 验证。
- 最终 10 万记录基准最慢列表查询 P95 1.77ms，20 并发读取 P95 6.14ms；6 项 E2E 覆盖管理员、房间管理员、写操作和公开深链接。
- Python 生产服务验证 HTML no-cache、API no-store、Server-Timing，以及哈希资源 gzip、ETag 和一年 immutable 缓存。
- 使用当前数据库 SQLite backup 启动 v0.5.25 成功，回滚健康检查通过。
