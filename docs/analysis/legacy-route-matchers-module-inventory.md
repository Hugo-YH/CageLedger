# legacy.py 路径匹配器拆分：模块清单

| 模块                            | 职责                                          | 依赖                                | 复杂度 | S.U.P.E.R           |
| :------------------------------ | :-------------------------------------------- | :---------------------------------- | :----- | :------------------ |
| `legacy.py` route matcher 段    | URL 切片、单次解码、单段校验、少量 query 读取 | handler、`urllib.parse`、shared     | Medium | S🔴 U🟡 P🟡 E🟢 R🟡 |
| `web/route_matchers.py`（目标） | 纯路径和 query 参数匹配                       | `urllib.parse`、`shared.clean_text` | Low    | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `web/router.py`                 | HTTP 方法与 Regex 路由分发                    | handler                             | Low    | S🟢 U🟢 P🟢 E🟢 R🟢 |

## 迁移范围

- `reimbursement_*`、`animal_inspection_*`、`user`、`quantity_sheet`、`billing_workflow`、`reimbursement_record`、`intake_batch` 和 `placement_task` matcher。
- 保留 `do_GET`、`do_POST`、`do_PUT`、`do_DELETE` 的调用顺序。
- 保留 `entity_route`、`animal_inspection_filters` 与 `pdf_export_job_route`，作为后续独立切片。

## 契约

所有动态 ID 保留“一次 `unquote` 后拒绝空值和 `/`”的语义，涵盖 `%2F` 安全拒绝和 `%252F` 单次解码。巡检附件上传 matcher 显式接收 `path` 和 `query`，返回 `(inspection_id, finding_id)` 或 `(None, None)`。
