# legacy.py 尺寸治理：模块清单

| 模块                           | 职责                                  | 依赖                               |         行数/范围 | 复杂度   | S.U.P.E.R 评分      |
| :----------------------------- | :------------------------------------ | :--------------------------------- | ----------------: | :------- | :------------------ |
| `server_app/legacy.py`         | 兼容入口、schema、业务编排、HTTP 路由 | domains、repositories、web、SQLite | 7,106（质检计数） | Critical | S🔴 U🟡 P🟡 E🟡 R🔴 |
| `server_app/web/handler.py`    | 共用 HTTP handler 生命周期            | 标准库 HTTP                        |              小型 | Low      | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `server_app/web/router.py`     | API 路由与 JSON 响应适配              | Web handler                        |              小型 | Low      | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `server_app/domains/quantity/` | 数量表领域服务与仓储                  | SQLite、billing 边界               |            多模块 | Medium   | S🟢 U🟡 P🟡 E🟢 R🟡 |
| `server_app/domains/billing/`  | 结算、候选与账单规则                  | SQLite、缓存                       |            多模块 | High     | S🟡 U🟡 P🟡 E🟢 R🟡 |

## 首个提取模块：multipart 解析

- **目标路径**：`server_app/web/multipart.py`。
- **现有范围**：`server_app/legacy.py:5034–5070`，包含 `parse_multipart_upload`、`multipart_boundary`、`multipart_filename`。
- **公开 API**：`parse_multipart_upload(content_type, raw) -> dict[str, object]`；错误继续使用当前 `ValueError` 文案。
- **调用方**：6 个 `CageLedgerHandler` 上传处理器，均经 `parse_multipart_upload` 调用。
- **依赖**：Python 标准库 `re`；不访问数据库、认证状态、配置或领域服务。

### S.U.P.E.R 评估

- **S**：解析模块只处理 multipart 边界、字段与文件名。
- **U**：HTTP handler 将请求体传给纯解析函数，再按既有路径处理结果。
- **P**：输入为 `content_type` 与 `bytes`，输出为 JSON 可序列化字典。
- **E**：不含路径、环境变量、密钥或运行时配置。
- **R**：未来可在该模块内替换解析实现，handler 调用点保持稳定。

## 后续候选

| 候选              | 范围         | 风险 | 说明                                        |
| :---------------- | :----------- | :--- | :------------------------------------------ |
| 数量表查询 facade | 约 3436–3467 | 中   | 涉及 `server.py` 兼容导出与 repository 回调 |
| schema 兼容迁移   | 约 522–998   | 高   | 影响旧库启动与 `initialize_schema` 测试入口 |
| Handler 路由      | 5091–7086    | 高   | 影响路由优先级、鉴权和 HTTP 状态码          |
