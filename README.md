# CageLedger 实验动物笼位与饲养费核算系统

这是一个从 0 搭建的本地 MVP，直接用浏览器打开 `index.html` 即可运行，不依赖构建工具或后端服务。

## 已实现功能

- 动态笼位图：按饲养间、笼架、行、列生成 IVC 笼位。
- 基础配置：按“饲养间 -> 笼架”树形展示，支持删除饲养间和笼架。
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
- 本地持久化：数据保存在浏览器 `localStorage`。

## 运行方式

启动本地静态服务：

```bash
npm run dev
```

然后访问：

```text
http://localhost:5173
```

## 检查脚本

```bash
npm run check
```

## 同步 IACUC 汇总表

真实 IACUC 索引会生成到 `src/iacuc-data.local.json`，该文件已被 Git 忽略，避免把项目负责人、实验负责人等真实业务数据提交到远程仓库。

如果汇总表更新，可以重新生成前端索引：

```bash
python3 scripts/generate_iacuc_index.py /path/to/iacuc-summary.xlsx
```

## 后续建议

下一步可以把 `src/app.js` 里的数据访问层替换成后端 API，并使用 PostgreSQL 保存：

- `rooms`
- `racks`
- `cage_slots`
- `occupancies`
- `billing_rules`
- `billing_adjustments`
- `billing_statements`
- `billing_daily_details`

结算单正式化时建议增加“草稿、确认、导出、作废”状态，并在确认后保存快照，避免历史数据修改影响已确认账单。
