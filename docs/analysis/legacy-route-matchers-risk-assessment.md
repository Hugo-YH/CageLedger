# legacy.py 路径匹配器拆分：风险评估

## S.U.P.E.R 健康度

| 原则 | 状态 | 发现                                      | 优先级 |
| :--- | :--- | :---------------------------------------- | :----- |
| S    | 🟡   | Handler 混合路径识别与 HTTP 处理          | High   |
| U    | 🟡   | 纯 matcher 可实现 `legacy → web → shared` | High   |
| P    | 🟡   | 现有返回值隐式，需以纯单测固定            | High   |
| E    | 🟢   | 不读取配置与数据库                        | Low    |
| R    | 🟡   | 独立模块可单测替换                        | Medium |

## 风险与控制

| 风险                  | 控制措施                                                                               |
| :-------------------- | :------------------------------------------------------------------------------------- |
| 路由优先级变化        | 仅改调用目标，保留每个 `if` 的原始顺序                                                 |
| 双重解码或 `+` 变空格 | 仅使用一次 `unquote`，query 继续由现有 `parse_qs` 解析                                 |
| `%2F` 绕过单段校验    | 解码后继续拒绝 `/`                                                                     |
| 导入循环              | route matcher 仅依赖标准库和 `shared`，禁止导入 legacy、handler、service 或 repository |

## 测试范围

覆盖正常 ID、中文 percent 编码、空 ID、多段路径、`%2F`、复合 suffix、行动路由、附件 `findingId` 缺失/多值，以及保留 `quantity-sheets/filter-options` 和 `billing-workflows/{id}/lines` 的优先匹配行为。
