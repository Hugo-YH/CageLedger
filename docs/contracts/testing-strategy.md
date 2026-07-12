# 测试策略

## 分层

| 层级        | 工具                      | 重点                                             |
| ----------- | ------------------------- | ------------------------------------------------ |
| 纯业务单元  | Vitest                    | 日期、笼卡、数量统计表、解析和计算               |
| React 组件  | Testing Library、Vitest   | 表单、状态、局部交互和可访问语义                 |
| Python 单元 | unittest                  | 业务规则、兼容函数和数据转换                     |
| API 冒烟    | `scripts/smoke_api.mjs`   | 鉴权、读写、权限和关键响应                       |
| 浏览器回归  | Playwright                | 用户流程、权限、弹窗、移动端和公开扫码           |
| 可访问性    | `@axe-core/playwright`    | 登录、核心页面和典型弹窗的 serious/critical 问题 |
| 打印与 PDF  | 模板单元测试、浏览器预览  | A4、14 张笼卡、分页、二维码和固定尺寸            |
| 性能        | benchmark、浏览器性能记录 | SQLite 查询、分页、虚拟列表和首屏加载            |

## 快速门禁

`npm run check` 执行格式检查、全部 lint、TypeScript 类型检查、Vitest 和 Python unittest。开发依赖需要提前安装：

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
npm run check
```

## 完整门禁

`npm run verify:full` 在基础质量检查后执行生产构建和完整 Playwright。E2E 使用临时 SQLite，测试数据不会写入正式数据库。

## 业务回归

- 笼卡：识别、保存、打印、接收、回退和待进驻生成。
- 笼位：授权房间、预留、正式入驻、设为空和 Animal Record ID 延续。
- 数量统计表：多类型录入、日期、转入转出镜像、保存、预览和导出。
- 结算：按 PI 合表、IACUC 有效期、逐日减免、全额减免、PDF 和流程发起。
- 流程中心：台账筛选、报销登记、部分缴纳、完成和删除。
- 权限：管理员与房间管理员分别验证前端入口和 API 状态码。

## CI 分工

Gitea CI 执行格式、lint、类型、Vitest、生产构建和架构门禁。Mac mini 执行 Python 全量测试、Playwright、PDF/打印验收、API 冒烟和性能 benchmark；浏览器报告与测试结果保留在本地发布验证记录中。
