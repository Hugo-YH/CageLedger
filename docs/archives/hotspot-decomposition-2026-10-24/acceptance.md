# 剩余14处大模块拆分：本地隔离验收通过

记录时间（UTC）：2026-10-24T00:55:26.361419+00:00。

## 结果与范围

基于上一轮已验收的d4b18cc（应用b88b90b），在同一独立工作树和分支 `codex/performance-post-1.17.1` 继续完成14/14项职责拆分。本轮最终应用/测试提交 `e2f65e688610c2c6e8b790f3813f85b3e8facb49`，之后仅整理报告文档。原架构脚本和所有体量目标、baseline名单、排除规则均未改，热点14→0、提醒8→0、阻断仍0。没有把原模块搬成新的超限模块。

保持既有业务计算、权限、审计、SQL、API路径/请求响应和数据格式。没有依赖安装/升级、版本号变动、推送、发布、部署、NAS/VPS访问或生产数据操作。测试使用生成的临时库/附件和独立服务；本轮登记及已证明自有的进程均退出，51个检查端口无监听，页面当前未启动；另26组早于本轮基线的浏览器归属未逐一证明，已保留不动，详见风险节。

## 逐项对照

行数采用未修改的架构脚本同口径，包含末尾空行。新文件完整路径与原文件处于同目录；职责和验收边界见归档的 [模块清单](analysis/module-inventory.md)。

| ID  | 原文件（精确路径）                                                | 原行数 | 拆分后的入口及职责文件／行数                                                                                                                                                                                       | 结论                           |
| --- | ----------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| H01 | `server_app/domains/animal_management/service.py`                 |    755 | `inspection_repository.py` 255；`inspection_rules.py` 90；`service.py` 448                                                                                                                                         | 职责拆分、原用例保留，最终通过 |
| H02 | `server_app/domains/reimbursement_ledger/service.py`              |    771 | `allocation_commands.py` 142；`claim_attachments.py` 122；`claim_rules.py` 130；`service.py` 397                                                                                                                   | 职责拆分、原用例保留，最终通过 |
| H03 | `server_app/pdf/documents.py`                                     |    642 | `document_formatting.py` 46；`documents.py` 56；`quantity_document.py` 157；`settlement_document.py` 86；`settlement_document_layout.py` 226；`settlement_document_model.py` 150                                   | 职责拆分、原用例保留，最终通过 |
| H04 | `server_app/persistence/base_schema.py`                           |    704 | `base_schema.py` 28；`billing_schema.py` 215；`infrastructure_schema.py` 135；`inspection_schema.py` 128；`reimbursement_schema.py` 138；`system_schema.py` 96                                                     | 职责拆分、原用例保留，最终通过 |
| H05 | `server_app/repositories/billing_candidates.py`                   |    643 | `billing_candidate_groups.py` 60；`billing_candidate_model.py` 156；`billing_candidate_queries.py` 236；`billing_candidate_storage.py` 214；`billing_candidates.py` 53                                             | 职责拆分、原用例保留，最终通过 |
| H06 | `server_app/repositories/billing_workflows.py`                    |    726 | `billing_workflow_projections.py` 196；`billing_workflow_queries.py` 420；`billing_workflow_writes.py` 125；`billing_workflows.py` 32                                                                              | 职责拆分、原用例保留，最终通过 |
| H07 | `server_app/web/read_actions.py`                                  |    608 | `read_actions.py` 20；`read_billing_actions.py` 129；`read_inspection_actions.py` 81；`read_quantity_actions.py` 82；`read_reimbursement_actions.py` 107；`read_state_actions.py` 127；`read_system_actions.py` 76 | 职责拆分、原用例保留，最终通过 |
| H08 | `src/react/features/animal-management/InspectionLists.tsx`        |    543 | `InspectionDetailDialog.tsx` 111；`InspectionFindings.tsx` 162；`InspectionListError.tsx` 19；`InspectionLists.tsx` 3；`InspectionRecords.tsx` 253；`inspectionListFormatting.ts` 16                               | 职责拆分、原用例保留，最终通过 |
| H09 | `src/react/features/billing/components/SavedQuantitySheets.tsx`   |    458 | `QuantityColumnTitle.tsx` 35；`QuantityPreviewModal.tsx` 78；`SavedQuantitySheetTable.tsx` 27；`SavedQuantitySheets.tsx` 337                                                                                       | 职责拆分、原用例保留，最终通过 |
| H10 | `src/react/features/cages/components/CageWorkspaceComponents.tsx` |    430 | `BatchSlotEditor.tsx` 122；`CageWorkspaceComponents.tsx` 5；`PlacementDrawer.tsx` 69；`SlotEditor.tsx` 169；`VirtualRack.tsx` 89；`cageWorkspaceDate.ts` 2                                                         | 职责拆分、原用例保留，最终通过 |
| H11 | `src/react/print/printTemplates.test.ts`                          |   1078 | `intakeCardsPrint.test.ts` 195；`printTemplates.test.ts` 599；`quantitySheetsPrint.test.ts` 294                                                                                                                    | 职责拆分、原用例保留，最终通过 |
| H12 | `src/react/print/settlement.ts`                                   |    639 | `settlement.ts` 214；`settlementGroupCells.ts` 88；`settlementModel.ts` 314；`settlementPagination.ts` 34                                                                                                          | 职责拆分、原用例保留，最终通过 |
| H13 | `src/styles/features/animal-management.css`                       |   1919 | `animal-inspection-antd.css` 498；`animal-inspection-catalog.css` 163；`animal-inspection-mobile.css` 193；`animal-inspection-records.css` 521；`animal-management.css` 544                                        | 职责拆分、原用例保留，最终通过 |
| H14 | `tests/test_feedback.py`                                          |   1147 | `feedback_fixtures.py` 143；`test_feedback.py` 830；`test_feedback_client.py` 167；`test_feedback_http.py` 45                                                                                                      | 职责拆分、原用例保留，最终通过 |

