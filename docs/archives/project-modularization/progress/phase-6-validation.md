# Phase 6: 全链路验收与归档

**Status**: Complete

- [x] **6.1** 运行旧库迁移、API、E2E 与打印回归。
- [x] **6.2** 运行 benchmark、构建和包体对比。
- [x] **6.3** 验证离线包、Docker 和 Gitea workflow。
- [x] **6.4** 更新发布记录并归档规格资料。

离线包已生成，Gitea workflow 相关格式与 Shell 脚本已进入 `npm run check`。Docker 多阶段镜像已通过 Colima 实构，测试容器的 `/api/health` 返回正常；临时运行时已停止。

E2E 共享基础设施采用完整幂等创建序列，避免并行 worker 观察到房间层级的中间状态；修复后 9 项测试一次通过。
