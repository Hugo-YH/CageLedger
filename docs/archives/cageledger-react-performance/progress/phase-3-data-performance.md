# Phase 3: 服务与数据性能

**Status**: Complete

- [x] Task 3.1：笼卡列表热字段迁移和兼容回填。
- [x] Task 3.2：复合索引、覆盖索引和 10 万记录查询验证。
- [x] Task 3.3：静态资源缓存、gzip、ETag 和 Server-Timing。

## Notes

- 现有数据库已通过应用启动迁移补齐 `pi`、`owner`、`quantity`、`card_count`，5 条历史记录均完成回填。
- 目标基准中单查询 P95 为 0.04-1.73ms，20 并发读取 P95 为 4.98ms。
