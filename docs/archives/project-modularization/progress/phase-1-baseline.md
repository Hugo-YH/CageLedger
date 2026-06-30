# Phase 1: 行为基线与架构门禁

**Status**: Complete

- [x] **1.1** 建立规格、进度与项目 Skill。Acceptance: 文档完整，Skill 校验通过。
- [x] **1.2** 增加后端业务与 API 特征测试。Acceptance: QR、计费、减免、转移、权限和响应契约有测试。
- [x] **1.3** 增加前端、打印视觉与交互基线。Acceptance: 固定数据截图与模板测试可重复。
- [x] **1.4** 新增 report-only 架构检查。Acceptance: 输出循环、越层和规模报告。

## Notes

- 基线提交：`d0fd449292af548c72e7f516c2bd95a201f641d7`。
- Task 1.1：项目 Skill 已通过 `quick_validate.py`。
- Task 1.2：9 项 Python 测试通过，API 使用临时 SQLite。
- Task 1.3：18 项 Vitest 和三档 Playwright 视觉契约通过。
- Task 1.4：报告 8 个既有规模热点、3 个 domain 反向依赖、0 个循环依赖。
