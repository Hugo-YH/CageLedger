# Ant Design 全系统视觉重构

分支：`codex/antd-visual-system`。以用户确认的 2026-09-19 计划执行，保留业务、权限、API、报告和打印尺寸；不提交、推送或发布。

## 阶段

| 阶段               | 状态 | 证据／待办                                                                                                |
| ------------------ | ---- | --------------------------------------------------------------------------------------------------------- |
| 页面基线           | 完成 | 24 个工作入口桌面基线通过，截图与 computed style 位于 `/tmp/cageledger-antd-baseline`；同数据三轮性能基线 |
| 主题与公共组件     | 完成 | 单一 Ant 配置、生成式 CSS、官方动效；CommandBar 更多及 RowActions；移动导航共享浅深主题                   |
| 代表页面           | 完成 | 待接收、数量录入、ELISA、笼位图、扫码的编辑、筛选、吸顶、权限与异步反馈回归                               |
| 全页面迁移         | 完成 | 24 入口四档截图与样式证据通过；巡检标题及留白、只读文本、手机扫码与表格触控尺寸均已复验                   |
| 外部页面与规则清理 | 完成 | 登录、主页、公开扫码、文档共享主题；公开页面手机浅深主题 AA 检查通过；契约、Skill 与门禁原位更新          |
| 综合验收           | 完成 | 当前代码完整 verify:full 退出码 0；Chromium 168、Firefox 25、WebKit 25 全部通过，零跳过、零重试           |

## 页面清单

| 页面族 | 入口／模式                                 | 重点状态                       |
| ------ | ------------------------------------------ | ------------------------------ |
| 总览   | 运营总览、图表、饲养间摘要                 | 初载、刷新、空数据、失败       |
| 笼卡   | 预约识别、待接收、接收、笼卡编辑           | 编辑、选中、保存、权限         |
| 检疫   | 批次及待检疫池、三种检测、报告、供应商历史 | 列表、编辑、详情、附件、出具   |
| 笼位   | 房间／笼架、框选、预留、入驻               | 无数据、权限、批量选择         |
| 巡检   | 录入、异常、记录、标准／目录               | 表单、图片、历史、异常、权限   |
| 饲养费 | 数量录入／保存、结算、汇总、单据跟踪       | 长表单、批量、明细、冲突、权限 |
| 设置   | 房间、账号、数据、系统、日志               | 默认、编辑、加载、失败、权限   |
| 扫码   | 相机、冻结、多码选择、公开详情             | 识别、错误、重新扫描、减少动画 |
| 外部   | 登录、主页、文档                           | 浅深主题、窄屏、键盘、错误     |

## 验收约定

电脑端是本轮必须完成的范围。Chromium 保留全部现有用例；Firefox／WebKit 使用独立临时库验证桌面页面及关键交互。手机保留已有自动化回归，真机有条件时补验，不作为完成门槛。WebKit 引擎验证不等同真实 Safari 实测。

每类页面验证适用的默认、空、加载、失败、编辑、权限状态。全部入口覆盖桌面、1180、760、手机横屏；代表工作流追加手机竖屏、浅深主题、减少动画、键盘与缩放。真实设备摄像头和软键盘需要标明实测范围。

以隔离数据运行测试。阶段检查集中执行；最终 `npm run verify:full`，最后 `git diff --check`。主题生成文件由 `node scripts/generate_theme.mjs` 更新，检查使用 `--check`，不手工维护第二套颜色或动效。

## 逐页接入记录

以下页面全部消费共享主题，四档宽度为 1440、1180、760、844（横屏高度 390）。表中保留页面既有操作和权限，不新增无业务意义的主按钮。

