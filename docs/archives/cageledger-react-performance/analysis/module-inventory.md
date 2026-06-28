# React/Vite 性能升级模块清单

| 模块 | 当前责任 | 复杂度 | S.U.P.E.R | 迁移目标 |
|:-----|:---------|:-------|:----------|:---------|
| `src/main.tsx` | React Provider 和根入口装配 | Low | S绿 U绿 P绿 E绿 R绿 | 已完成正式切换 |
| `src/react/features` | 按业务域拆分的懒加载视图 | Medium | S绿 U绿 P绿 E绿 R绿 | 保持行级更新和领域边界 |
| `src/react/api` | typed API、Query hooks 和查询键 | Medium | S绿 U绿 P绿 E绿 R绿 | 保持窄范围缓存失效 |
| `src/styles.css` | 全系统视觉和响应式 | High | S黄 U绿 P黄 E绿 R黄 | 保留视觉契约并按组件清理 |
| `src/vendor/jsQR.js` | 二维码识别 | Low | S绿 U绿 P黄 E绿 R黄 | 扫码页动态导入 |
| `server.py` | HTTP、迁移、业务装配、静态资源 | Critical | S红 U黄 P黄 E黄 R红 | 保留兼容入口，收敛静态响应和计时 |
| `server_app/repositories` | SQLite 查询和持久化 | High | S黄 U绿 P黄 E绿 R黄 | 热字段、复合索引和查询基准 |
| `server_app/services` | 业务工作流 | Medium | S绿 U绿 P黄 E绿 R黄 | 保持现有接口和数据语义 |
| 发布链 | 版本、Docker、离线包、Gitea | High | S黄 U黄 P黄 E黄 R黄 | Node 构建 + Python 运行 |

## 关键边界

- React 组件只能通过 typed API hooks 和领域函数访问数据。
- 业务计算保持纯函数，可在 Vitest 中脱离 DOM 与服务器运行。
- repository 返回现有 JSON 契约；新增实体列只承担查询加速。
- `web-dist` 是构建产物，不作为手工编辑对象。
