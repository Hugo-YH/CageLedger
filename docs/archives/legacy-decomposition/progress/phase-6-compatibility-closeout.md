# Phase 6：兼容收口

**状态**：完成

- [x] **T6.1 显式 re-export 与动态面收缩**（P1/M）
  - Notes：legacy 收敛为 100 行显式 compatibility exports、WebApplicationPorts 装配与 main；声明兼容测试通过。
- [x] **T6.2 删除热点基线并全量验证**（P0/M）
  - Notes：已删除 7350 行 architecture baseline；`npm run check`、179 项 Python 测试、77 项前端测试、architecture enforce、文档构建与 8 项 API smoke 全部通过。

## Notes

- `server_app/legacy.py` 终态为 101 行显式兼容层。
- `server_app` 内无指向 `server_app.legacy` 的反向依赖。
