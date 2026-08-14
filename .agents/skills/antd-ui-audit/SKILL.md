---
name: antd-ui-audit
description: 审查和修改 CageLedger 的 Ant Design 工作台、数量录入、弹窗、VitePress 文档样式与无障碍。用于涉及 antd 组件、主题 Token、样式归属、响应式布局、键盘焦点或设计门禁的任务。
---

# CageLedger Ant Design UI 审计

先读取 `docs/progress/MASTER.md`（存在时）和 `AGENTS.md`，再定位目标组件、CSS 归属和四档断点定义。UI 修改依次遵循 `frontend-design`、`fixing-accessibility`、`vercel-react-best-practices`、`webapp-testing`。

## S.U.P.E.R 架构标准

> 像搭积木一样写代码：每个部件只有一件事、接口清楚、依赖方向明确、环境可替换。

- **S 单一职责**：每个模块、文件和函数解决一个问题。判断方式：能否用一句话说明职责。
- **U 单向依赖**：数据沿输入、处理、输出流动；UI 外层依赖 `api`、`domain`、`components/ui`，内层不反向导入页面。
- **P 显式契约**：跨模块通过 TypeScript 类型、props 和 API contract 交互；组件状态与回调保持可序列化、可测试。
- **E 环境无关**：品牌、颜色、间距和动效来自 Token 与配置，不写入运行环境路径、密钥或一次性浏览器状态。
- **R 可替换**：通用组件放在 `src/react/components/ui/`；领域网格、笼位图、评分和打印保留在各自 feature，替换一层不牵动业务规则。

## 审计与实现流程

1. 运行 `npm run check:antd-design`，记录 `antd doctor`、`usage`、`lint` 的结果。
2. 用 `rg` 检索目标 class、`data-ui`、`data-feature` 与媒体查询；确认唯一所有者在 `src/styles/style-ownership.json`。
3. 桌面和平板使用 `antd`，移动导航使用 `antd-mobile`。普通按钮、输入、选择、文本域、确认和反馈使用 `src/react/components/ui/` 或 Ant 原语。
4. 数量网格、笼位图、巡检评分、图表和打印可保留领域 DOM；其中输入、选择、日期、确认和状态必须使用 Ant 控件或适配层。
5. 使用官方蓝 `#1677ff`。颜色、文字、圆角、阴影、层级和动效使用 `src/styles/brand-tokens.css`、`src/styles/tokens.css`、`AntdProvider.tsx` 中的语义 Token。正文 14px、默认控件 32px、紧凑控件 24px、强调控件 40px，控件圆角 6px、容器 8px。
6. 弹窗使用 Ant `Modal`/`Drawer` 或已有适配器。图标按钮提供可访问名称；关闭后焦点回到触发元素；危险操作保持明确确认。
7. VitePress 主题复用 `brand-tokens.css`，表格和内容卡片使用 8px 圆角，代码和紧凑控件使用 6px 圆角。

## 设计门禁

- `npm run check:style-ownership`：样式文件、Ant 选择器边界、层级 Token 和唯一布局所有权。
- `npm run check:antd-design`：本地 `antd doctor`、`usage`、`lint` 和设计契约。
- `npm run check`：格式、类型、单测、Python、架构、UI、样式、Ant 和文档检查。
- UI 改动额外运行目标 Playwright：桌面、1180px、760px、手机横屏；覆盖 focus、disabled、loading、空态和错误态。

## 每个任务后的 S.U.P.E.R 复核

| 检查 | 要求 |
| --- | --- |
| 职责 | 新模块和样式只服务一个组件族或领域 |
| 依赖 | 页面、适配层、API 与领域依赖保持单向 |
| 契约 | props、回调和 API 类型明确 |
| 环境 | 使用声明的依赖与 Token，无硬编码环境值 |
| 替换 | 组件和样式在既定边界内可替换 |
| 验证 | 类型、目标测试和 `git diff --check` 通过 |

全部通过后更新 `docs/progress/MASTER.md` 与当前阶段文件；记录实际工作量、S.U.P.E.R 分数、未计划依赖和 drift 结果。所有任务完成后，将本次审计资料归档至 `docs/archives/`。