| 工作入口               | 操作归属与主动作                               | 吸顶与专用布局                 | 状态验收入口                                                    |
| ---------------------- | ---------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| 总览                   | 范围查询、图表与房间摘要                       | 静态；图表懒加载               | dashboard-cages-feedback、dashboard-performance                 |
| 预约消息识别／接收笼卡 | 识别与录入分区；保存为主                       | 编辑栏；表单最大 1200px        | intake、query-reliability、login-navigation                     |
| 待接收批次             | 筛选静态；选择后批量执行                       | 选择栏吸顶；保留列宽和分页     | intake-cages-toolbar、filter-motion、frontend-reliability       |
| 二维码扫描             | 相机、查询、候选选择、继续扫码                 | 专用窗口，不强加顶栏           | scanner-data、scanner-focus、scanner-multi、scanner-reliability |
| 检疫批次               | 待检疫池／批次；新建；行内查看、编辑，更多删除 | 选择吸顶、弹窗页脚保存         | quarantine、quarantine-toolbar                                  |
| 寄生虫检测             | 记录列表、编辑／出具                           | 编辑栏吸顶；原有录入章节       | quarantine-experience、quarantine-workspace                     |
| ELISA检测              | 项目、样本与结果联动；保存／出具               | 编辑栏吸顶；矩阵局部横滚       | quarantine 的 ELISA、附件、版本回归                             |
| PCR检测                | 记录列表、适用样本与结果                       | 编辑栏吸顶；矩阵局部横滚       | quarantine-experience 的 PCR 场景                               |
| 检疫报告／供应商历史   | 查询、报告下载、历史下钻                       | 静态；保留历史和异常归属       | quarantine-experience、quarantine-workspace                     |
| 笼位管理               | 房间、笼架、模式与批量动作                     | 选择／预留吸顶；笼位图专用结构 | intake-cages-toolbar、permissions、scanner-data                 |
| 动物巡检               | 对象与评估分区；提交巡检                       | 编辑栏吸顶；手机纵向录入       | inspection-entry、compatibility                                 |
| 异常处置               | 筛选与处理；详情局部确认                       | 静态筛选；去除重复留白         | settings-inspection-resilience                                  |
| 巡检记录               | 新建；详情／继续录入，更多 PDF                 | 静态筛选；去除重复留白         | settings-inspection-resilience、inspection-catalog              |
| 巡检标准／目录         | 新增／保存；发布为主；更多版本历史             | 目录编辑吸顶                   | inspection-catalog，包含房间管理员只读                          |
| 录入数量统计表         | 新建辅助、保存为主；只读人员改文本             | 编辑栏吸顶；网格横滚           | quantity、quantity-toolbar、visual-system                       |
| 已保存数量统计表       | 预览／编辑；更多删除；批量动作                 | 选择吸顶，翻页保留选择         | quantity、filter-motion                                         |
| 结算管理               | 筛选；导出 PDF/Excel；发起为主；更多撤回       | 批量栏吸顶；长 IACUC 换行      | settlement-candidates、async-feedback                           |
| 单据跟踪               | 查看／登记、授权锁定；更多撤回                 | 静态；保留原因确认和局部表单   | ledger-claims、workflow-actions、async-feedback                 |
| 汇总导出               | 既有范围与导出动作                             | 静态；不加空工具栏             | login-navigation、逐页审计                                      |
| 房间管理               | 新增饲养间；笼架编辑／删除                     | 卡片局部操作、弹窗页脚         | settings-feedback、permissions                                  |
| 账号管理               | 新建；独立账号编辑／保存                       | 卡片局部操作                   | settings-feedback、settings-inspection-resilience               |
| 数据管理               | 导入、导出与身份维护                           | 独立卡片；保留任务防重复       | data-settings-feedback                                          |
| 关于系统               | 刷新；检查更新；更多文档／仓库                 | 独立卡片；显示模式即刻生效     | frontend-reliability、accessibility                             |
| 操作日志               | 查询范围与分页                                 | 静态，只读                     | 逐页审计、登录导航                                              |

登录／门户／公开扫码详情另由 accessibility、project-home、public-scan、scanner-data 验证；文档保留阅读结构，由 documentation 和 VitePress 构建验证。只读页面的编辑／保存状态不适用，不人为增加表单。

## 前轮实施证据（本轮收尾前）

