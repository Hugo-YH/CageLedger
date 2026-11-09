# 当前实现与兼容边界

本次核对基线为 `main` 的 `11c85df`，对应 `v1.31.7` / Build 276，核对日期为 2026-11-09。它是本次整理的可追溯采样点，不将版本号固定为后续开发要求；新任务先同步 Gitea，再读取 `package.json`、当前导航、调用链与路由登记。

用户入口说明见 [Wiki 当前版本与兼容边界](../../wiki/当前版本与兼容边界.md)。模块目录分工见 [module-boundaries.md](module-boundaries.md)，HTTP 接口登记见 [api-inventory.json](api-inventory.json)。

## 判断顺序

1. 读取 `package.json`、当前分支与源码 revision，确认正在审查的版本。
2. 从 `index.html` → `src/main.tsx` → `src/react/App.tsx` → `features/shell/ReactWorkspace.tsx` 追踪入口；同时核对 `workspaceNavigation.ts`、`MobileNavigation.tsx`、角色和系统功能开关。
3. 从实际 View 追踪运行时组件、typed hook、HTTP 方法与路径、领域服务及 repository。类型引用、测试 import、兼容 re-export 和孤立组件的渲染测试都不能证明生产入口可达。
4. 再读取相关契约和使用说明。发现不一致时修正文档；不要为了符合旧文档去恢复已经撤下的界面。

审查发现必须写明入口或调用方、触发条件、影响与证据。当前页面缺陷、仍可访问的兼容 API 风险和未接入组件的问题分别说明；测试复现的影响范围不得超出其真实调用路径。

## 状态分类

| 类别                       | 判断依据                                                   | 维护方式                                                                 |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| 现役入口                   | 当前桌面或手机导航、快捷入口及 View 实际接入               | 同步用户说明与对应行为回归                                               |
| 受开关或权限控制的现役功能 | 生产代码存在真实入口，受当前配置限制                       | 保留正常角色与开关行为；隐藏不等于退役                                   |
| 兼容视图或调用             | 仍保留历史视图值、接口或包装器，当前默认菜单不提供独立入口 | 明确替代入口和保留理由，不宣称不存在外部调用方                           |
| 未接入的历史前端实现       | 从生产入口无运行时依赖路径，可能仍有测试或兼容导出         | 登记 `frontend-lifecycle.json`；重新接入时同时更新登记、导航、文档及验证 |
| 历史资料                   | 旧版本计划、验收、演示快照及更新日志                       | 保留原版本和证据，不作为当前任务、授权或门禁                             |

## 已核实的易混淆边界

- `WorkflowCenterView` 当前只挂载 `BillingWorkflowPanel`。旧结算应收、报销单、核销中心、历史台账四页签及旧报销单弹窗没有生产入口；对应组件和测试仍保留。
- 当前报销登记使用 `/api/billing-workflows/advance` 与 `/{id}/reimbursement-forms`；旧 `/api/reimbursement-ledger/*` 仍登记并受鉴权、归属及资金校验保护。原 `/api/reimbursement-records/*` 的导入仍被数据管理使用，不能把整个后端报销领域判成无用。
- “已登记”和“已归档”不是同一状态。当前 UI 的 `statement_archived` 表示已登记、未归档，`statement_locked` 才表示锁定且已归档。`statement_signed_returned`、`submitted_to_finance` 等旧值继续兼容，不作为新的正常操作步骤。
- `cages` 是现役笼位管理；`billing-cage-map` 是仍保留的动态笼位计费视图，默认饲养费菜单不提供该入口。正式饲养费结算来源为数量统计表，两者不能混称为退役或现役结算入口。
- `technical-service-settlement` 视图值保留并转入共用结算列表；技术服务费当前独立录入、独立出单，与饲养费共用结算列表和单据跟踪。
- `IntakeReviewDialog` 是当前预约图文核对入口；`IntakeRecognitionMergeDialog` 是保留的旧文字补充界面。旧协议和图片兼容格式由后端继续支持，不能随旧弹窗一起删除。
- `LedgerListShared` 仍被当前流程页面复用；扫码 Worker 通过 `new Worker(new URL(..., import.meta.url))` 加载。目录名、旧名称和普通 import 搜索不足以判定模块退役。

## 兼容与删除边界

本轮整理不删除旧组件、接口、数据库字段、payload、迁移或历史审计。前端可达性核对只覆盖已声明的生产入口和可静态解析的依赖；不能证明某个后端接口没有外部调用方，也不能替代动态运行、角色权限或业务回归。

`frontend-lifecycle.json` 登记业务组件的保留理由和替代入口，`npm run check:frontend-lifecycle` 核对其与当前依赖图是否一致。检查发现未登记的不可达实现、已重新接入却仍标为历史的实现时，需要人工核实，而不是自动删除或自动接受新基线。

## 文档与工程维护

- 公开说明由 `wiki/` 维护；项目规则由 `AGENTS.md` 和按领域的契约维护。事实来源与生成文件见 [documentation-system.md](documentation-system.md)。
- 历史计划和验收归入 `docs/archives/`；原路径可保留短索引。旧记录中的“当前分支”“待办”“未发布”和授权只描述当时，不覆盖当前版本与用户指令。
- 运行与依赖版本、发布默认值从当前脚本读取。云端正式发布步骤见 [cloud-development.md](cloud-development.md)；`release:cloud` 校验已有标签、产物和 Packages 凭据并发布 Release，不负责自动改版本、测试、打包、提交或推送。
- 普通整理按影响范围验证并提交推送；不自动升级版本、打标签、构建镜像或部署生产。验证矩阵仍只有 [testing-strategy.md](testing-strategy.md) 一个来源。