H01保留巡检用例编排，持久化投影与权限/校验成为叶子。H02分开核销事务、附件和共用输入/权限规则。H03/H12分别把服务端与浏览器打印投影、分组分页和版式分开。H04将基础表DDL按领域组织，外层初始化仍持有原提交边界。H05/H06分离查询、模型/投影、存储写入与失效。H07使用领域Mixin保留原GET动作接口。H08/H09/H10保留原状态、memo、query和日期所有权，按实际组件职责拆分。H13保持CSS所有规则顺序，按录入/证据、记录/详情、桌面组件、移动端与目录编辑归属拆分。H11/H14按测试领域拆分并保留原断言。

## 接口、依赖与等价证据

- 生产176个原声明（含常量）、42个GET方法逐体AST一致；装饰器同样保留。基础schema展开后50条语句及后处理hook、commit顺序一致。
- 前端22个原函数/常量、打印24个声明由TypeScript打印器核对一致，只忽略新增export；导入归属另经静态依赖和独立只读审查。新模块没有回指兼容facade的循环。
- 266个CSS顶层节点展开后AST和顺序一致；按新文件登记唯一归属，未引入宽松排除。
- 前端原27个打印测试的describe、名称、正文与断言完全保留。反馈原50个测试方法及3个连接生命周期方法保持一致，共用不继承TestCase的fixture，实际发现与运行数量经复验。全Python源目录另核对原749个测试方法逐体未变、无遗漏/重复，仅新增2项；映射详见 `python-source-test-catalog.json`。
- API catalog与路由review指纹未变，213项方法/路径/权限及其他元数据保持原值，仅60项文档代码入口更新。原静态入口检查只查read_actions本文件，现解析显式Mixin的唯一实现；缺失、重复或不支持的继承仍拒绝。新增2项保护测试，没有放宽validate、排除路由或跳过检查。
- 旧命名入口与函数re-export保留。私有helper/配置常量的归属改变，不保证对旧模块赋值monkeypatch会传入新owner；未发现仓库现有用法受损，不宣称所有外部私有替换用法等价。

等价、审查和实现失败证据根目录：`/Users/hugo/Documents/Codex/2026-10-23/task/hotspot-evidence`；包括 `final-production-source-equivalence.json`、`backend-postformat-equivalence.json`（测试类结构变化由后续证据替代）、`feedback-fixture-equivalence.json`、`css-equivalence.json`、`cageledger-frontend-equivalence.json`、`cageledger-print-equivalence.json` 和 `independent-review.md`。

## 最终代码完整验收

