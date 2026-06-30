# Phase 2: 后端平台层

**Status**: Complete

- [x] **2.1** 提取 persistence schema、migration 和 index 注册。
- [x] **2.2** 提取 web request、response、auth 和 Router。
- [x] **2.3** 将 Handler 改为统一路由分发。
- [x] **2.4** 收敛 server.py 装配与兼容导出。

## Notes

- 健康检查、系统信息和会话读取已通过 Router；领域路由保留 legacy fallback，由 Phase 3 逐域迁移。
- `server.py` 收敛为 14 行兼容入口，剩余实现集中在 `server_app/legacy.py`。
