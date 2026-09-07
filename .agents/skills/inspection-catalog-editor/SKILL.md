---
name: inspection-catalog-editor
description: 维护 CageLedger 巡检目录的草稿、发布、校验、参考图上传与前端编辑模式。
---

# 巡检目录维护

按当前需求定位 `server_app/domains/animal_management/` 的 `catalog_schema.py`、`catalog_draft.py`、`catalog_images.py` 与前端 `InspectionStandards`。只读相关模块；已归档的初次开发计划不是当前待办。

## 保留的业务约束

- 目录结构由 `catalog_schema.py` 定义；改变草稿或发布契约时同步前后端校验。
- 单草稿模型，`expectedUpdatedAt` 乐观锁，目录写入仅限管理员。
- 发布在事务中将旧 active 转 history、draft 转 active；保留现有 `manual-` 版本生成和冲突消解规则，并记录审计。
- 历史答案快照继续引用原目录，不因发布或图片维护被改写。
- 图片由应用接口写入 `data/animal-inspection-images/`，保留 Docker volume、首启幂等种子迁移、JPEG/PNG/WebP 白名单和 5MB 限制。
- 分类、子分类 code 必须与当前 schema 和表单消费端一致；扩展分类时同步消费者，不套用归档 P0 阶段的限制。

## 验证

按修改面验证草稿冲突、非管理员拒绝、发布历史/快照与图片边界。API 或权限改动执行仓库测试契约中的双角色和 API 冒烟要求，编辑界面变动补目标页面验收。完成当前修改及失败修复后交付，不写旧阶段遥测或评分。
