# Phase P0: 后端草稿、发布与图片

- [x] T1 目录结构校验模块 `catalog_schema.py`（code 唯一、parent/module 存在、nodeType/input_type 合法、referenceImages 存在）— 验收：单测覆盖合法/非法
- [x] T2 草稿接口 `GET/PUT /api/animal-inspection-catalog/draft`（克隆 active、保存前校验、管理员）— 验收：管理员可保存，房间管理员 403，非法 400
- [x] T3 发布接口 `POST /api/animal-inspection-catalog/draft/publish`（active→history、draft→active、manual-* 版本、审计）— 验收：发布后 GET 返回新 active，旧版本可查
- [x] T4 参考图上传（multipart、白名单）+ data 目录存储 + 种子图迁移 + 路由回退 — 验收：上传返回 URL，重启后图片仍在

## Notes

- 开始：2026-08-05
- 完成：2026-08-05。API 冒烟验证：管理员保存草稿 200 / 非法结构 400 / 乐观锁 409 / 房间管理员 403；发布后旧 active 转 history、新 active 为 `manual-*`、审计落库；图片上传 201、txt 拒收 400、data 目录 93 张（92 种子 + 1 上传）且参考图路由可读。
