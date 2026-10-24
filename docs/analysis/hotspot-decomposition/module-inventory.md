# 14处热点基线与拆分边界

基线为已验收d4b18cc（应用b88b90b）。规模使用原架构脚本的换行统计；不更改阈值、排除、基线或目标。

| ID  | 精确文件                                                          | 原行数 | 职责                                         | 拆分边界                                                           | 行为验证                                     |
| --- | ----------------------------------------------------------------- | -----: | -------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| H01 | `server_app/domains/animal_management/service.py`                 |    755 | 巡检草稿/提交、异常、附件、权限、SQL投影     | service保留用例编排；repository提取行读写投影；rules提取权限及校验 | 巡检、权限、附件、审计、报告                 |
| H02 | `server_app/domains/reimbursement_ledger/service.py`              |    771 | 报销单、核销、附件、历史迁移及应收同步       | 拆出allocation操作、附件及共用校验；保留单据与应收编排             | 报销余额、核销并发/回滚、归属、附件          |
| H03 | `server_app/pdf/documents.py`                                     |    642 | 数量表和结算PDF HTML、投影、分组版式         | 数量表、结算版式/模型和基础文档格式分离；入口兼容导出              | 前后端模板等价、PDF、计费/减免               |
| H04 | `server_app/persistence/base_schema.py`                           |    704 | 全部基础DDL及迁移初始化顺序                  | 按基础设施/业务/身份表抽取DDL；初始化保留原顺序和事务              | 空库和旧库迁移、幂等、sqlite_master与DDL顺序 |
| H05 | `server_app/repositories/billing_candidates.py`                   |    643 | 候选快照查询、过滤和快照注册/失效            | 查询与筛选叶子、快照存储维护、数量来源分组分离                     | 候选筛选分页、失效、业务版本指纹             |
| H06 | `server_app/repositories/billing_workflows.py`                    |    726 | 流程列表查询、投影、版本/事件及写入          | 查询编排、投影、写入分离；旧repository入口保留                     | 流程列表/版本/事件、结算与权限               |
| H07 | `server_app/web/read_actions.py`                                  |    608 | 全部GET领域适配器                            | 按账单/报销/巡检/系统等领域Mixin分离，组合类保持原方法接口         | API清单、HTTP权限/下载、路由注册             |
| H08 | `src/react/features/animal-management/InspectionLists.tsx`        |    543 | 巡检记录列表、异常列表、详情弹窗             | 记录、异常、详情与共用叶子分离；原命名导出兼容                     | 巡检列表/详情/异常、导航返回                 |
| H09 | `src/react/features/billing/components/SavedQuantitySheets.tsx`   |    458 | 已存数量表查询/选择/导出和预览               | 列表编排保留memo和状态；表格/标题、预览分离                        | 列表筛选/滚动恢复、批量/导出、取消           |
| H10 | `src/react/features/cages/components/CageWorkspaceComponents.tsx` |    430 | 虚拟笼架、单格编辑、放置和批量编辑           | 四个职责组件独立；原入口兼容导出                                   | 笼位选择、虚拟滚动、放置/批量动作            |
| H11 | `src/react/print/printTemplates.test.ts`                          |   1078 | 笼卡、QR、数量表、结算和注释打印测试         | 按模板域拆测试，保持原断言和精确用例集合                           | 前后同名用例集合/数量相同                    |
| H12 | `src/react/print/settlement.ts`                                   |    639 | 结算数据投影、分组、分页和HTML打印           | 纯模型、分组单元格、入口版式分离；导出API保留                      | 分组跨页、混合计费、减免和同口径HTML         |
| H13 | `src/styles/features/animal-management.css`                       |   1919 | 巡检上下文、录入、列表、目录、详情及移动样式 | 按连续职责区段拆分CSS，严格保留展开后规则顺序和ownership           | CSS AST等价、样式归属、巡检桌面/窄屏         |
| H14 | `tests/test_feedback.py`                                          |   1147 | 反馈服务、远端同步、HTTP、客户端测试及fake   | 公共隔离夹具独立；本地、同步、客户端/HTTP按职责拆分                | 保持原测试全集，SQLite警告、无重复发现       |

S.U.P.E.R基线：14项均存在单职责聚合；现有接口/环境注入保留（P/E），本轮重点改进S/U/R。无新增协议或业务算法。各拆分通过原体函数/AST或规则序列等价、现有回归和循环依赖检查核验，不靠主观评分认定通过。
