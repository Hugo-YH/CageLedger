# 检疫管理第一版验证记录

验证日期：2026-09-09。测试使用临时 SQLite 与临时文件目录，不修改仓库 `data/`。

## 业务与接口

`tests/test_quarantine.py` 覆盖 16 项领域回归：幂等迁移、覆盖来源快照、并发版本冲突、混样异常、按供应商复检、大小鼠项目适用范围、上传人记录、报告出具失败重试、更正历史、供应商统计、备份恢复和原模板结构。

`tests/e2e/quarantine.spec.ts` 的 7 项浏览器回归通过，覆盖页面录入与附件上传、未登录拒绝访问、普通登录用户权限、实际 API 冲突、Word 下载和 SQLite 审计记录。

## 页面与兼容性

测试视口为 1440×900、1180×900、760×900、844×390、390×844，最后一档启用触屏。每档均启用减少动画，并禁用 `crypto.randomUUID` 验证普通 HTTP 环境的编号回退。

每档均验证来源选择浮层可见、键盘选择可用、页面无横向溢出，并将 `section[data-feature="quarantine"]` 的实际 `display`、`minWidth`、`gap` 和页面溢出结果写入 Playwright 的 `computed-style` 附件。截图保存在各自 `test-results/quarantine-*/quarantine.png`，桌面与手机截图另经人工查看。

验证环境为 Chromium 及视口、触屏模拟，未在实体手机或其他浏览器引擎上执行。

## Word 原模板与分页

五份用户原表经移除示例内容后保存在 `server_app/resources/quarantine/templates/`，来源文件名和校验值见 `manifest.json`。生成器直接填充原表，保留原始样式、页面设置、页眉、横向样本表、图片区、结果表和空白签名栏。

使用长中文来源、10 个样本和多图片分别生成寄生虫、小鼠 ELISA、大鼠 ELISA、PCR 报告；另用 6 个样本验证另一份 PCR 模板。通过 LibreOffice 渲染全部页面，检查跨页表格、样本编号、图片对应关系、草稿标记和签名栏。修正了相邻结果表自动合并导致的错误重复表头，以及签名栏单独落页。

本地渲染证据位于 `/tmp/cageledger-quarantine-qa/`：`final-check-parasite`、`final-check-elisa_mouse`、`final-check-elisa_rat`、`final-check-pcr-small` 和最终 PCR 的 `closing-pcr`。这些是临时验证产物，不包含生产检测记录。Microsoft Word 桌面版未实机打开验证。

## 其他验证

生产前端构建、9 项 API 冒烟检查、隔离数据下的现有查询基准检查通过。完整项目门禁使用 `npm run check`；交付前另执行 `git diff --check`。

本次未提交、推送、发布或调整系统版本。

## 2026-09-10 接收池与整批完成补充

增加 `tests/test_quarantine_workflow.py` 的 7 项回归：仅已接收进入池子、重复归批拦截、未采样动物随覆盖批次完成、三类方法与大小鼠要求、并发及登录校验、异常分供应商阴性复检、更正重新打开和历史保留。接收状态不被检疫状态覆盖，SQLite 原到货 payload 保持不变。

`tests/e2e/quarantine.spec.ts` 与 `tests/e2e/intake.spec.ts` 共 15 项浏览器回归通过。真实 API 完成“登记到货 → 标记打印 → 确认接收 → 池中勾选两批 → 仅从一批抽样 → 三类报告出具 → 人工确认 → 两批均已检疫 → 接收列表查看三份报告”，并核对审计事件。`npm run check`、9 项 API 冒烟和 `git diff --check` 通过。

UI 仍由 `src/styles/features/quarantine.css` 唯一管理，使用 `data-feature="quarantine"`；报告下载按钮在窄屏下自动换行。五档视口均保存 `pool.png`、`quarantine.png` 和 `pool-computed-style` 附件，验证页面无横向溢出、空池的禁用状态、选择浮层及键盘操作；桌面与手机截图经人工查看。完成后接收列表报告弹窗证据为 `test-results/quarantine-received-animal-b7fca-ohort-and-manual-completion-chromium/completed-reports-390.png`。本次未改变 Word 排版生成逻辑。

## 2026-09-11 报告表单接入

正式录入页按确认的报告章节填写，ELISA 使用采样信息、试剂盒、样本统计、原始记录、结果表五部分；寄生虫和 PCR 沿用对应原表章节。实验组与原始样本份数由服务端按来源推导，选择器只显示课题组／人员，供应商另列。删除重复的检测结论输入，保留批次人工结论。

新增回归验证去重计数、忽略客户端伪造数量、无额外结论可出具、多项目附件关联、首次上传人和时间保留、附件版本冲突、正式附件拒绝修改、更正移除不改变旧版本。检疫 Python 回归共 25 项通过。五档视口以及接收池到完成的 8 项浏览器测试通过，另新增 ELISA 完整表单测试，验证选择两位人员计两份、四个结果符号、一图关联两个项目、图注保存、鉴权图片加载及正式出具。

Word 使用原模板页眉、样式和章节，长图注时将原有双栏图片区等分以避免右栏挤压，保持原表总宽。结尾说明与签名连续分页。新格式渲染证据在 `/tmp/cageledger-quarantine-qa/form2-final-*` 目录；验证用图片仅为版式测试，不代表真实检测项目结果。实体手机及 Microsoft Word 桌面版仍未实机验证。
