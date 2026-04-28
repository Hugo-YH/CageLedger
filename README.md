# CageLedger 实验动物笼位管理与计费系统

这是一个从 0 搭建的 MVP。当前支持两种运行方式：

- 静态模式：只打开前端页面，数据保存在当前浏览器 `localStorage`。
- 共享模式：通过 `server.py` 启动后端服务，数据保存在 SQLite 数据库，适合群晖内网测试。

## 已实现功能

- 首页概览：集中展示系统名称、总笼位、在用、已预约、空笼位，并用图表展示状态分布。
- 动态笼位图：按饲养间、笼架、行、列生成 IVC 笼位。
- 房间管理：按“饲养间 -> 笼架”树形展示，支持删除饲养间和笼架。
- 笼位状态：支持空、已预约、在用、结束占用。
- 笼位绑定：支持 IACUC 编号、项目负责人、实验负责人、项目名称、笼盒编号、备注。
- 笼盒编号：按“饲养间-笼架号-列行号”自动生成，例如 `SPF 小鼠饲养间 A-1-A1`。
- 笼位录入：空笼位默认按“在用”录入，可单个或批量设为空。
- 取材结束：在用笼位可标记“已取材”，选择取材日期作为最后计费日期，笼位随后回到空状态。
- 批量录入：支持多选笼位后批量写入相同 IACUC、项目、负责人、日期和备注。
- IACUC 自动匹配：基于动物实验申请汇总表生成索引，输入 IACUC 编号后自动回填项目名称、项目负责人和实验负责人。
- 占用历史：结束占用后保留历史记录，用于回溯计费。
- 饲养费核算：按 IACUC 和月份生成每日笼数、当日费用、累计费用。
- 计费规则：基础单价可配置，默认 4.5 元/笼/天。
- 减免扩展：示例数据内置 IACUC 维度折扣规则，计费函数已预留扩展点。
- CSV 导出：结算单可导出为 CSV。
- 数据管理：管理员可上传动物实验申请汇总表 CSV，生成 IACUC 自动匹配索引。
- 账号管理：管理员可创建系统管理员和房间管理员账号。
- 共享持久化：通过后端 API 保存到 SQLite；无后端时回退到浏览器 `localStorage`。
- 拆表存储：SQLite 内按饲养间、笼架、笼位、占用记录、计费规则、减免和日志分表保存。
- 账号登录：支持系统管理员和房间管理员账号，编辑操作必须登录。
- 操作审计：服务端记录账号、动作、笼位、时间和变更前后数据。

## 本地运行

启动共享模式：

```bash
npm run dev
```

然后访问：

```text
http://localhost:5173
```

SQLite 数据库默认保存在：

```text
data/cageledger.sqlite
```

首次启动会自动创建默认管理员：

```text
用户名：admin
密码：admin123
```

内网长期测试时，建议通过环境变量覆盖默认管理员密码：

```bash
CAGELEDGER_ADMIN_USERNAME=admin CAGELEDGER_ADMIN_PASSWORD=更强的密码 npm run dev
```

如果只想用纯静态模式：

```bash
npm run static
```

## 检查脚本

```bash
npm run check
```

## Docker 部署

群晖上建议使用 Docker Compose。示例目录：

```bash
mkdir -p /volume1/docker/cageledger
cd /volume1/docker/cageledger
git clone https://github.com/Hugo-YH/CageLedger.git .
```

首次部署前，建议修改 `docker-compose.yml` 中的默认管理员密码：

```yaml
CAGELEDGER_ADMIN_PASSWORD=更强的密码
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://群晖IP:5173
```

数据会持久化在宿主机：

```text
./data/cageledger.sqlite
```

建议定期备份 `data/cageledger.sqlite` 和 `data/iacuc-index.json`。

如果需要 IACUC 自动回填，管理员登录系统后可在“数据管理 -> IACUC 索引”上传动物实验申请汇总表 CSV。系统会生成 `data/iacuc-index.json`，该文件随 `./data:/app/data` 挂载持久化。

## 同步 IACUC 汇总表

系统支持管理员在“数据管理”页面上传 CSV 汇总表并生成 IACUC 索引。CSV 必须包含以下列：

- `动物伦理编号`
- `动物实验名称`
- `项目负责人`
- `实验负责人`

上传后索引会保存到：

```text
data/iacuc-index.json
```

如果需要离线生成旧版本地索引，也可以使用脚本：

```bash
python3 scripts/generate_iacuc_index.py /path/to/iacuc-summary.xlsx
```

真实 IACUC 索引包含项目负责人、实验负责人等业务数据，`data/` 和 `src/iacuc-data.local.json` 均已被 Git 忽略，避免提交到远程仓库。

## 后续建议

当前共享模式已经在 SQLite 中拆分为业务表：

- `rooms`
- `racks`
- `cage_slots`
- `occupancies`
- `billing_rules`
- `billing_adjustments`
- `audit_logs`
- `users`
- `sessions`
- `audit_events`

前端读取数据已经通过实体级 GET API 组装状态；笼位占用、批量录入、取材/设空、饲养间/笼架配置和基础计费规则写入也已迁移到实体级 API。`/api/state` 目前保留为兼容、导入导出或调试接口。

- `GET /api/rooms`
- `GET /api/racks`
- `GET /api/cage-slots`
- `GET /api/occupancies`
- `GET /api/billing-rules`
- `GET /api/billing-adjustments`
- `GET /api/audit-events`

写入型实体 API：

- `POST /api/rooms`
- `PUT /api/rooms/{id}`
- `DELETE /api/rooms/{id}`
- `POST /api/racks`
- `PUT /api/racks/{id}`
- `DELETE /api/racks/{id}`
- `POST /api/cage-slots`
- `PUT /api/cage-slots/{id}`
- `DELETE /api/cage-slots/{id}`
- `POST /api/occupancies`
- `PUT /api/occupancies/{id}`
- `DELETE /api/occupancies/{id}`
- `POST /api/billing-rules`
- `PUT /api/billing-rules/{id}`
- `DELETE /api/billing-rules/{id}`
- `POST /api/billing-adjustments`
- `PUT /api/billing-adjustments/{id}`
- `DELETE /api/billing-adjustments/{id}`

这些接口与 `/api/state` 共用同一套权限校验和审计逻辑。管理员可以维护配置、计费规则和减免规则；房间管理员只能修改授权饲养间内的笼位占用信息。删除饲养间、笼架或笼位时，会级联删除下级笼架、笼位和占用记录。

账号相关 API：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/users`
- `POST /api/users`

后续待办：

- 增加独立设置接口，服务端保存 `billingMonth`、`billingIacuc` 等用户界面偏好，避免只保存在浏览器 `localStorage`。
- 补充后端批量 API，减少批量录入、批量取材和批量设空时的多次顺序请求。
- 将减免规则管理 UI 接入 `billing-adjustments` 实体 API。
- 正式长期使用时，迁移到 PostgreSQL。

结算单正式化时建议增加“草稿、确认、导出、作废”状态，并在确认后保存快照，避免历史数据修改影响已确认账单。