| 门禁                   | 最终结果                                                                 | 证据（相对hotspot-evidence）                                   |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 完整check              | 退出0；格式/lint/类型、架构、API/UI/Ant/样式契约、文档构建全部通过       | final-acceptance/final-check.log                               |
| 前端                   | 97文件627项通过；原95文件仅增加2个按领域拆分的打印测试文件，测试数量未变 | final-acceptance/final-check.log                               |
| Python                 | 751项通过，原749项保留，新增2项静态API owner保护测试；0ResourceWarning   | final-acceptance/final-check.log                               |
| 构建                   | 应用及文档构建退出0，现有图表大块提醒保留                                | final-acceptance/final-build.log                               |
| 完整Chromium           | 277/277                                                                  | final-acceptance/full/chromium/results.json                    |
| 完整Firefox            | 35/35                                                                    | final-acceptance/full/firefox/results.json                     |
| 完整WebKit             | 35/35                                                                    | final-acceptance/full/webkit/results.json                      |
| 最小初始化及原业务探针 | 无应用初始化18项、数量表保存/删除1项通过                                 | final-acceptance/browser-init.json、probe/firefox/results.json |
| 反馈迟到响应           | 三引擎各2场景，共6/6通过                                                 | final-acceptance/feedback/results.json                         |
| 短视口焦点重复         | 三引擎各2次，共6/6通过                                                   | final-acceptance/focus/results.json                            |
| 键盘性能重复           | Chromium3轮×每模式25次，通过原阈值                                       | final-acceptance/performance/results.json                      |
| SQLite所有权/事务      | 7项、30个连接全部实际关闭，提交/异常回滚/嵌套/提交失败等原验证通过       | final-acceptance/sqlite-ownership.json                         |

三引擎完整目录合计347，恰好覆盖上一轮最终目录；没有删除、跳过、flaky或自动重试。每库单worker，原本地30000ms测试预算、5000ms断言预算及原用例内特定预算保留，未使用旧的独立启动预算或静态运行模式。全部阶段退出码、命令及时间见 `final-acceptance/final-stages.json`，严格核验见 `verification.json`，输入指纹见 `final-inputs.json`，生成数据库隔离见 `isolation.jsonl`。完整覆盖包含计费结算/减免/打印、权限/审计、批量失败重试、重复操作、取消和返回恢复；额外反馈验证初次请求和轮询迟到后切换记录时草稿、内容及单次提交归属。

SQLite修复仍是上一轮的测试夹具资源关闭，本轮仅重新划分fixture并复验；没有修改生产连接管理，不能称作新修复生产泄漏。

## 性能复验口径

同一31行表首行日期Tab，Chromium开发构建，指针移开，3轮×每模式25样本。上轮实测显式getClientRects调用为隐藏动物6次/显示动物1次，本轮分别为6/1；该指标保持。同步事件耗时中位数本轮隐藏0.30ms、显示0.30ms（上一轮均约0.30ms）。原发布版217次属于上一轮保留的历史测量，本轮未重新运行发布版，不冒称同窗口新A/B提速。

显式调用不包含其他几何读取或scrollIntoView内部布局；同步耗时不是端到端或生产性能，受计时精度及资源压力影响。反馈列表渲染隔离原测试再次包含在完整627项中。完整浏览器性能用例原断言也保留。

原生成SQL基准脚本同口径复验：1万笼位、10万记录、40轮（并发项20线程）。该脚本直接运行合成SQL，不是HTTP或repository函数端到端基准；实际repository行为由业务/浏览器回归和原SQL体等价保护，不宣称重构带来SQL提速。

| SQL P95（ms）  | 上一轮记录 |  本轮 |
| -------------- | ---------: | ----: |
| 数量深分页     |       0.19 |  0.18 |
| 数量筛选选项   |       1.76 |  1.77 |
| 月房间聚合     |       4.85 |  4.74 |
| 20并发结算候选 |      14.88 | 16.08 |

测试期间内存压力采样等级为[1, 2]；这些性能数值只作本地回退观察，不能当生产容量结论。

## 失败、修复与复验

1. 草稿抽取的装饰器/缩进和CSS分界校验曾失败，均在运行测试前由保护检查拦截并修正；导入/格式诊断通过规范工具整理，没有忽略规则。
2. 第一轮反馈目标测试虽然88项通过，但独立review发现HTTP测试导入TestCase导致38项重复发现。改为共享非TestCase fixture，原50项精确目录复验通过；88项不作验收依据。
3. 修正后一次受限sandbox运行49通过、1项临时回环bind被拒；同原50项在已获授权的隔离服务环境通过。没有放宽断言、增加自动重试或换路径绕过自动审批。
4. 首次完整check（d0dd828）前端627通过，但Python739含2个导入错误：旧反馈API/导入测试仍依赖FakeGitea兼容导出。补回显式非TestCase导出后，相关64项通过；完整验收改用新目录，在最终提交重新全部运行。