- 基线：`/tmp/cageledger-antd-baseline`；首轮迁移：`/tmp/cageledger-antd-migration`。最终四档 96 份截图和 computed style 位于 `/tmp/cageledger-antd-final-layout`，页面与工作区均无横向溢出；最终巡检标题和间距截图位于 `/tmp/cageledger-antd-resolved`。
- 初次完整验证在 `/tmp/cageledger-antd-verify` 独立工作区执行，排除用户著作权资料、开发数据库和运行时文件；E2E 自建临时 SQLite。未升级依赖、未变更后端、权限、迁移和纸质模板。
- 最终质量检查：53 个 Vitest 文件、352 项测试与 329 项 Python 测试通过；格式、lint、类型、架构、样式归属、UI 契约、Ant CLI 与文档构建通过。Ant CLI doctor/lint 均无警告或错误。
- 已执行 `npm run verify:full`：检查和构建通过，浏览器阶段 158 项通过、1 项重试通过、4 项失败。失败原因分别为旧断点、隔离验证目录残留旧标题、展开按钮尺寸测量及二维码候选按钮旧高度。修复并同步最终文件后，受影响的 21 项浏览器用例全部通过；新增巡检间距用例包含在内。完整浏览器集加新增用例共 164 项已获得通过证据，不将首次失败日志描述为一次全绿。
- 最终日志：`/tmp/cageledger-antd-check-final.log`、`/tmp/cageledger-antd-build-final.log`；完整运行日志 `/tmp/cageledger-antd-final.log`，修复复验 `/tmp/cageledger-antd-resolved.log`。删除数量表 Switch 的旧内部样式覆盖后，6 项数量表吸顶、缩放及主题草稿回归通过，日志为 `/tmp/cageledger-antd-native-switch.log`。
- 专项回归确认：首次骨架与刷新保留控件、失败重试、跨页选择／异步全选作废、主题和动效切换保留草稿、相机冻结／多码选择、错误字段定位与低高度取消吸顶。
- 性能使用同一台机器、相同 24 个检疫批次和三轮浏览器交互。中位数为：首次进入 294→292ms、搜索 53→66ms、保存反馈 442→443ms；对应 API 请求数仍为 1、1、5。未观察到明显回退，也不宣称全系统提速。基线／结果：`/tmp/cageledger-antd-performance/before.json`、`after.json`。
- 浏览器验收使用 Chromium 自动化；相机使用可解码的模拟视频帧。真实 iOS／Android 摄像头、真实软键盘、Safari 和 Firefox 未作设备实测。视口缩放、触屏、软键盘占用高度与减少动画已按模拟场景验证，不能等同于真机覆盖。
- 开发查看地址：`http://localhost:5173/app`。无提交、推送或发布。

## 电脑端收尾验收

状态：完成。2026-09-19 16:52（Asia/Shanghai）完整 `npm run verify:full` 退出码 **0**。这是同一冻结源码状态的一次完整成功，涵盖检查、构建、Chromium 全量和 Firefox／WebKit 桌面专项；未使用分段记录替代。

| 最终检查                                       | 结果                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| 前端单元测试                                   | 53 文件、352 项通过                                                         |
| Python 回归                                    | 329 项通过，含报告／打印相关回归                                            |
| Chromium 全量                                  | 168 项通过，0 失败、0 跳过、0 重试通过                                      |
| Firefox 桌面                                   | 25 项通过，0 失败、0 跳过、0 重试                                           |
| WebKit 桌面                                    | 25 项通过，0 失败、0 跳过、0 重试                                           |
| 格式、lint、类型、UI／样式归属、Ant 检查及构建 | 全部通过；既有架构体量及大分块提示保留，未删改门禁以隐藏提示                |
| 逐页桌面证据                                   | 24 个工作入口 × 3 引擎 × 2 宽度，共 144 组截图和 computed style；全部通过   |
| 工作区核对                                     | 1,017 个文件逐一 SHA-256 一致；验证期间未改代码；最终 git diff --check 通过 |

