# Phase 6: 全链路验收与归档

**Status**: In Progress

- [x] **6.1** 运行旧库迁移、API、E2E 与打印回归。
- [x] **6.2** 运行 benchmark、构建和包体对比。
- [ ] **6.3** 验证离线包、Docker 和 Gitea workflow。
- [x] **6.4** 更新发布记录并归档规格资料。

离线包已生成，Gitea workflow 相关格式与 Shell 脚本已进入 `npm run check`。当前开发机缺少 Docker CLI，镜像实构留待具备 Docker daemon 的 CI 或发布机完成。
