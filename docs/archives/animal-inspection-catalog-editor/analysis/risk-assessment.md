# Risk Assessment — 巡检标准在线编辑器

## S.U.P.E.R Architecture Health Summary

| Principle                       | Status | Key Findings                                                   | Priority |
| :------------------------------ | :----- | :------------------------------------------------------------- | :------- |
| **S** Single Purpose            | 🟡     | catalog.py 同时承担导入+读取；前端 model.ts 承担分组+过滤+改名 | Medium   |
| **U** Unidirectional Flow       | 🟢     | 数据单向：文件/DB → API → 前端渲染，无环                       | —        |
| **P** Ports over Implementation | 🟡     | 目录结构缺显式 schema/校验；节点 config 结构靠约定             | High     |
| **E** Environment-Agnostic      | 🟢     | 资源在包内，运行数据在 data/，无硬编码路径                     | —        |
| **R** Replaceable Parts         | 🟡     | 前端异常模块分区逻辑硬编码，换目录数据会不一致                 | Medium   |

**Overall Health**: 3/5 — Refactoring Needed（聚焦目录域）

### S.U.P.E.R Violation Hotspots

1. **前端 model.ts 硬编码过滤/改名/分组**（🔴 P）— 目录数据与表单不一致的根因，编辑器必须先把数据结构显式化
2. **catalog.py 导入+读取混职责**（🟡 S）— 扩展草稿/发布时拆分为独立服务

## Risk Matrix

| Risk                                           | Impact | Likelihood | Severity | Mitigation                                    |
| :--------------------------------------------- | :----- | :--------- | :------- | :-------------------------------------------- |
| 草稿发布破坏 active 目录                       | 高     | 中         | 高       | 服务端全量校验 + 先验后发布 + 历史版本保留    |
| 并发编辑冲突                                   | 中     | 中         | 中       | 单草稿模型 + expectedUpdatedAt 乐观锁         |
| 图片运行时写入不可用（Docker 只读）            | 高     | 中         | 高       | 图片存 data/ volume，种子图首启幂等拷贝       |
| 异常模块分区映射不匹配导致新增条目在表单不显示 | 高     | 中         | 高       | P0 限定现有分类下加条目；P3 把映射迁入 config |
| 历史记录引用旧目录                             | 低     | 低         | 低       | 答案快照语义已保证                            |

## Compatibility Concerns

- 目录版本从种子 `xbehav-v1-*`/`cageledger-v1-*` 过渡到手动版本 `manual-*`，旧版本行保留
- `GET /api/animal-inspection-catalog` 契约保持兼容；新接口均为管理员专属
- 参考图路由保持 `/api/animal-inspection-reference/{filename}`，增加 data 目录回退
