# Phase 3: 后端领域拆分

**Status**: In Progress

- [x] **3.1** 拆 administration、audit、system 与 iacuc。
- [x] **3.2** 拆 intake、QR 与 cages/placement。
- [x] **3.3** 拆 quantity sheets 与 transfer。
- [x] **3.4** 拆 billing、减免、PI 合表与 workflow。
- [ ] **3.5** 拆 reimbursement 与 Excel import。

领域 service 已迁入 `server_app/domains/`，旧 `server_app/services/` 保留兼容导出。数量统计表、结算单和流程版本 repository 已拆为独立模块；领域 HTTP 路由在完成 reimbursement 导入拆分后统一切换。
