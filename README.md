# CageLedger

实验动物笼位管理与饲养费核算系统。当前版本是面向内网试用的轻量级 MVP：前端使用原生 HTML/CSS/JavaScript，后端使用 Python 标准库提供 HTTP API，数据默认保存到 SQLite。

## 核心能力

- 笼卡管理：粘贴实验动物预约接收消息后自动识别批次、IACUC、购买单位、品系、数量、房间和接收日期，保存待接收批次并按 A4 纸 14 张笼卡批量打印。
- 笼卡打印：预约消息识别兼容常见历史格式，打印时供应商自动显示简称，并统一日期、字号和 A4 切卡版式。
- 笼位管理：按饲养间、笼架、行列生成 IVC 笼位图，支持新增/删除饲养间和笼架。
- 占用登记：支持空笼、预约、在用、取材结束和批量录入。
- 项目绑定：按 IACUC 编号绑定项目名称、项目负责人、实验负责人、笼盒编号和备注。
- IACUC 回填：管理员上传动物实验申请汇总表 CSV 后，录入 IACUC 编号可自动带出项目信息。
- 饲养费核算：保留笼位图和数量统计表两个数据入口，导出时按项目负责人汇总其名下多个 IACUC 的每日笼数、负责人类型减免、阶梯计费和累计费用。
- 数量统计表结算：兼容纸质《实验动物数量统计表》，可录入月初结余和变更行，系统按同月同项目负责人汇总生成饲养费明细与结算单。
- 权限控制：支持系统管理员和房间管理员，房间管理员只能编辑授权饲养间。
- 审计记录：服务端记录关键写操作的账号、对象、时间和变更前后数据。
- 系统管理：管理员可查看系统信息、更新检查、更新记录、API 概览和维护文档。

## 运行方式

### 共享模式

共享模式会启动后端 API，并把数据写入 SQLite，适合本机或内网多人试用。

```bash
npm run dev
```

访问：

```text
http://localhost:5173
```

首次启动会自动创建默认管理员：

```text
用户名：admin
密码：admin123
```

长期使用前建议通过环境变量覆盖默认密码：

```bash
CAGELEDGER_ADMIN_USERNAME=admin CAGELEDGER_ADMIN_PASSWORD=更强的密码 npm run dev
```

数据库默认路径：

```text
data/cageledger.sqlite
```

### 静态模式

静态模式不启动后端，数据只保存在当前浏览器 `localStorage`，适合界面预览或临时演示。

```bash
npm run static
```

## 常用命令

```bash
npm run dev              # 启动 Python 后端和静态页面
npm run static           # 仅启动静态文件服务
npm run check            # 检查前端 JS 语法和 Python 编译
npm run package:offline  # 生成 NAS 离线源码包
npm run release:local -- --version 0.4.1 --push  # 本地顺序化发布
```

## 项目结构

```text
.
├── index.html                    # 前端入口
├── server.py                     # 后端 API、SQLite 存储、权限和审计
├── src/
│   ├── app.js                    # 前端应用逻辑
│   └── styles.css                # 前端样式
├── assets/
│   └── cageledger-icon.svg       # 站点图标
├── scripts/
│   ├── generate_iacuc_index.py   # 旧版 XLSX 索引生成脚本
│   └── package_offline.sh        # 离线源码包脚本
├── docs/
│   ├── API.md                    # API 和数据模型说明
│   ├── DEPLOYMENT.md             # Docker、NAS 和离线部署说明
│   └── USER_MANUAL.md            # 系统用户手册（管理员/房间管理员）
├── data/                         # 本地运行数据，已被 Git 忽略
├── Dockerfile
├── docker-compose.yml
└── docker-compose.offline.yml
```

## 配置

可复制 `.env.example` 作为部署时的环境变量参考。常用配置如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CAGELEDGER_HOST` | `0.0.0.0` | 后端监听地址 |
| `CAGELEDGER_PORT` | `5173` | 后端监听端口 |
| `CAGELEDGER_DB` | `data/cageledger.sqlite` | SQLite 数据库路径 |
| `CAGELEDGER_IACUC_INDEX` | `data/iacuc-index.json` | 兼容索引文件路径 |
| `CAGELEDGER_ADMIN_USERNAME` | `admin` | 初始管理员账号 |
| `CAGELEDGER_ADMIN_PASSWORD` | `admin123` | 初始管理员密码 |
| `CAGELEDGER_REPOSITORY_URL` | `https://git.cellnucle.us/hugo/cageledger` | 项目仓库地址 |
| `CAGELEDGER_BRANCH` | `main` | 远端分支 |
| `CAGELEDGER_UPDATE_CHECK_ENABLED` | `false` | 是否启用远端更新检查 |
| `CAGELEDGER_GITEA_TOKEN` | 空 | 私有 Gitea 仓库更新检查使用的只读 token |

页面展示的单位、科室、开发者、联系邮箱、版权和协议也可通过 `CAGELEDGER_ORGANIZATION`、`CAGELEDGER_DEPARTMENT`、`CAGELEDGER_DEVELOPER`、`CAGELEDGER_CONTACT_EMAIL`、`CAGELEDGER_COPYRIGHT` 和 `CAGELEDGER_LICENSE` 覆盖。

## IACUC 汇总表

管理员可在「数据管理 -> IACUC 索引」上传 CSV 汇总表。CSV 必须包含：

- `动物伦理编号`
- `动物实验名称`
- `项目负责人`
- `实验负责人`

如果希望结算单自动带出支撑经费，建议同时包含以下任一列名：

- `项目来源`
- `支撑经费`
- `经费来源`

上传后系统会重建 SQLite 中的 `experiment_applications` 表，并同步生成兼容文件：

```text
data/iacuc-index.json
```

旧版本地 XLSX 生成脚本仍保留：

```bash
python3 scripts/generate_iacuc_index.py /path/to/iacuc-summary.xlsx
```

该脚本需要本机 Python 环境安装 `openpyxl`。真实 IACUC 数据包含业务敏感信息，`data/` 和 `src/iacuc-data.local.json` 已被 Git 忽略。

## Docker 和 NAS 部署

常规 Docker Compose、群晖部署、离线源码包构建和镜像发布说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

最简启动：

```bash
docker compose up -d
```

默认访问：

```text
http://服务器IP:5173
```

## 开发者参考

- API 与主要数据表见 [docs/API.md](docs/API.md)。
- 终端用户操作手册见 [docs/USER_MANUAL.md](docs/USER_MANUAL.md)。
- 版本号维护在 `package.json` 的 `version` 字段中。
- 页面资源版本、后端 `/api/system/info` 和 UI 版本展示都读取同一版本信息。
- 发布功能更新时建议同步提升 `package.json` 版本号，并发布对应 Gitea Release 与镜像制品。

## 版权

- 所属单位：中山大学中山眼科中心
- 所属科室：实验动物中心
- 开发人员：Hugo
- 联系邮箱：info@cellnucle.us
- 开源协议：Apache License 2.0

开源协议正文见 [LICENSE](LICENSE)，归属和版权说明见 [NOTICE](NOTICE)。
