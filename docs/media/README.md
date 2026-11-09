# 文档媒体维护

本目录说明媒体维护入口；发布素材统一位于 `wiki/public/`，避免 docs 与 Wiki 各存一份图片。

| 内容               | 唯一来源                                       | 更新方法                                           |
| ------------------ | ---------------------------------------------- | -------------------------------------------------- |
| 真实界面截图       | `wiki/public/screenshots/*.png`                | 受管采集与显式推广                                 |
| 截图元数据         | `wiki/public/screenshots/manifest.json`        | 推广脚本生成，含版本、日期、页面与 SHA-256         |
| 原创业务与技术图   | `wiki/public/diagrams/*.svg`                   | `node scripts/documentation/generate-diagrams.mjs` |
| 图示源定义         | `scripts/documentation/generate-diagrams.mjs`  | 修改定义后重新生成并检查实际排版                   |
| 图文规范与外部引用 | [图文与引用规范](../../wiki/图文与引用规范.md) | 同步图注、alt 与来源脚注                           |

采集命令：

```bash
npm run test:e2e -- tests/e2e/documentation-capture.spec.ts
node scripts/documentation/publish-screenshots.mjs <capture-manifest.json> <results.json>
```

采集仅使用受管隔离数据库。普通测试不会改写文档图片；只有完整成功报告对应的截图可推广。推广前逐张检查页面加载、关键操作和数据来源。示例数据为虚构，不从生产库或历史备份截取人员、经费、证件与业务记录。

图示由项目原创，不依赖外部图片服务。外部文档引用采用就近脚注，标明原始 URL、参考范围与访问日期；需要转载图片时另行核对授权，不把“参考设计”写成“官方组件”。
