# 后端优化项目概览

基线 `4468c8b`，当前分支 `main`。目标为完整后端审查、保守修复及生产可合并的验证结果，不包含提交、推送或部署。

现状为 Python 3.13 标准库 ThreadingHTTPServer、SQLite WAL、手工 SQL repository、15秒进程缓存、现有 PDF 串行队列及反馈持久化任务。React 19 / TypeScript 前端与现有222项API构成兼容边界。无ORM、Redis或事件循环，不能照搬对应框架的连接池／异步迁移建议。

权威约束为 AGENTS.md 及 docs/contracts；既有原始业务数据及附件仅做指纹读取。真实验证在仓库外副本中执行。用户已明确直接实施，常规阶段不再请求批准。任务采用 LOCAL_ONLY 跟踪，不创建远端Issue或PR，不写用户原生记忆文件。