5. 目标文档检查曾误调用库入口，退出0不能作实际检查证据；完整check中的原npm命令不受影响。收尾使用显式Markdownlint API和原规则配置逐文件检查，包括归档文件，并记录真实文件数及错误数。

6. 最终验证器首次错误要求未选中的Firefox/WebKit项目也repeat3；实际仅选中Chromium且3次均通过。已按实际选中项目分别严格核对repeatEach及retry0，原脚本和诊断保留 `final-acceptance/verify-final-first.py`、`verifier-first-failure.json`；没有重跑或放宽任何测试。
7. 最初收尾检查发现不带监听端口的PDF预热Chrome。经阶段启动时间、临时profile出生时间、精确命令/PID/PGID及工作目录逐一证明，本轮7组根进程仅用SIGTERM正常关闭，子进程全部退出；初次快照和正常清理证据分别为 `final-acceptance/cleanup-initial-candidate-snapshot.json`、`browser-candidate-classification.json`、`browser-cleanup-action.json`。仅端口无监听不能证明无后台浏览器，后续核验已纳入该检查。

首次完整失败为 `final-check.log`、`final-stages.json`；其他记录为 `implementation-failures.json`、`target-stages.json`、`feedback-target-corrected.log`、`feedback-target-corrected-authorized.log`、`feedback-dependent-recheck.log`。新结果不覆盖旧失败。上一轮设备/初始化失败仍在兄弟目录optimization-evidence保留，不能据本轮通过声称宿主机唯一根因已修复。

## 新发现的PDF退出生命周期风险

本轮7次隔离服务结束后，各自PDF预热Chrome仍存活，父进程已变为1；7组均已按证明的归属正常关闭。来源与 `server_app/pdf/renderer.py` 的持久后台线程及预热方式一致：当前正常退出没有对应的shutdown/close路径，异常分支才显式browser.close。本轮没有修改该文件或扩大为PDF生命周期工程，不能宣称这一问题已修复；生产重启行为及此前设备资源退化的唯一根因尚未验证。

另有26组相同工作目录的浏览器，其临时profile出生时间早于本轮基线2026-10-23T23:53:44Z。仅凭目录不能确认归属，因此未终止或删除其profile；这些候选不被描述为本轮已清理。建议下一阶段单独补充PDF renderer正常退出/测试服务收尾的所有权管理，并以重复启停后的进程数不增长验证，先处理可证明自有的实例。

## 提交、残余限制与回退

本轮本地提交：

```text
c89226b docs: plan remaining fourteen hotspot decompositions
0f58603 refactor: separate backend persistence and request responsibilities
68bd99b refactor: separate settlement models and printable layouts
f4c9a9a refactor: isolate inspection quantity and cage presentation
d0dd828 refactor: separate feedback fixtures and transport tests
e2f65e6 fix: preserve shared feedback fixture compatibility export
```

独立工作树：`/Users/hugo/Documents/Codex/2026-10-23/task/cageledger-optimization`。归档报告后的提交只更改文档，最终交付指纹/清理结果见 `final-acceptance/delivery.json`。原项目状态以 `final-acceptance/cleanup.json` 的只读快照为准，本任务没有修改原工作树。

14项原热点均有实现和验证结论，当前架构0阻断/0提醒/0热点。仍有已有图表大块构建提醒、自然悬停提示层Gecko诊断及上述未修复PDF退出问题，未纳入阈值豁免。未验证生产流量、NAS、实体设备或外部私有monkeypatch扩展；浏览器兼容仅为本机测试。未对系统安全、网络、电源或浏览器版本作改动。

回退在独立分支按实现提交逆序进行：先e2f65e6兼容修复、d0dd828测试拆分、f4c9a9a界面/样式、68bd99b打印、0f58603后端，可回到已验收d4b18cc的应用内容；报告与计划文档可独立保留或撤回。没有生产部署、schema迁移执行或数据回迁，因此不存在本轮生产回滚步骤。
