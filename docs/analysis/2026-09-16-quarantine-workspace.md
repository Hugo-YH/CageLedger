# 检疫工作台分析

前端位于 src/react/features/quarantine，typed hooks 位于 src/react/api/quarantine.ts；标准库 HTTP、领域服务与 SQLite 分层。已有服务端 PDF 模板、快照、版本、审计和并发写入保护。

主要风险：报告格式与编辑界面耦合；列表无记录级筛选；未保存离开；历史样本计数被编辑器自动升级；附件写入后版本联动；批次完成与出具报告不是同一业务状态。

方案：冻结 PDF/模板与 payload 兼容；新增只读 records/reports 工作列表；原结果值不自动填阴性；现代 Ant 表单只改变编辑体验。已出具记录只读，更正另建；所有写入继续通过现有服务并传 expectedUpdatedAt。

架构评估：领域与模板分层可沿用；单个 QuarantineView 职责过多，拆出工作列表/批次概况组件；编辑字段使用同一结构，避免两套序列化。治理不改 AGENTS/原有任务进度。

验收基线：tests/test_quarantine*.py、tests/e2e/quarantine*.spec.ts；使用隔离库。样式由 src/styles/features/quarantine.css 唯一负责。
