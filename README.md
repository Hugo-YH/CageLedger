# CageLedger

实验动物笼位管理与饲养费核算系统。系统面向实验动物中心内网使用，覆盖笼卡接收、待进驻、笼位维护、数量统计表、月度结算单和流程跟踪。

## 核心能力

- 笼卡管理：解析预约接收消息，生成待接收批次并批量打印笼卡。
- 笼位管理：按饲养间、笼架、笼位维护设施结构和占用状态。
- 待进驻任务：接收确认后自动生成待进驻动物任务，支持预留和正式入驻。
- 饲养费核算：同时支持动态笼位图和数量统计表两条结算入口，数量统计表录入界面按纸质表左右双栏固定槽位录入，支持同一伦理追加统计表页并自动滚动计算结余。
- 流程中心：跟踪月度结算单从生成到提交财务的状态链。
- 权限与审计：区分系统管理员和房间管理员，并记录关键写操作。

## 本地运行

共享模式会启动 Python 后端并写入 SQLite：

```bash
npm run dev
```

静态模式只启动静态文件服务，数据保存在浏览器本地：

```bash
npm run static
```

默认访问地址：

```text
http://localhost:5173
```

默认管理员：

```text
用户名：admin
密码：admin123
```

## 常用命令

```bash
npm run dev
npm run static
npm run check
npm run smoke:api
npm run package:offline
npm run release:local -- --version 0.5.3 --push
```

## 部署与文档入口

- 部署说明：[`wiki/部署与运行.md`](wiki/部署与运行.md)
- 快速开始：[`wiki/快速开始.md`](wiki/快速开始.md)
- 用户操作手册：[`wiki/用户操作手册.md`](wiki/用户操作手册.md)
- API 与数据模型：[`wiki/API与数据模型.md`](wiki/API与数据模型.md)
- 项目结构：[`wiki/项目结构.md`](wiki/项目结构.md)
- Wiki 首页：[`wiki/Home.md`](wiki/Home.md)

## 项目事实

- 当前版本：`0.5.3`
- 正式上游仓库：`https://git.cellnucle.us/hugo/cageledger`
- 正式容器镜像：`git.cellnucle.us/hugo/cageledger:<tag>`
- 正式文档源：`wiki/`
- 工程化分析与契约文档：`docs/`

## 版权

- 所属单位：中山大学中山眼科中心
- 所属科室：实验动物中心
- 开发人员：Hugo
- 联系邮箱：info@cellnucle.us
- 开源协议：Apache-2.0
