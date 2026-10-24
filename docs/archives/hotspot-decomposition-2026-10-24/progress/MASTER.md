# 14处热点拆分进度

模式LOCAL_ONLY。治理AGENTS.md及docs/contracts；记忆沿用现有原生上下文，不改记忆或旧MASTER。

准备已完成：范围和约束沿用用户明确授权；基线d4b18cc；14项精确清单见../analysis/module-inventory.md，计划见../plan/task-breakdown.md。

## 当前状态

14/14职责拆分及最终完整隔离验收通过。原架构目标不变，当前0阻断、0提醒、0热点。

## 逐项进度

- [x] H01 `server_app/domains/animal_management/service.py`：目标与最终完整验收均通过。
- [x] H02 `server_app/domains/reimbursement_ledger/service.py`：目标与最终完整验收均通过。
- [x] H03 `server_app/pdf/documents.py`：目标与最终完整验收均通过。
- [x] H04 `server_app/persistence/base_schema.py`：目标与最终完整验收均通过。
- [x] H05 `server_app/repositories/billing_candidates.py`：目标与最终完整验收均通过。
- [x] H06 `server_app/repositories/billing_workflows.py`：目标与最终完整验收均通过。
- [x] H07 `server_app/web/read_actions.py`：目标与最终完整验收均通过。
- [x] H08 `src/react/features/animal-management/InspectionLists.tsx`：目标与最终完整验收均通过。
- [x] H09 `src/react/features/billing/components/SavedQuantitySheets.tsx`：目标与最终完整验收均通过。
- [x] H10 `src/react/features/cages/components/CageWorkspaceComponents.tsx`：目标与最终完整验收均通过。
- [x] H11 `src/react/print/printTemplates.test.ts`：目标与最终完整验收均通过。
- [x] H12 `src/react/print/settlement.ts`：目标与最终完整验收均通过。
- [x] H13 `src/styles/features/animal-management.css`：目标与最终完整验收均通过。
- [x] H14 `tests/test_feedback.py`：目标与最终完整验收均通过。

## 遥测与偏差

初始drift_score=0；新增非计划依赖逐项登记，20%注解、40%重排、60%重定范围。当前无范围扩大。每批在此记录实际成果和证据；不编造耗时/评分。

## 分批实现与审查结果（历史阶段记录）

- B1目标154项通过；B2后端47项、前端打印27项通过；B3目标23项通过；B4修正重复发现后50项通过。所有目标运行均零自动重试。
- 38条提取记录逐函数/类/方法体AST等价；基础schema展开50条语句及hook/commit顺序完全一致；266条CSS顶层节点展开后完全同序。
- 独立只读审查未见剩余生产阻断；发现HTTP测试重复38项，已将生命周期抽为不继承TestCase的共享fixture，原50个测试体与3个生命周期体保持一致。首次88项记录保留，不作为目录通过依据。
- 一个新增依赖：API清单静态检查原只识别read_actions本文件方法，已改为解析显式Mixin唯一owner，保留全部路由/权限校验和不存在/重复入口拒绝；新增2项保护测试，10项API清单测试通过。API路径/协议未改，仅生成文档中的实际代码入口更新。drift_score=1/14（7.1%），无需扩大范围。
- 实现期装饰器、缩进、CSS边界、格式检查和回环端口sandbox失败均保留于外部hotspot-evidence；无断言/阈值放宽。

B1：6项生产后端拆分及静态API owner适配已完成目标业务154项、API清单10项与架构检查；独立review未见生产阻断。迁移和事务语义按原体保留。

B2：3项前后端打印职责/测试拆分完成；47项后端与原27项前端打印测试通过，原27项测试名/正文、24个TS声明及全部Python函数保持等价。

B3：3个组件热点及样式热点按职责分离完成；23项目标组件/纯函数测试、类型、UI/样式/Ant契约通过。原22个TS函数/常量与266个CSS顶层节点同序等价；保留memo/query/焦点/日期所有权。完整浏览器待最终运行。

B4：反馈测试按本地/outbox、客户端和HTTP分离，共享非TestCase夹具。实际50/50通过，原50方法与3个生命周期体保留；首轮88目录回归已修正且原证据保留。所有14项完成分批目标验证；完整check/build/三引擎、性能和SQLite复验待执行，不据目标通过宣称最终完成。

首次完整check：前端97文件627项通过；Python739项含2个模块导入错误，未继续build/浏览器。根因为其他反馈API/导入测试仍依赖旧入口FakeGitea导出，已用显式非TestCase兼容导出修复；相关64项测试复验通过。此为测试模块兼容遗漏，原失败保留hotspot-evidence/final-check.log和final-stages.json；新完整验收使用独立目录，不覆盖首次失败。

最终提交e2f65e6的完整check/build通过：前端97文件627项、Python751项（原749+2保护测试）、架构0/0/0、0ResourceWarning；SQLite7项/30实际关闭、无应用初始化18项和原保存删除探针通过。完整Chromium277执行中，Firefox/WebKit/反馈/焦点/性能仍待完成，尚未标记最终验收通过。测试串行、原预算、零自动重试，代码输入冻结。

最终Chromium完整277/277通过，JSON确认0失败/跳过/flaky；Firefox兼容35项开始，之后WebKit与专项排队。应用仍e2f65e6，原预算/零自动重试；全部验收仍待最后汇总。

## 最终验收与收尾

最终应用/测试提交e2f65e6；完整check/build通过，97前端文件627项、Python751项（749原体不变+2）、主浏览器277+35+35=347、反馈6、焦点重复6、键盘性能3轮均通过，原预算、单worker、零自动重试。SQLite7项/30连接实际关闭；导航显式getClientRects调用保持6/1，中位同步耗时约0.30ms；不是总布局成本。完整14项结果见../acceptance.md，外部证据hotspot-evidence/final-acceptance/verification.json。

本轮控制/监测和7组已证明归属的PDF预热浏览器均退出，51端口无监听，原main50d8b83干净，应用输入1098文件指纹不变。26组更早浏览器未逐一证明归属，未终止。新发现PDF renderer正常退出清理风险未改动，单列后续处理；不据本轮通过宣称全部性能风险解决。未推送发布部署、未触碰生产数据或其他任务进程。

遥测收尾：B1/B2/B3/B4四实现批次和兼容修复均本地提交；新增非计划依赖为API入口静态解析1项，drift_score=1/14（7.1%）。S单职责、U单向依赖、P既有接口、E配置注入保持、R兼容入口经原体/目录/静态审查及实际业务回归核对；不以架构0热点单项作为完成标准。实际阶段时间及退出码由final-stages.json记录，不估算人工工时。
