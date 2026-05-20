# Risk Assessment

## S.U.P.E.R Architecture Health Summary

> 当前代码库具备可运行、可部署、可发布的业务能力，规范化改造的关键点是把隐式契约变成显式契约，把单文件复合职责拆成稳定边界。

| Principle | Status | Key Findings | Transformation Priority |
|:----------|:-------|:-------------|:------------------------|
| **S** Single Purpose | 🔴 | `src/app.js` 和 `server.py` 都承担多类职责，单文件复杂度过高 | High |
| **U** Unidirectional Flow | 🟡 | 主要数据流能描述，状态回写、页面重绘和服务端辅助函数仍有跨层耦合 | High |
| **P** Ports over Implementation | 🔴 | 接口返回结构、前端状态结构、脚本输入输出多依赖内联字典和隐式格式 | High |
| **E** Environment-Agnostic | 🟡 | 环境变量基础完整，静态模式、共享模式、打印模式和 runner 差异仍有实现层散布 | Medium |
| **R** Replaceable Parts | 🔴 | 替换前端状态层、后端存储层或流程模块都会波及大面积调用点 | High |

**Overall Health**: _1/5 principles healthy_ — Technical Debt Alert

### S.U.P.E.R Violation Hotspots

1. `src/app.js`
2. `server.py`
3. `src/styles.css`
4. `scripts/release_local.sh` 与版本同步链
5. `.gitea/workflows/*` 的发布约定

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:-----|:-------|:-----------|:---------|:-----------|
| 单文件改动触发连锁回归 | High | High | Critical | 先定义契约与边界，再做物理拆分 |
| 结算链 UI 与数据链路偏离 | High | Medium | High | 每个结算相关任务同时验证前后端与导出结果 |
| 本地静态模式与共享模式行为漂移 | Medium | High | High | 把模式差异归入显式配置层并补行为清单 |
| 发布链 tag、release、镜像语义失配 | High | Medium | High | 固化 release contract，保留版本同步和发布顺序约束 |
| Gitea runner / shell / 内网环境差异引入发布失败 | Medium | Medium | Medium | 为 workflow 补执行环境约束和兼容检查 |
| 旧库兼容与迁移逻辑被重构破坏 | High | Medium | High | 迁移逻辑分层前先抽兼容 contract 和回归样本 |
| 演示和正式数据边界混淆 | Medium | Low | Medium | 脚本化生成演示数据，保持 `data/` 不入库 |

## High-Severity Risks

### 1. 业务核心集中在两个超大文件

`src/app.js` 和 `server.py` 已经具备完整业务能力，同时也积累了隐式依赖。直接按功能点横切改动，回归面会持续扩大。规范化的第一步是把状态、契约、仓储、服务、视图分层清单写出来。

### 2. 结算链路对隐式数据结构依赖很重

数量统计表、动态笼位图、结算预览、导出 PDF、流程中心之间共享大量结构化对象。当前对象格式主要依赖实现细节和命名约定。任何前后端字段调整都需要显式 schema 和回归样本。

### 3. 多运行模式并存

静态模式、共享模式、打印模式、导出模式、Gitea 发布模式都存在独立行为差异。当前差异主要靠条件分支管理。后续应当把模式切换前移为配置层和 capability layer。

## Technical Debt

- 前端状态层、渲染层、领域逻辑层耦合
- 后端路由、仓储、服务、兼容迁移耦合
- API 契约缺少集中定义
- 打印/导出逻辑与业务对象绑定过深
- 样式系统以单文件维护，模块边界较弱
- 进度、架构和重构约束此前未进入正式项目文档

## Compatibility Concerns

- SQLite 旧库自动升级路径必须保持可用
- IACUC 历史兼容字段和 CSV 列别名必须保持可用
- 数量统计表与动态笼位图双入口必须保持并存
- 发布检查必须继续以 Gitea Release 为准
- 房间管理员权限边界必须保持稳定
