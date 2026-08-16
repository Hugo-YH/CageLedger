# `server_app/legacy.py` 持续拆分：里程碑

| 里程碑             | 阶段    | 达成条件                                                | 状态   |
| :----------------- | :------ | :------------------------------------------------------ | :----- |
| M1 契约冻结        | Phase 1 | 公共符号、migration、HTTP、权限与副作用基线可自动验证   | 待开始 |
| M2 legacy 脱离硬限 | Phase 2 | schema、runtime 和薄 facade owner 清晰，legacy 明显下降 | 待开始 |
| M3 State 单向化    | Phase 3 | pure rules、query/persistence、commands 分层完成        | 待开始 |
| M4 核心事务归域    | Phase 4 | billing/workflow/reimbursement 均有单一事务 owner       | 待开始 |
| M5 HTTP 薄化       | Phase 5 | handler 只承担协议适配和 method dispatch                | 待开始 |
| M6 legacy 终态     | Phase 6 | legacy ≤250 行，热点基线删除，全量验证通过              | 待开始 |