完整日志：[verify-full.log](/tmp/cageledger-desktop-acceptance/final/verify-full.log)；逐页状态：[page-acceptance.md](/tmp/cageledger-desktop-acceptance/final/page-acceptance.md)；截图与样式路径：[page-acceptance.json](/tmp/cageledger-desktop-acceptance/final/page-acceptance.json)；机器可读结果：[verification-summary.json](/tmp/cageledger-desktop-acceptance/final/verification-summary.json)。最终运行后仅回填本验收文档结果，业务、样式、配置及测试代码均未改变。

本轮修复集中在跨引擎测试夹具、键盘焦点语义、渲染精度和等待条件；没有改动业务逻辑、权限、数据库、报告或打印版式。受影响的 6 项用例分别在 Firefox、WebKit 连续两轮通过后，再执行完整门禁。当前发现的问题均已关闭。

性能取证沿用 24 批次、三轮采样：进入列表、搜索、保存反馈中位数为 321、72、465ms，请求数中位数 1、1、5。首次进入样本为 627ms／2 请求，其余为 321ms／1 请求和 317ms／1 请求；如实保留样本差异，不描述成每轮完全相同，也不宣称全系统提速。本轮未修改性能敏感实现。

- 环境：macOS Darwin 27.0.0 / arm64，Node 22.12.0，Python 3.13.15，Ant Design 6.5.2，Playwright 1.61.1；Chromium 149.0.7827.55、Firefox 151.0、WebKit 26.5。浏览器使用锁定 Playwright 配套安装，未升级依赖。
- 隔离目录：`/tmp/cageledger-desktop-verify`。按当前工作区受版本管理文件和本任务新增文件同步，并逐文件 SHA-256 核对。排除开发数据库、运行时数据、个人资料及旧测试产物。
- 产物索引：`/tmp/cageledger-desktop-acceptance`。`environment.json` 保存环境，`source-manifest.json` 保存代码清单与摘要；`initial` 保留首次跨浏览器失败与页面证据，`resolved`、`resolved-b` 保留修复过程，`final` 保存最终完整运行及三个引擎结果。
- 新增 `test:e2e:compat`，Firefox、WebKit 顺序执行，分别启动临时数据库及服务，单 worker、零重试。已接入 `verify:full` 末尾。Chromium 保持原全量范围，开启 `failOnFlakyTests`，避免重试成功掩盖不稳定用例。
- 页面范围：24 个工作入口和登录、公开主页、公开扫码详情；桌面 1440、1180。跨引擎覆盖公共布局、筛选与浮层、数量保存、ELISA 上传和出具、巡检异常处理、权限、刷新和选择状态；原有 Chromium 手机视口、CDP 缩放和模拟相机用例继续保留。

| 问题                            | 分类与处理                                                                                                       | 验证方式                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Firefox 拒绝显示上传测试图片    | 测试夹具的 PNG IDAT 校验码错误；换成有效 PNG，保留解码、预览、保存及控制台错误断言                               | 上传与报告用例连续两轮           |
| WebKit 弹窗关闭后的焦点断言     | 原测试假设鼠标点击一定聚焦按钮；WebKit 原生行为不保证如此。改为键盘聚焦后 Enter 打开，继续验证 Escape 和焦点恢复 | 可访问性、单据详情连续两轮       |
| WebKit 输入框高度为 31.984375px | 引擎浮点度量；数值验证保留 32/40px 合同，以小于 0.05px 的误差检查                                                | 巡检处置尺寸与失败重试           |
| 确认弹窗入场中点击丢失          | 测试点击发生在 Ant 缩放入场期间；等待真实入场状态结束，再进行鼠标点击并验证关闭                                  | 数量删除、ELISA 删除样本连续两轮 |
| 窗口调整后立即测量溢出          | 等待响应式布局稳定后检查，仍要求页面完全无横向溢出                                                               | 数量保存确认及页面截图           |

WebKit 是引擎自动化验证，不等于真实 Safari 验证；Firefox 为 Playwright 配套浏览器。真实手机摄像头、软键盘、真实浏览器缩放未在本轮新增实测，不能以模拟视频或窗口大小变更替代该结论。开发查看地址沿用 `http://localhost:5173/app`。
