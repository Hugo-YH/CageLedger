# Phase 5：HTTP composition

**状态**：完成

- [x] **T5.1 Router 注册器与 matcher 代理清理**（P0/M）
  - Notes：稳定轻量路由进入 `web/router_registry.py`，entity endpoint contract 进入 `web/entity_contracts.py`。
- [x] **T5.2 按域迁移 read handlers**（P1/L）
  - Notes：GET composition 进入 `web/read_routes.py`，保持 API_ROUTER 优先级与静态资源 fallback。
- [x] **T5.3 按域迁移 write handlers**（P0/XL）
  - Notes：method dispatch、workflow actions、reimbursement actions 与 handler support 拆为五个 mixin；各模块低于 600 行目标，55 项定向测试与 architecture enforce 通过。

## Notes

- 每个域固定路由优先级、鉴权和异常状态映射。
