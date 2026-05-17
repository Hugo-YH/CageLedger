const STORAGE_KEY = "cageledger.v1";
const LEGACY_STORAGE_KEY = "lahcas.v1";
const VERSION_REFRESH_KEY = "cageledger.version-refresh";
const CACHE_RESET_NOTICE_KEY = "cageledger.cache-reset-notice";
const MAX_LOCAL_STATE_BYTES = 800_000;
const API_AUTH_ME_URL = "/api/auth/me";
const API_LOGIN_URL = "/api/auth/login";
const API_LOGOUT_URL = "/api/auth/logout";
const API_USERS_URL = "/api/users";
const API_IACUC_INDEX_URL = "/api/iacuc-index";
const API_IACUC_UPLOAD_URL = "/api/iacuc-index/upload";
const API_PRINCIPAL_IDENTITIES_URL = "/api/principal-identities";
const API_SYSTEM_INFO_URL = "/api/system/info";
const API_SYSTEM_UPDATE_URL = "/api/system/update-check";
const API_BOOTSTRAP_URL = "/api/bootstrap";
const API_BILLING_STATEMENT_GENERATE_BY_PI_URL = "/api/billing-statements/generate-by-pi";
const API_BILLING_WORKFLOWS_URL = "/api/billing-workflows";
const API_BILLING_WORKFLOW_ADVANCE_URL = "/api/billing-workflows/advance";
const API_QUANTITY_SHEETS_URL = "/api/quantity-sheets";
const API_INFRASTRUCTURE_URL = "/api/infrastructure";
const ENTITY_API_URLS = {
  rooms: "/api/rooms",
  racks: "/api/racks",
  slots: "/api/cage-slots",
  occupancies: "/api/occupancies",
  billingRules: "/api/billing-rules",
  adjustments: "/api/billing-adjustments",
  intakeBatches: "/api/intake-batches",
  auditLogs: "/api/audit-events",
};
const SYSTEM_RELEASE_NOTES = [
  {
    version: "0.4.9h",
    title: "最新发布版检查",
    items: [
      "系统更新检查改为比较 Gitea 最新 Release，而不是比较 main 分支最新提交",
      "关于系统页面新增最新发布版与发布页入口，减少未发版提交造成的误报",
    ],
  },
  {
    version: "0.4.9g",
    title: "Gitea 镜像构建脚本兼容修正",
    items: [
      "修复 Alpine sh 环境下不支持 Bash 小写转换语法导致的镜像发布失败",
      "继续验证 Gitea Container Registry 的完整构建与推送链路",
    ],
  },
  {
    version: "0.4.9f",
    title: "Gitea 容器发布变量注入验证",
    items: [
      "容器发布工作流改为读取 Gitea Variables 中的 registry 用户名和访问令牌",
      "继续验证 Gitea Container Registry 镜像登录与推送链路",
    ],
  },
  {
    version: "0.4.9e",
    title: "Gitea 容器发布凭据验证",
    items: [
      "容器镜像发布改用专用 PACKAGE_PAT secret 登录 Gitea Container Registry",
      "继续验证 Release 与 Packages 分权后的完整自动发布链",
    ],
  },
  {
    version: "0.4.9d",
    title: "Gitea 发布权限与 Release 脚本修正",
    items: [
      "启用仓库级 Actions token 权限覆盖后重新验证 Gitea Packages 发布能力",
      "修复 Gitea Release 创建流程中的 JSON 解析命令转义问题",
    ],
  },
  {
    version: "0.4.9c",
    title: "Gitea runner 网络修正验证",
    items: [
      "调整 runner 注册链路后再次发布验证版本，确认 job 容器可通过外部域名访问 Gitea",
      "继续验证纯 Gitea 自动发布链在 runner 重注册后的完整执行能力",
    ],
  },
  {
    version: "0.4.9b",
    title: "纯 Gitea 自动发布链验证",
    items: [
      "Gitea 工作流改为直接从私有仓库拉取源码，不再依赖 GitHub Actions Marketplace",
      "离线包与镜像发布任务分别使用原生 Node 和 Docker job 容器，验证纯 Gitea 发布闭环",
    ],
  },
  {
    version: "0.4.9a",
    title: "Gitea 自动发布链验证",
    items: [
      "在 Gitea act runner 上线后发布验证版本，检查标签触发、Release 上传和镜像发布链路",
      "保留 0.4.9 的 Gitea 自动发布迁移内容，用于确认新交付体系已可实际运行",
    ],
  },
  {
    version: "0.4.9",
    title: "Gitea 自动发布链迁移",
    items: [
      "发布工作流迁移到 .gitea/workflows，标签推送后可由 Gitea Actions 接管离线包与镜像发布",
      "默认容器镜像地址切换到 Gitea Container Registry，并移除旧 GitHub 发布工作流",
      "部署文档和用户手册同步改为 Gitea Release、Gitea Actions 与 Gitea 镜像语义",
    ],
  },
  {
    version: "0.4.8",
    title: "私有 Gitea 上游与更新检查迁移",
    items: [
      "项目仓库地址、部署文档和容器默认配置切换到私有 Gitea 上游",
      "系统更新检查从 GitHub API 迁移到 Gitea API，并支持私有仓库只读 token",
      "新增远端检查开关与 Gitea token 环境变量，Compose 部署可通过 .env 直接启用",
      "关于系统页面文案改为中性的远端版本表达，兼容私有化部署语义",
    ],
  },
  {
    version: "0.4.7",
    title: "并发加载与基础设施按需加载优化",
    items: [
      "SQLite 初始化改为服务启动阶段执行，热路径连接只保留轻量 PRAGMA，降低并发访问下的重复 schema 与 WAL 设置开销",
      "IACUC 索引与项目负责人身份改为按页面和按输入场景加载，并增加短时进程内缓存与写后失效机制",
      "基础设施 bootstrap 拆分为 summary、room、full 三种范围，首页只加载汇总，动态笼位图按房间取数，饲养费页面按需升级到完整数据",
      "仪表盘、饲养间与笼架列表改为优先使用汇总统计，减少首屏全量笼位与占用数据传输",
      "修复基础设施汇总改造后前端启动阶段的空白页问题，恢复本地与远端模式首页正常渲染",
    ],
  },
  {
    version: "0.4.6d",
    title: "房间管理员权限入口优化",
    items: [
      "根据 @李志权、@吴玉婷、@苏玉霞 反馈，房间管理员可进入房间管理页面调整授权饲养间下的笼架",
      "关于系统页面开放给所有登录用户查看，便于普通账号查看版本更新、说明文档和部署信息",
      "保留系统管理员专属的数据管理和账号管理入口，饲养间基础信息仍由系统管理员维护",
    ],
  },
  {
    version: "0.4.6c",
    title: "数量统计表保存反馈优化",
    items: [
      "根据 @苏玉霞 建议，数量统计表保存成功后新增站内成功提示，明确显示已保存的结算月份和伦理号",
    ],
  },
  {
    version: "0.4.6b",
    title: "伦理号索引、结算流程与流程中心优化",
    items: [
      "伦理号索引导入改为保留 CSV 原始记录，相同伦理号按原表逐条保存，数量统计表录入优先匹配完整伦理号",
      "修复远程模式下旧本地缓存可能覆盖业务数据的问题，前端仅保留必要界面状态并清理过大的历史缓存",
      "数量统计表新增删除入口，并补充删除统计表的站内确认流程",
      "修复已删除结算流程在旧库迁移逻辑下刷新后重新出现的问题，迁移完成后写入标记避免重复回填",
      "结算流程跟踪表格优化列宽、筛选按钮和操作按钮布局，查看、标记已发送、删除保持同排显示",
    ],
  },
  {
    version: "0.4.6a",
    title: "旧库结算流程迁移修复",
    items: [
      "修复旧版 billing_statements 启动迁移到结算流程表时因外键约束导致服务启动失败的问题",
      "迁移顺序调整为先创建流程主记录，再写入版本、明细和事件，最后回写完整流程快照",
    ],
  },
  {
    version: "0.4.6",
    title: "后端性能、数据结构与系统文档优化",
    items: [
      "SQLite 启用 WAL、外键约束和 busy timeout，并为笼位、占用、数量统计表、结算流程、审计事件等高频查询补充业务索引",
      "前端新增房间、笼架、笼位、当前占用、PI、伦理号、数量统计表和结算流程派生索引，减少笼位图与饲养费计算中的重复全量扫描",
      "后端列表接口新增分页和筛选参数，支持审计日志、待接收批次、数量统计表和结算流程按需加载",
      "占用记录新增 room_id、rack_id、species、billing_item、customer_type、animal_count 等结构化列，并支持旧 SQLite 数据库启动时自动补列和回填",
      "关于系统中的 API 和数据模型、部署说明改为站内页面渲染，支持标题、列表、表格和代码块展示",
    ],
  },
  {
    version: "0.4.5h",
    title: "通知规范、预约识别与账号授权优化",
    items: [
      "笼卡管理保存待接收批次、必填校验、删除确认等操作统一使用站内通知和站内确认弹层",
      "预约消息识别新增进驻日期、入驻日期、到货日期等接收日期别名，并兼容 20250513、2025.5.13、2025/5/13、0513、2026513 等日期格式",
      "系统文档补充前端通知与确认规范，明确 success、warning、error 类型和确认弹层调用方式",
      "账号管理的人员饲养间授权调整为紧凑下拉选择，并优化账号编辑行的登录名、显示姓名、新密码、角色、授权和操作按钮排版",
    ],
  },
  {
    version: "0.4.5g",
    title: "前端版本刷新与缓存防护",
    items: [
      "前端启动时自动比对服务器版本与当前页面版本，发现版本不一致时带版本时间戳重新加载页面",
      "版本重载失败时改用站内通知提示用户刷新，减少浏览器缓存导致新功能不显示的问题",
      "静态资源响应补充 no-cache 兼容头，降低浏览器和中间代理缓存旧入口文件的概率",
    ],
  },
  {
    version: "0.4.5f",
    title: "系统设置导航与站内通知统一",
    items: [
      "系统设置调整为一级菜单，二级管理页改为抽屉式入口，侧栏恢复滚动并优化桌面端浮层展开交互",
      "系统设置抽屉支持进入后自动收起，并统一了笼卡管理与饲养费管理的一级菜单图标",
      "发起结算流程改为页内悬浮成功提示，并将全系统原生提示框统一替换为 success、warning、error 三类站内通知",
      "站内通知新增弹性进入动画、多行文案展示和自动消失规则，后续系统提示统一沿用这套样式",
    ],
  },
  {
    version: "0.4.5e",
    title: "笼卡预览与记录展示整理",
    items: [
      "笼卡批次号中的 IACUC 编号在预览与实际打印中统一显示为红色，保持两端视觉一致",
      "笼卡打印模板整体下移 1.5mm，减少第一页顶部内容落入打印机不可打印区的风险",
      "更新记录统一为“变更条目 + 备注”结构，建议来源改为独立备注行，提升版本说明正式度",
    ],
  },
  {
    version: "0.4.5d",
    title: "笼卡批次号高亮修正",
    items: [
      "笼卡打印模板中批次号里的 IACUC 编号改为红色显示，便于在检疫卡上快速识别伦理编号",
      "补齐笼卡预览弹窗的同名样式规则，确保预览与实际打印的批次号高亮表现一致",
    ],
  },
  {
    version: "0.4.5c",
    title: "笼卡批量打印分页与内切纸对齐修正",
    items: [
      "修复多个待接收批次合并打印时未按每页 14 张强制分页，导致笼卡跨页和后续版面错位的问题",
      "打印模板按公司提供的 A4 内切 14 枚笼卡纸重新校准，调整顶部起点、卡片高度和横纵间距",
      "每 14 张笼卡独立渲染为一张 A4 页面，并设置卡片和页面容器禁止跨页断裂",
    ],
  },
  {
    version: "0.4.5b",
    title: "笼卡管理界面与操作流程优化",
    items: [
      "优化笼卡管理操作区，保存按钮改为主按钮并移除新建入口，支持粘贴、识别、保存后连续录入下一批次",
      "将当前笼卡预览改为弹窗展示，并直接渲染实际打印模板的第一张笼卡，页面主体不再占用大块预览区域",
      "待接收批次列表新增状态筛选和紧凑列宽，购买单位显示简称，批量打印入口移动到列表区域",
      "已保存批次编辑改为独立弹窗，避免编辑动作覆盖上方预约消息识别区",
    ],
    note: "本次 UI 调整根据 @吴玉婷 建议完善。",
  },
  {
    version: "0.4.5a",
    title: "预约识别与笼卡打印细化",
    items: [
      "增强预约消息识别，兼容锐竞/锐竟、采购订单编号、无冒号字段、全角括号、同一行品系数量和 26/5/13 等日期格式",
      "新增供应商简称规则，笼卡打印时将江苏集萃药康、广东药康、上海南模、广东南模、珠海百试通等供应商显示为短名称",
      "优化笼卡打印版式，统一标题、字段标题和字段内容字号层级，购买单位恢复为普通字段字号，仅批次号和饲养周期保留紧凑字号",
      "统一打印日期为短横线格式，接收日期显示为 YYYY-MM-DD，饲养周期显示为紧凑日期范围",
    ],
  },
  {
    version: "0.4.5",
    title: "笼卡管理与接收打印",
    items: [
      "新增笼卡管理一级入口，支持粘贴预约接收消息自动识别批次号、IACUC、供应商、品系、数量、房间和接收日期",
      "新增待接收批次持久化，保存打印张数、状态和笼卡实例编号，支持攒单后勾选批量打印",
      "新增 100mm x 40mm 笼卡打印模板，按 A4 纸 2 x 7 切卡布局输出，并保留接收后两行数量变化空白记录",
      "调整系统一级导航为主页、笼卡管理、笼位管理、饲养费管理、流程中心和系统设置",
    ],
  },
  {
    version: "0.4.4",
    title: "笼位编辑聚焦与猴信息完善",
    items: [
      "饲养间页面新增编辑功能，支持创建后修改所属设施、默认动物、默认收费项目、院内/院外和默认每笼只数",
      "笼位编辑弹层新增遮罩和固定编辑入口，长笼位图下可直接从当前视口进入编辑，并移除顶部重复按钮",
      "猴笼位信息新增性别、出生日期和自动年龄计算，保存后随单笼占用记录一起展示和维护",
      "笼位图单选态新增“当前”标签和更强高亮，多选态继续保留“已选”标签",
    ],
    note: "本轮优化根据 @吴玉婷 与 @纪嘉升 建议完善。",
  },
  {
    version: "0.4.3",
    title: "多设施动物饲养费适配",
    items: [
      "房间管理新增所属设施、默认动物、默认收费项目、院内/院外和默认每笼只数配置",
      "笼位录入和数量统计表按房间计费口径自动切换，支持笼/天与只/天两类饲养费计算",
      "结算预览与后端导出按收费项目分组计价，小鼠保留阶梯和减免规则，其他动物按固定单价计算",
    ],
    note: "本次多设施与动物计费适配根据 @纪嘉升 建议完善。",
  },
  {
    version: "0.4.2a",
    title: "笼位周期管理与首页可视化优化",
    items: [
      "笼位编辑新增“饲养周期（天）”，按开始日期自动计算结束日期",
      "笼位图新增周期状态着色：未填结束日期（淡黄）、正常饲养周期（淡绿）、超期饲养（淡粉）",
      "新进驻录入时增加同伦理号超期占用提示，提示房间与笼位并继续完成录入",
      "首页“笼位状态分布”和“饲养间使用情况”增加周期分类展示，并将房间统计改为同色标签样式与总笼位右侧突出显示",
    ],
  },
  {
    version: "0.4.1b",
    title: "结算流程中心管理优化",
    items: [
      "流程中心新增删除结算流程功能，删除时同步清理版本记录、明细和流程事件并写入操作日志",
      "流程详情弹窗调整为更宽的专用布局，避免汇总信息在窄抽屉中异常换行",
      "流程列表项目负责人列改为直接显示具体伦理号，并调整列宽提升表格可读性",
    ],
  },
  {
    version: "0.4.1a",
    title: "界面交互与伦理号录入优化",
    items: [
      "优化非全尺寸窗口下的导航展示，管理页面统一收纳到齿轮入口和管理抽屉中",
      "流程中心详情默认聚焦流程进度和当前节点，已生成结算单、版本记录和明细改为点击后展开",
      "伦理号输入改为轻量匹配面板，限制候选渲染数量并使用缓存查找，提升自动填充性能和交互体验",
    ],
  },
  {
    version: "0.4.1",
    title: "移动端界面适配",
    items: [
      "移动端导航调整为底部导航栏，管理页面收纳到管理抽屉中",
      "笼位图在移动端改为稳定横向滚动网格，编辑面板改为底部抽屉式展示",
      "优化移动端表单、表格和触控控件尺寸，提升手机查看和轻量操作体验",
    ],
  },
  {
    version: "0.4.0b",
    title: "发布流整理",
    items: [
      "新增本地顺序化发布脚本 release:local，固定按改版本、校验、打包、提交、打标签、推送的顺序执行",
      "精简 set_version 脚本职责，不再自动改 workflow 或插入占位更新记录",
      "收敛 GitHub Actions 触发路径，避免 Release 与 tag push 重复触发容器包发布",
    ],
  },
  {
    version: "0.4.0a",
    title: "版本记录修正与发布对齐",
    items: [
      "补充 v0.4.0a 更新记录，明确本轮结算流程中心、核算界面重构和导航折叠优化内容",
      "将代码提交、应用版本号、GitHub Release 和 Packages 容器包重新对齐到同一发布版本",
      "保留 v0.4.0 的主体功能改动，并以 v0.4.0a 作为严格对应的正式发布版本",
    ],
  },
  {
    version: "0.4.0",
    title: "结算流程中心与核算界面重构",
    items: [
      "新增按项目负责人汇总的结算流程中心，支持结算单状态推进、详情弹窗、版本链和事件记录展示",
      "后端结算模块拆分为 workflow、version、event 结构，为后续邮件、企业微信和催办自动化预留扩展位",
      "重构饲养费核算界面：拆出流程中心、精简动态笼位图结算页、统一数量统计表按钮布局，并新增系统设置折叠分组",
    ],
  },
  {
    version: "0.3.9a",
    title: "笼位图多选录入滚动体验修复",
    items: [
      "修复多选录入操作时页面滚动位置重置导致自动跳到顶部的问题",
      "重渲染时同步保留工作区滚动位置，保证连续编辑体验",
    ],
    note: "该项修改建议由 @吴玉婷 提供。",
  },
  {
    version: "0.3.9",
    title: "结算单财务版式优化",
    items: [
      "结算单调整为更偏财务单据风格，优化顶部信息栏、表格列宽比例和签章留白",
      "单据右上角新增二维码，可扫码访问在线版结算单",
      "按内部流转场景精简字段并重排信息区，形成先分后总的展示结构",
    ],
  },
  {
    version: "0.3.8b",
    title: "数量统计表录入与更新记录展示优化",
    items: [
      "数量统计表录入列顺序调整为新增类型、新增数量、减少类型、减少数量",
      "转入来源伦理号与转出目标伦理号改为与类型同一行内联展示",
      "更新记录中的 @提及按主题色高亮并修复异常换行",
    ],
  },
  {
    version: "0.3.8a",
    title: "数量统计表转移与结算修正",
    items: [
      "数量统计表支持转入/转出按伦理号自动双向同步，目标伦理缺表时自动创建并入账",
      "同日转移优先合并到现有行，避免重复新增行",
      "修复结算预览与导出的笼数滚动计算，优化数量统计表录入交互与布局",
    ],
    note: "转入/转出同步功能根据 @邱素娟 建议优化。",
  },
  {
    version: "0.3.8",
    title: "笼位拖选与结算单打印优化",
    items: [
      "笼位图多选录入支持按住鼠标拖过笼位批量加入或移出选择",
      "结算单 PDF 改为黑白紧凑三线表，按 IACUC 列展示每日笼数、减免和费用",
      "结算单新增唯一单据编号、二维码和扫码查看入口，为分发与报销状态预留接口",
    ],
  },
  {
    version: "0.3.7",
    title: "笼位图与数量统计表界面优化",
    items: [
      "笼位图新增悬浮信息预览，空笼、预约和在用笼位可快速查看位置与占用详情",
      "笼位编辑改为浮在笼位图上方，并根据选中笼位自动避让边界",
      "优化数量统计表表头分组、操作按钮排列和冗余字段展示",
    ],
  },
  {
    version: "0.3.6",
    title: "登录审计记录",
    items: [
      "操作日志新增登录成功记录，便于追溯账号访问时间",
      "登录审计记录包含账号、角色、客户端 IP 和 User-Agent 信息",
      "同步版本号、部署文档、Release、离线包和容器镜像发布配置",
    ],
  },
  {
    version: "0.3.5",
    title: "用户手册完善",
    items: [
      "新增完整用户手册，覆盖角色权限、功能操作、SOP、常见问题和数据安全建议",
      "补充技术栈、项目结构、API 概览、数据表、部署更新和发布流程说明",
      "同步 README 文档入口，便于系统管理页和仓库首页查阅手册",
    ],
  },
  {
    version: "0.3.4",
    title: "权限与界面交互优化",
    items: [
      "房间管理员仅展示并可编辑已授权饲养间，禁止访问未授权房间的笼架和笼位数据",
      "笼位图与房间管理默认预览模式，编辑操作改为点击按钮后弹出编辑窗口",
      "饲养费核算子页改为“动态笼位图（自动）/数量统计表（录入）”，并优化必填提示与删除图标样式",
    ],
  },
  {
    version: "0.3.3",
    title: "房间和笼架管理优化",
    items: [
      "新增饲养间不再自动生成笼架，笼架可按实际编号单独添加、删除和编辑",
      "笼架新增后保留当前表单内容并自动递增编号，便于连续录入同规格笼架",
      "补齐 tag 发布自动化，推送 v* 标签后自动生成 Release、离线包和容器镜像",
    ],
  },
  {
    version: "0.3.2",
    title: "设施结构和窄屏导航修复",
    items: ["设施创建改为批量保存，避免笼位半量写入", "新增笼架编辑和非连续编号支持", "优化窄屏导航栏和退出按钮布局"],
  },
  {
    version: "0.3.1",
    title: "项目负责人汇总计费",
    items: ["按项目负责人汇总多个 IACUC 结算", "新增项目负责人身份管理和 20/10 笼免费额度", "支持阶梯计价、离线包和 Release 自动发布"],
  },
  {
    version: "0.3.0",
    title: "数量统计表结算",
    items: ["新增数量统计表录入与保存", "支持按纸质统计表生成饲养费明细和结算单", "完善表单提示和 IACUC 支撑经费回填"],
  },
  {
    version: "0.2.1",
    title: "离线部署和文档整理",
    items: ["支持 NAS 离线源码包构建", "README 拆分为入口文档、API 文档和部署文档", "补充环境变量模板和 Docker 构建忽略规则"],
  },
  {
    version: "0.2.0",
    title: "共享模式和权限基础",
    items: ["SQLite 拆表存储", "系统管理员和房间管理员账号", "IACUC CSV 上传、审计日志和系统更新检查"],
  },
];
const SYSTEM_WIKI_URL = "https://git.cellnucle.us/hugo/cageledger/wiki";
let IACUC_INDEX = [];
let IACUC_BY_NUMBER = new Map();
let IACUC_SEARCH_CACHE = null;
let IACUC_INDEX_LOADING = false;
let IACUC_INDEX_LOADED = false;
let IACUC_INDEX_PROMISE = null;
let PRINCIPAL_IDENTITIES = [];
let PRINCIPAL_IDENTITY_BY_NAME = new Map();
let iacucIndexMeta = null;
let systemUpdateInfo = null;
let lastRenderedView = "";
let systemInfo = {
  name: "CageLedger",
  title: "CageLedger 实验动物笼位管理与计费系统",
  description: "实验动物笼位管理与计费系统",
  version: "0.4.9h",
  organization: "中山大学中山眼科中心",
  department: "实验动物中心",
  developer: "Hugo",
  contactEmail: "info@cellnucle.us",
  license: "Apache-2.0",
  copyright: "© 2026 中山大学中山眼科中心 实验动物中心. Licensed under Apache-2.0.",
};
let remotePersistence = false;
let currentUser = null;
let users = [];
let batchSlotDrag = null;
let suppressNextSlotClick = false;
let flashNoticeTimer = null;
const lazyDataState = {
  quantitySheetsLoaded: false,
  quantitySheetsLoading: false,
  billingWorkflowsLoaded: false,
  billingWorkflowsLoading: false,
  auditLogsLoaded: false,
  auditLogsLoading: false,
  usersLoaded: false,
  usersLoading: false,
  principalIdentitiesLoaded: false,
  principalIdentitiesLoading: false,
};
const infrastructureLoadState = {
  scope: "full",
  roomId: "",
  loading: false,
};
let STATE_INDEX_CACHE = null;
const MONEY_FORMAT = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const BILLING_PRINCIPAL_PI = "pi";
const BILLING_PRINCIPAL_INDEPENDENT = "independent";
const FREE_CAGES_PI = 20;
const FREE_CAGES_INDEPENDENT = 10;
const FREE_CAGES_DEFAULT = FREE_CAGES_PI;
const IACUC_OPTION_LIMIT = 8;
const BILLING_TIER_LIMIT = 160;
const BILLING_TIER_BASE_PRICE = 4.5;
const BILLING_TIER_OVER_PRICE = 6.5;
const FACILITY_OPTIONS = [
  ["zhujiang", "珠江新城设施"],
  ["bioisland", "生物岛设施"],
];
const SPECIES_OPTIONS = [
  ["mouse", "小鼠"],
  ["rat", "大鼠"],
  ["guinea_pig", "豚鼠"],
  ["rabbit", "兔"],
  ["monkey", "猴"],
  ["dog", "犬"],
  ["pig", "猪"],
];
const BILLING_ITEM_OPTIONS = [
  ["mouse_standard", "小鼠饲养费"],
  ["mouse_diabetic", "糖尿病小鼠饲养费"],
  ["rat_standard", "大鼠饲养费"],
  ["rat_diabetic", "糖尿病大鼠饲养费"],
  ["guinea_pig", "豚鼠饲养费"],
  ["rabbit", "兔饲养费"],
  ["monkey", "猴饲养费"],
  ["pig", "猪饲养费"],
  ["dog", "犬饲养费"],
];
const CUSTOMER_TYPE_OPTIONS = [
  ["internal", "院内"],
  ["external", "院外"],
];
const BILLING_RULES = {
  mouse_standard: { species: "mouse", unit: "cage_day", internalPrice: 4.5, externalPrice: 13.5, tiered: true, freeAllowance: true },
  mouse_diabetic: { species: "mouse", unit: "cage_day", internalPrice: 7.2, externalPrice: 21.6, tiered: false, freeAllowance: false },
  rat_standard: { species: "rat", unit: "cage_day", internalPrice: 8.5, externalPrice: 25.5, tiered: false, freeAllowance: false },
  rat_diabetic: { species: "rat", unit: "cage_day", internalPrice: 14, externalPrice: 42, tiered: false, freeAllowance: false },
  guinea_pig: { species: "guinea_pig", unit: "animal_day", internalPrice: 3, externalPrice: 9, tiered: false, freeAllowance: false },
  rabbit: { species: "rabbit", unit: "animal_day", internalPrice: 5, externalPrice: 15, tiered: false, freeAllowance: false },
  monkey: { species: "monkey", unit: "animal_day", internalPrice: 35, externalPrice: 65, tiered: false, freeAllowance: false },
  pig: { species: "pig", unit: "animal_day", internalPrice: 15, externalPrice: 45, tiered: false, freeAllowance: false },
  dog: { species: "dog", unit: "animal_day", internalPrice: 15, externalPrice: 45, tiered: false, freeAllowance: false },
};

const today = formatLocalDate(new Date());
const INTAKE_STATUS_OPTIONS = [
  ["draft", "待完善"],
  ["pending_print", "待打印"],
  ["printed", "已打印"],
];
const INTAKE_BATCH_FILTER_OPTIONS = [
  ["todo", "未打印"],
  ["all", "全部"],
  ["draft", "待完善"],
  ["pending_print", "待打印"],
  ["printed", "已打印"],
];
const STRAIN_STANDARD_MAP = {
  c57: "C57BL/6J",
  "c57bl/6": "C57BL/6J",
  "c57bl/6j": "C57BL/6J",
  "black 6": "C57BL/6J",
  b6: "C57BL/6J",
  balb: "BALB/c",
  "balb/c": "BALB/c",
  balbc: "BALB/c",
  "balb/cj": "BALB/cJ",
  dba: "DBA/2J",
  "dba/2": "DBA/2J",
  "dba/2j": "DBA/2J",
  icr: "ICR",
  km: "KM",
  kunming: "KM",
  sd: "Sprague Dawley",
  "sprague dawley": "Sprague Dawley",
  "sprague-dawley": "Sprague Dawley",
  wistar: "Wistar",
  lewis: "LEWIS",
};
const SUPPLIER_SHORT_NAME_RULES = [
  [/江苏集萃药康|江苏集萃/, "江苏集萃"],
  [/广东药康/, "广东药康"],
  [/上海(?:南方模式|南模)/, "上海南模"],
  [/广东南模/, "广东南模"],
  [/珠海百试通/, "珠海百试通"],
  [/丹阳昌益/, "丹阳昌益"],
  [/北京维通利华/, "北京维通利华"],
  [/浙江维通利华/, "浙江维通利华"],
  [/上海斯莱克|斯莱克/, "上海斯莱克"],
  [/北京华阜康|华阜康/, "北京华阜康"],
  [/北京百奥赛图|百奥赛图/, "北京百奥赛图"],
];

function makeIncomingBatchDraft() {
  return normalizeIncomingBatchDraft({
    id: crypto.randomUUID(),
    rawMessage: "",
    purchaseOrderNo: "",
    batchNo: "",
    iacuc: "",
    supplier: "",
    species: "mouse",
    strainRaw: "",
    strainStandard: "",
    sex: "",
    quantity: null,
    roomName: "",
    intakeDate: "",
    husbandryDays: null,
    endDate: "",
    project: "",
    pi: "",
    owner: "",
    receiverName: currentUser?.displayName || "",
    vetPhone: "",
    notes: "",
    status: "draft",
    suggestedAnimalsPerCage: 5,
    suggestedCardCount: 0,
    finalCardCount: 0,
    cards: [],
    updatedAt: "",
  });
}

function normalizeIncomingBatchDraft(item = {}) {
  const species = normalizeSpecies(item.species || inferSpecies(item.strainStandard || item.strainRaw || item.rawMessage || ""));
  const quantity = numericOrNull(item.quantity);
  const suggestedAnimalsPerCage = Math.max(numericOrNull(item.suggestedAnimalsPerCage) || defaultAnimalsPerCage(species), 1);
  const husbandryDays = numericOrNull(item.husbandryDays);
  const endDate = normalizeDateInput(item.endDate || "") || autoEndDate(item.intakeDate, husbandryDays);
  const suggestedCardCount = Math.max(numericOrNull(item.suggestedCardCount) || suggestCardCount(quantity, suggestedAnimalsPerCage), 0);
  const finalCardCount = Math.max(numericOrNull(item.finalCardCount) || suggestedCardCount, 0);
  const normalized = {
    id: String(item.id || crypto.randomUUID()),
    rawMessage: String(item.rawMessage || ""),
    purchaseOrderNo: String(item.purchaseOrderNo || "").trim(),
    batchNo: String(item.batchNo || "").trim(),
    iacuc: normalizeIacucNumber(item.iacuc || extractIacucFromBatchNo(item.batchNo || "")),
    supplier: String(item.supplier || "").trim(),
    species,
    strainRaw: String(item.strainRaw || "").trim(),
    strainStandard: standardizeStrainName(item.strainStandard || item.strainRaw || ""),
    sex: String(item.sex || "").trim(),
    quantity,
    roomName: String(item.roomName || "").trim(),
    intakeDate: normalizeFlexibleDate(item.intakeDate || ""),
    husbandryDays,
    endDate,
    project: String(item.project || "").trim(),
    pi: String(item.pi || "").trim(),
    owner: String(item.owner || "").trim(),
    receiverName: String(item.receiverName || currentUser?.displayName || "").trim(),
    vetPhone: String(item.vetPhone || "").trim(),
    notes: String(item.notes || "").trim(),
    status: INTAKE_STATUS_OPTIONS.some(([value]) => value === item.status) ? item.status : "draft",
    suggestedAnimalsPerCage,
    suggestedCardCount,
    finalCardCount,
    cards: [],
    updatedAt: String(item.updatedAt || ""),
  };
  normalized.cards = buildIncomingCards(normalized);
  return normalized;
}

function defaultAnimalsPerCage(species) {
  return species === "rat" ? 4 : 5;
}

function suggestCardCount(quantity, perCage) {
  const animalCount = numericOrNull(quantity);
  if (!animalCount || !perCage) return 0;
  return Math.ceil(animalCount / perCage);
}

function autoEndDate(intakeDate, husbandryDays) {
  const normalizedDate = normalizeFlexibleDate(intakeDate);
  const numericDays = numericOrNull(husbandryDays);
  if (!normalizedDate || !numericDays) return "";
  return addDays(normalizedDate, numericDays);
}

function normalizeFlexibleDate(value) {
  return normalizeFlexibleDateWithYear(value, new Date(`${today}T00:00:00`).getFullYear());
}

function normalizeFlexibleDateWithYear(value, fallbackYear) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const text = raw
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[./年]/g, "-")
    .replace(/[月]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/\s+/g, "");
  const full = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (full) return formatFlexibleDateParts(full[1], full[2], full[3]);
  const short = text.match(/\b(\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (short) return formatFlexibleDateParts(`20${short[1]}`, short[2], short[3]);
  const monthDay = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (monthDay) return formatFlexibleDateParts(fallbackYear, monthDay[1], monthDay[2]);
  const compactFull = text.match(/\b(20\d{2})(\d{4})\b/);
  if (compactFull) return formatFlexibleDateParts(compactFull[1], compactFull[2].slice(0, 2), compactFull[2].slice(2));
  const compactYearMonthDay = text.match(/\b(20\d{2})(\d{3,4})\b/);
  if (compactYearMonthDay) {
    const rest = compactYearMonthDay[2];
    return formatFlexibleDateParts(compactYearMonthDay[1], rest.length === 3 ? rest.slice(0, 1) : rest.slice(0, 2), rest.length === 3 ? rest.slice(1) : rest.slice(2));
  }
  const compactMonthDay = text.match(/\b(\d{3,4})\b/);
  if (compactMonthDay) {
    const rest = compactMonthDay[1];
    return formatFlexibleDateParts(fallbackYear, rest.length === 3 ? rest.slice(0, 1) : rest.slice(0, 2), rest.length === 3 ? rest.slice(1) : rest.slice(2));
  }
  return normalizeDateInput(value);
}

function formatFlexibleDateParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (!Number.isInteger(normalizedYear) || !Number.isInteger(normalizedMonth) || !Number.isInteger(normalizedDay)) return "";
  if (normalizedYear < 2000 || normalizedYear > 2099 || normalizedMonth < 1 || normalizedMonth > 12 || normalizedDay < 1 || normalizedDay > 31) return "";
  const date = new Date(normalizedYear, normalizedMonth - 1, normalizedDay);
  if (date.getFullYear() !== normalizedYear || date.getMonth() !== normalizedMonth - 1 || date.getDate() !== normalizedDay) return "";
  return `${normalizedYear}-${String(normalizedMonth).padStart(2, "0")}-${String(normalizedDay).padStart(2, "0")}`;
}

function inferSpecies(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "mouse";
  if (/豚鼠|guinea/i.test(text)) return "guinea_pig";
  if (/(大鼠|rat|sprague|wistar|lewis|sd)/i.test(text)) return "rat";
  if (/(小鼠|mouse|c57|balb|dba|icr|km|kunming)/i.test(text)) return "mouse";
  return "mouse";
}

function standardizeStrainName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw
    .replace(/[，,].*$/, "")
    .replace(/小鼠|大鼠|豚鼠|动物/g, "")
    .trim();
  if (/^c57bl\/6j?gpt$/i.test(cleaned)) return "C57BL/6JGpt";
  const key = cleaned.toLowerCase().replace(/\s+/g, " ").replace(/[()]/g, "");
  return STRAIN_STANDARD_MAP[key] || STRAIN_STANDARD_MAP[key.replace(/\s*\/\s*/g, "/")] || raw;
}

function abbreviateSupplierName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, "");
  const matched = SUPPLIER_SHORT_NAME_RULES.find(([pattern]) => pattern.test(normalized));
  if (matched) return matched[1];
  return normalized
    .replace(/(?:实验动物养殖|模式生物|生物科技|科技)?(?:股份)?有限公司$/, "")
    .replace(/公司$/, "")
    .trim();
}

function extractIacucFromBatchNo(value) {
  const text = String(value || "");
  const match = text.match(/[（(]([A-Za-z]{1,6}\d{4,})[)）]/);
  return normalizeIacucNumber(match?.[1] || "");
}

function matchField(text, labels) {
  const source = normalizeIncomingText(text);
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*(?:为|是)?\\s*[：:]?\\s*([^\\n\\r]+)`, "i");
    const matched = source.match(pattern);
    if (matched?.[1]) return cleanupFieldValue(matched[1]);
  }
  return "";
}

function normalizeIncomingText(value) {
  return String(value || "")
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\u2005|\u00a0/g, " ")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function cleanupFieldValue(value) {
  return String(value || "")
    .replace(/^[:：，,\s]+/, "")
    .split(/@|谢谢|请审核|请审批|老师/)[0]
    .trim()
    .replace(/[，,。；;]+$/, "")
    .trim();
}

function incomingDateLabels() {
  return ["进驻日期", "拟进驻日期", "预计进驻日期", "入驻日期", "入住日期", "接收日期", "到货日期", "送达日期", "到达日期"];
}

function incomingFieldStopPattern() {
  return /(?:锐竞|锐竟|饲养需求批次号|供应商|品系|数量|饲养房间|进驻日期|拟进驻日期|预计进驻日期|入驻日期|入住日期|接收日期|到货日期|送达日期|到达日期|拟实验时间)\s*(?:为|是)?\s*[:：]?/;
}

function stopAtNextField(value) {
  return cleanupFieldValue(value).split(new RegExp(`\\s*${incomingFieldStopPattern().source}`))[0].trim();
}

function extractPurchaseOrder(text) {
  const source = normalizeIncomingText(text);
  const match = source.match(/锐[竞竟](?:采购)?(?:单号|订单编号|采购订单编号)?\s*(?:为)?\s*:?\s*([A-Z]{0,3}\d{8,})/i);
  return match?.[1]?.trim() || "";
}

function extractBatchNo(text) {
  const source = normalizeIncomingText(text);
  const match = source.match(/饲养需求批次号\s*(?:为)?\s*:?\s*[(]\s*([A-Z]{1,6}\d{4,})\s*[)]\s*(\d{6,})/i);
  return match ? `(${match[1].toUpperCase()})${match[2]}` : "";
}

function extractReferenceYear(batchNo, purchaseOrderNo, rawText) {
  const normalizedBatch = normalizeIncomingText(batchNo);
  const batchSuffixYear = normalizedBatch.match(/[)]\s*(20\d{2})\d{4,}/);
  if (batchSuffixYear) return Number(batchSuffixYear[1]);
  const purchaseYear = String(purchaseOrderNo || "").match(/[A-Z]{0,3}(20\d{2})\d{4,}/i);
  if (purchaseYear) return Number(purchaseYear[1]);
  const source = normalizeIncomingText(rawText);
  const explicitDateYear = source.match(/(20\d{2})\s*(?:[-/.年]\s*)\d{1,2}/);
  if (explicitDateYear) return Number(explicitDateYear[1]);
  return new Date(`${today}T00:00:00`).getFullYear();
}

function extractSupplier(text) {
  const value = matchField(text, ["供应商", "购买单位"]);
  return stopAtNextField(value);
}

function extractStrain(text) {
  const source = normalizeIncomingText(text);
  const match = source.match(new RegExp(`品系\\s*:?\\s*([\\s\\S]*?)(?=\\s*(?:数量|饲养房间|${incomingDateLabels().join("|")}|拟实验时间)\\s*(?:为|是)?\\s*:|[\\n\\r]|$)`, "i"));
  return cleanupFieldValue(match?.[1] || "");
}

function extractQuantity(text) {
  const source = normalizeIncomingText(text);
  const match = source.match(/数量\s*:?\s*(\d+)/);
  return numericOrNull(match?.[1] || "");
}

function extractRoomName(text) {
  const value = matchField(text, ["饲养房间", "房间"]);
  const cleaned = stopAtNextField(value);
  return cleaned.match(/\d{3,4}/)?.[0] || cleaned;
}

function extractIntakeDate(text, referenceYear) {
  const direct = matchField(text, incomingDateLabels());
  const directDate = normalizeFlexibleDateWithYear(direct, referenceYear);
  if (directDate) return directDate;
  const source = normalizeIncomingText(text);
  const applyMatch = source.match(/申请\s*([^，,。\n\r]*?\d{1,2}\s*月\s*\d{1,2}\s*[日号][^，,。\n\r]*?)\s*进(?:鼠|驻)/);
  const applyDate = normalizeFlexibleDateWithYear(applyMatch?.[1] || "", referenceYear);
  if (applyDate) return applyDate;
  return normalizeFlexibleDateWithYear(matchField(text, ["拟实验时间", "实验时间", "预计实验时间"]), referenceYear);
}

function parseIncomingMessage(rawMessage) {
  const raw = String(rawMessage || "").trim();
  if (!raw) return makeIncomingBatchDraft();
  const batchNo = extractBatchNo(raw) || matchField(raw, ["饲养需求批次号", "批次号"]);
  const purchaseOrderNo = extractPurchaseOrder(raw) || matchField(raw, ["锐竞采购单号", "锐竟采购单号", "采购单号", "锐竞单号"]);
  const referenceYear = extractReferenceYear(batchNo, purchaseOrderNo, raw);
  const strainRaw = extractStrain(raw);
  const parsed = normalizeIncomingBatchDraft({
    rawMessage: raw,
    purchaseOrderNo,
    batchNo,
    iacuc: extractIacucFromBatchNo(batchNo),
    supplier: extractSupplier(raw),
    species: matchField(raw, ["物种"]) || inferSpecies(raw + "\n" + strainRaw),
    strainRaw,
    sex: matchField(raw, ["性别"]),
    quantity: extractQuantity(raw),
    roomName: extractRoomName(raw),
    intakeDate: extractIntakeDate(raw, referenceYear),
    husbandryDays: numericOrNull(matchField(raw, ["饲养周期\\(天\\)", "饲养周期（天）", "饲养周期", "周期\\(天\\)", "周期"])),
    receiverName: currentUser?.displayName || "",
  });
  return applyIncomingBatchIacucInfo(parsed);
}

function applyIncomingBatchIacucInfo(batch) {
  const normalized = normalizeIncomingBatchDraft(batch);
  const info = findIacucInfo(normalized.iacuc) || {};
  return normalizeIncomingBatchDraft({
    ...normalized,
    project: normalized.project || info.project || "",
    pi: normalized.pi || info.pi || "",
    owner: normalized.owner || info.owner || "",
  });
}

function buildIncomingCards(batch) {
  const cardCount = Math.max(numericOrNull(batch.finalCardCount) || 0, 0);
  const perCage = Math.max(numericOrNull(batch.suggestedAnimalsPerCage) || defaultAnimalsPerCage(batch.species), 1);
  const quantity = Math.max(numericOrNull(batch.quantity) || 0, 0);
  const remainder = quantity && perCage ? quantity % perCage : 0;
  return Array.from({ length: cardCount }, (_, index) => {
    const isLast = index === cardCount - 1;
    const suggestedQuantity = !quantity ? "" : remainder && isLast ? "" : String(perCage);
    const qrId = [batch.iacuc || "NOIACUC", (batch.intakeDate || "nodate").replaceAll("-", ""), String(index + 1).padStart(2, "0")].join("-");
    return {
      id: `${batch.id}-card-${index + 1}`,
      index: index + 1,
      label: `${index + 1}/${cardCount}`,
      suggestedQuantity,
      qrId,
    };
  });
}

const seedData = {
  activeView: "dashboard",
  selectedRoomId: "room-spf-a",
  selectedRackId: "rack-spf-a-1",
  selectedSlotId: "slot-spf-a-1-1-1",
  selectedSlotIds: [],
  batchMode: false,
  samplingMode: "",
  sidebarCollapsed: false,
  rackFormDraft: {
    roomId: "",
    rows: 5,
    cols: 6,
  },
  showCageEditor: false,
  showRoomForm: false,
  editingRoomId: "",
  showRackForm: false,
  billingSource: "cage_map",
  billingMonth: today.slice(0, 7),
  billingIacuc: "IACUC-2026-001",
  billingPi: "张教授",
  billingPrincipalType: BILLING_PRINCIPAL_PI,
  freeCageAllowance: FREE_CAGES_DEFAULT,
  billingWorkflowFilter: "todo",
  selectedBillingWorkflowId: "",
  selectedBillingWorkflowDetail: null,
  showWorkflowStatements: false,
  settingsNavExpanded: false,
  lastSettingsView: "rooms",
  flashNotice: null,
  confirmDialog: null,
  selectedQuantitySheetId: "",
  quantitySheetDraft: makeQuantitySheetDraft(today.slice(0, 7)),
  quantitySheets: [],
  selectedIntakeBatchId: "",
  selectedIntakeBatchIds: [],
  intakeBatchFilter: "todo",
  intakeBatchDraft: makeIncomingBatchDraft(),
  editingIntakeBatchId: "",
  editingIntakeBatchDraft: null,
  showIntakeCardPreview: false,
  billingWorkflows: [],
  principalIdentityFilter: "",
  slotFilter: "all",
  baseRate: 4.5,
  rooms: [
    {
      id: "room-spf-a",
      name: "SPF 小鼠饲养间 A",
      area: "屏障区",
      facility: "zhujiang",
      defaultSpecies: "mouse",
      defaultBillingItem: "mouse_standard",
      defaultCustomerType: "internal",
      defaultAnimalCount: 1,
      rackCount: 2,
      rows: 5,
      cols: 6,
    },
    {
      id: "room-spf-b",
      name: "SPF 小鼠饲养间 B",
      area: "屏障区",
      facility: "zhujiang",
      defaultSpecies: "mouse",
      defaultBillingItem: "mouse_standard",
      defaultCustomerType: "internal",
      defaultAnimalCount: 1,
      rackCount: 1,
      rows: 4,
      cols: 5,
    },
  ],
  racks: [],
  slots: [],
  occupancies: [
    {
      id: "occ-001",
      slotId: "slot-spf-a-1-1-1",
      cageCode: "M-A001",
      status: "active",
      iacuc: "IACUC-2026-001",
      project: "肿瘤免疫治疗机制研究",
      pi: "张教授",
      owner: "李博士",
      startDate: `${today.slice(0, 7)}-01`,
      endDate: "",
      notes: "雌性 C57BL/6，8 周龄",
      updatedAt: today,
    },
    {
      id: "occ-002",
      slotId: "slot-spf-a-1-1-2",
      cageCode: "M-A002",
      status: "active",
      iacuc: "IACUC-2026-001",
      project: "肿瘤免疫治疗机制研究",
      pi: "张教授",
      owner: "李博士",
      startDate: `${today.slice(0, 7)}-05`,
      endDate: "",
      notes: "同批次扩笼",
      updatedAt: today,
    },
    {
      id: "occ-003",
      slotId: "slot-spf-a-1-2-1",
      cageCode: "M-B017",
      status: "active",
      iacuc: "IACUC-2026-002",
      project: "代谢表型观察",
      pi: "王老师",
      owner: "陈实验师",
      startDate: `${today.slice(0, 7)}-03`,
      endDate: "",
      notes: "高脂饲料组",
      updatedAt: today,
    },
    {
      id: "occ-004",
      slotId: "slot-spf-a-2-1-1",
      cageCode: "RES-009",
      status: "reserved",
      iacuc: "IACUC-2026-003",
      project: "行为学预实验",
      pi: "赵老师",
      owner: "周同学",
      startDate: addDays(today, 2),
      endDate: "",
      notes: "预计本周进驻",
      updatedAt: today,
    },
  ],
  auditLogs: [],
  billingRules: [
    {
      id: "rule-base-mouse",
      name: "小鼠 IVC 基础饲养费",
      unit: "cage_day",
      price: 4.5,
      effectiveStart: "2026-01-01",
      effectiveEnd: "",
    },
  ],
  adjustments: [],
  intakeBatches: [],
};

let state = structuredClone(seedData);
state = normalize(state);

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return structuredClone(seedData);
  if (raw.length > MAX_LOCAL_STATE_BYTES) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return structuredClone(seedData);
  }

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return structuredClone(seedData);
  }
}

function saveState() {
  invalidateIacucSearchCache();
  invalidateStateIndexCache();
  const payload = remotePersistence ? localUiStateSnapshot() : { ...state };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, flashNotice: null, confirmDialog: null }));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

function localUiStateSnapshot() {
  return localUiOnlyState(state);
}

function buildBootstrapUrl(scope = "summary", roomId = "") {
  const url = new URL(API_BOOTSTRAP_URL, window.location.origin);
  url.searchParams.set("scope", scope);
  if (roomId) url.searchParams.set("roomId", roomId);
  return `${url.pathname}${url.search}`;
}

async function loadPersistedState() {
  try {
    remotePersistence = true;
    const entityState = await loadBootstrapState();
    state = normalize(entityState);
    state.quantitySheetDraft = hydrateQuantitySheetIacucInfo(state.quantitySheetDraft);
    invalidateIacucSearchCache();
    invalidateStateIndexCache();
    lazyDataState.quantitySheetsLoaded = false;
    lazyDataState.quantitySheetsLoading = false;
    lazyDataState.billingWorkflowsLoaded = false;
    lazyDataState.billingWorkflowsLoading = false;
    lazyDataState.auditLogsLoaded = false;
    lazyDataState.auditLogsLoading = false;
    lazyDataState.usersLoaded = false;
    lazyDataState.usersLoading = false;
    lazyDataState.principalIdentitiesLoaded = false;
    lazyDataState.principalIdentitiesLoading = false;
    infrastructureLoadState.scope = "summary";
    infrastructureLoadState.roomId = "";
    infrastructureLoadState.loading = false;
    selectFirstAvailableCage();
    return;
  } catch (error) {
    console.error(error);
    if (currentUser) {
      remotePersistence = true;
      const localState = loadState();
      state = normalize({
        ...structuredClone(seedData),
        ...localUiOnlyState(localState),
        flashNotice: {
          type: "warning",
          title: "数据加载失败",
          message: "未能完整加载服务器数据，请刷新页面或检查网络连接。",
        },
      });
      invalidateIacucSearchCache();
      invalidateStateIndexCache();
      lazyDataState.quantitySheetsLoaded = false;
      lazyDataState.quantitySheetsLoading = false;
      lazyDataState.billingWorkflowsLoaded = false;
      lazyDataState.billingWorkflowsLoading = false;
      lazyDataState.auditLogsLoaded = false;
      lazyDataState.auditLogsLoading = false;
      lazyDataState.usersLoaded = false;
      lazyDataState.usersLoading = false;
      lazyDataState.principalIdentitiesLoaded = false;
      lazyDataState.principalIdentitiesLoading = false;
      infrastructureLoadState.scope = "summary";
      infrastructureLoadState.roomId = "";
      infrastructureLoadState.loading = false;
      return;
    }
    remotePersistence = false;
  }

  state = normalize(loadState());
  state.quantitySheetDraft = hydrateQuantitySheetIacucInfo(state.quantitySheetDraft);
  invalidateIacucSearchCache();
  invalidateStateIndexCache();
  lazyDataState.quantitySheetsLoaded = true;
  lazyDataState.quantitySheetsLoading = false;
  lazyDataState.billingWorkflowsLoaded = true;
  lazyDataState.billingWorkflowsLoading = false;
  lazyDataState.auditLogsLoaded = true;
  lazyDataState.auditLogsLoading = false;
  lazyDataState.usersLoaded = true;
  lazyDataState.usersLoading = false;
  lazyDataState.principalIdentitiesLoaded = true;
  lazyDataState.principalIdentitiesLoading = false;
  infrastructureLoadState.scope = "full";
  infrastructureLoadState.roomId = "";
  infrastructureLoadState.loading = false;
}

async function loadBootstrapState() {
  const startedAt = performance.now();
  const localState = loadState();
  const response = await fetch(buildBootstrapUrl("summary"), { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${API_BOOTSTRAP_URL}`);
  const entityData = await response.json();

  const billingRules = entityData.billingRules || [];
  const intakeBatches = entityData.intakeBatches || [];
  const selectedIntakeBatch = intakeBatches.find((item) => item.id === localState.selectedIntakeBatchId) || intakeBatches[0];

  const nextState = {
    ...structuredClone(seedData),
    activeView: localState.activeView || seedData.activeView,
    selectedRoomId: localState.selectedRoomId || "",
    selectedRackId: localState.selectedRackId || "",
    selectedSlotId: localState.selectedSlotId || "",
    billingSource: localState.billingSource || seedData.billingSource,
    billingMonth: localState.billingMonth || today.slice(0, 7),
    billingIacuc: localState.billingIacuc || "",
    billingPi: localState.billingPi || "",
    billingPrincipalType: principalTypeForPi(localState.billingPi || ""),
    freeCageAllowance: Number(localState.freeCageAllowance ?? seedData.freeCageAllowance),
    billingWorkflowFilter: localState.billingWorkflowFilter || "todo",
    selectedBillingWorkflowId: "",
    selectedBillingWorkflowDetail: null,
    showWorkflowStatements: false,
    selectedQuantitySheetId: "",
    quantitySheetDraft: makeQuantitySheetDraft(localState.billingMonth || today.slice(0, 7)),
    quantitySheets: [],
    selectedIntakeBatchId: selectedIntakeBatch?.id || "",
    selectedIntakeBatchIds: Array.isArray(localState.selectedIntakeBatchIds)
      ? localState.selectedIntakeBatchIds.filter((id) => intakeBatches.some((item) => item.id === id))
      : [],
    intakeBatchDraft: selectedIntakeBatch || makeIncomingBatchDraft(),
    intakeBatches,
    billingWorkflows: [],
    principalIdentityFilter: localState.principalIdentityFilter || "",
    slotFilter: localState.slotFilter || "all",
    baseRate: Number(billingRules.find((item) => item.unit === "cage_day")?.price ?? localState.baseRate ?? seedData.baseRate),
    rooms: entityData.rooms || [],
    racks: entityData.racks || [],
    slots: entityData.slots || [],
    occupancies: entityData.occupancies || [],
    roomSummaries: entityData.roomSummaries || [],
    rackSummaries: entityData.rackSummaries || [],
    dashboardSummary: entityData.dashboardSummary || null,
    billingRules,
    adjustments: entityData.adjustments || [],
    auditLogs: [],
  };
  logClientPerf("bootstrap.summary", startedAt, { rooms: nextState.rooms.length, racks: nextState.racks.length });
  return nextState;
}

async function loadFullInfrastructure() {
  if (!remotePersistence || infrastructureLoadState.loading) return;
  infrastructureLoadState.loading = true;
  const startedAt = performance.now();
  try {
    const response = await fetch(buildBootstrapUrl("full"), { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      currentUser = null;
      render();
      throw new Error("请先登录");
    }
    if (!response.ok) throw new Error(payload.error || "加载设施数据失败");
    state.slots = payload.slots || [];
    state.occupancies = payload.occupancies || [];
    state.roomSummaries = payload.roomSummaries || state.roomSummaries;
    state.rackSummaries = payload.rackSummaries || state.rackSummaries;
    state.dashboardSummary = payload.dashboardSummary || state.dashboardSummary;
    infrastructureLoadState.scope = "full";
    infrastructureLoadState.roomId = "";
    logClientPerf("bootstrap.full", startedAt, { rooms: state.rooms.length, slots: state.slots.length });
    invalidateIacucSearchCache();
    invalidateStateIndexCache();
    selectFirstAvailableCage();
  } finally {
    infrastructureLoadState.loading = false;
  }
}

async function loadRoomInfrastructure(roomId) {
  if (!remotePersistence || !roomId || infrastructureLoadState.loading) return;
  if (infrastructureLoadState.scope === "full") return;
  if (infrastructureLoadState.scope === "room" && infrastructureLoadState.roomId === roomId) return;
  infrastructureLoadState.loading = true;
  const startedAt = performance.now();
  try {
    const response = await fetch(buildBootstrapUrl("room", roomId), { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      currentUser = null;
      render();
      throw new Error("请先登录");
    }
    if (!response.ok) throw new Error(payload.error || "加载饲养间笼位失败");
    state.slots = payload.slots || [];
    state.occupancies = payload.occupancies || [];
    state.roomSummaries = payload.roomSummaries || state.roomSummaries;
    state.rackSummaries = payload.rackSummaries || state.rackSummaries;
    state.dashboardSummary = payload.dashboardSummary || state.dashboardSummary;
    infrastructureLoadState.scope = "room";
    infrastructureLoadState.roomId = roomId;
    logClientPerf("bootstrap.room", startedAt, { roomId, slots: payload.slots?.length || 0 });
    invalidateIacucSearchCache();
    invalidateStateIndexCache();
    selectFirstAvailableCage();
  } finally {
    infrastructureLoadState.loading = false;
  }
}

function localUiOnlyState(source = {}) {
  return {
    activeView: source.activeView || seedData.activeView,
    lastSettingsView: source.lastSettingsView || "",
    sidebarCollapsed: Boolean(source.sidebarCollapsed),
    settingsNavExpanded: Boolean(source.settingsNavExpanded),
    selectedRoomId: source.selectedRoomId || "",
    selectedRackId: source.selectedRackId || "",
    selectedSlotId: source.selectedSlotId || "",
    selectedSlotIds: Array.isArray(source.selectedSlotIds) ? source.selectedSlotIds.slice(0, 500) : [],
    batchMode: Boolean(source.batchMode),
    slotFilter: source.slotFilter || "all",
    billingSource: source.billingSource || "cage_map",
    billingMonth: source.billingMonth || today.slice(0, 7),
    billingIacuc: source.billingIacuc || "",
    billingPi: source.billingPi || "",
    billingWorkflowFilter: source.billingWorkflowFilter || "todo",
    selectedQuantitySheetId: source.selectedQuantitySheetId || "",
    selectedIntakeBatchId: source.selectedIntakeBatchId || "",
    selectedIntakeBatchIds: Array.isArray(source.selectedIntakeBatchIds) ? source.selectedIntakeBatchIds.slice(0, 200) : [],
    intakeBatchFilter: source.intakeBatchFilter || "todo",
    principalIdentityFilter: source.principalIdentityFilter || "",
  };
}

async function entityRequest(collection, method, item = null, itemId = "") {
  if (!remotePersistence) return { item, auditLogs: [] };

  const baseUrl = ENTITY_API_URLS[collection];
  const url = itemId ? `${baseUrl}/${encodeURIComponent(itemId)}` : baseUrl;
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (method !== "DELETE") options.body = JSON.stringify(item);

  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存失败");
  }
  mergeServerAuditLogs(payload);
  return payload;
}

async function createEntity(collection, item) {
  return entityRequest(collection, "POST", item);
}

async function createInfrastructure(payload) {
  if (!remotePersistence) return { ...payload, auditLogs: [] };

  const response = await fetch(API_INFRASTRUCTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(result.error || "保存失败");
  }
  mergeServerAuditLogs(result);
  return result;
}

async function loadBillingWorkflows() {
  if (!remotePersistence) {
    state.billingWorkflows = [];
    lazyDataState.billingWorkflowsLoaded = true;
    lazyDataState.billingWorkflowsLoading = false;
    return [];
  }
  lazyDataState.billingWorkflowsLoading = true;
  const response = await fetch(API_BILLING_WORKFLOWS_URL, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    lazyDataState.billingWorkflowsLoading = false;
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    lazyDataState.billingWorkflowsLoading = false;
    throw new Error(payload.error || "加载结算流程失败");
  }
  state.billingWorkflows = payload.items || [];
  lazyDataState.billingWorkflowsLoaded = true;
  lazyDataState.billingWorkflowsLoading = false;
  invalidateStateIndexCache();
  return state.billingWorkflows;
}

async function loadQuantitySheets() {
  if (!remotePersistence) {
    lazyDataState.quantitySheetsLoaded = true;
    lazyDataState.quantitySheetsLoading = false;
    return state.quantitySheets;
  }
  lazyDataState.quantitySheetsLoading = true;
  const response = await fetch(API_QUANTITY_SHEETS_URL, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    lazyDataState.quantitySheetsLoading = false;
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    lazyDataState.quantitySheetsLoading = false;
    throw new Error(payload.error || "加载数量统计表失败");
  }
  state.quantitySheets = payload.items || [];
  lazyDataState.quantitySheetsLoaded = true;
  lazyDataState.quantitySheetsLoading = false;
  const selected = state.quantitySheets.find((sheet) => sheet.id === state.selectedQuantitySheetId) || state.quantitySheets[0] || null;
  state.selectedQuantitySheetId = selected?.id || "";
  state.quantitySheetDraft = hydrateQuantitySheetIacucInfo(selected || makeQuantitySheetDraft(state.billingMonth || today.slice(0, 7)));
  if (!state.billingPi && state.quantitySheetDraft.pi) {
    state.billingPi = state.quantitySheetDraft.pi;
    state.billingPrincipalType = principalTypeForPi(state.billingPi);
    state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
  }
  invalidateStateIndexCache();
  return state.quantitySheets;
}

async function refreshQuantitySheet(sheetId) {
  if (!remotePersistence || !sheetId) return null;
  const response = await fetch(`${API_QUANTITY_SHEETS_URL}/${encodeURIComponent(sheetId)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "刷新数量统计表失败");
  }
  if (payload.item) upsertById(state.quantitySheets, payload.item);
  return payload.item || null;
}

async function loadAuditEvents() {
  if (!remotePersistence) {
    lazyDataState.auditLogsLoaded = true;
    lazyDataState.auditLogsLoading = false;
    return state.auditLogs;
  }
  lazyDataState.auditLogsLoading = true;
  const response = await fetch(`${ENTITY_API_URLS.auditLogs}?limit=500`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    lazyDataState.auditLogsLoading = false;
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    lazyDataState.auditLogsLoading = false;
    throw new Error(payload.error || "加载操作日志失败");
  }
  state.auditLogs = payload.items || [];
  lazyDataState.auditLogsLoaded = true;
  lazyDataState.auditLogsLoading = false;
  return state.auditLogs;
}

async function ensureViewDataLoaded(view) {
  const tasks = [];
  if (view === "data" && !IACUC_INDEX_LOADED && !IACUC_INDEX_LOADING) {
    tasks.push(ensureIacucIndexLoaded());
  }
  if (view === "cages" && state.selectedRoomId && infrastructureLoadState.scope !== "full" && infrastructureLoadState.roomId !== state.selectedRoomId) {
    tasks.push(loadRoomInfrastructure(state.selectedRoomId));
  }
  if (view === "billing" && infrastructureLoadState.scope !== "full") {
    tasks.push(loadFullInfrastructure());
  }
  if ((view === "billing" || view === "data") && !lazyDataState.principalIdentitiesLoaded && !lazyDataState.principalIdentitiesLoading) {
    tasks.push(loadPrincipalIdentities());
  }
  if (view === "billing" && !lazyDataState.quantitySheetsLoaded && !lazyDataState.quantitySheetsLoading) {
    tasks.push(loadQuantitySheets());
  }
  if (view === "workflow-center" && !lazyDataState.billingWorkflowsLoaded && !lazyDataState.billingWorkflowsLoading) {
    tasks.push(loadBillingWorkflows());
  }
  if (view === "logs" && !lazyDataState.auditLogsLoaded && !lazyDataState.auditLogsLoading) {
    tasks.push(loadAuditEvents());
  }
  if (view === "users" && !lazyDataState.usersLoaded && !lazyDataState.usersLoading) {
    tasks.push(loadUsers());
  }
  if (!tasks.length) return;
  await Promise.all(tasks);
}

async function advanceBillingWorkflow(workflowId, toStatus) {
  const startedAt = performance.now();
  const response = await fetch(API_BILLING_WORKFLOW_ADVANCE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowId, toStatus }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "更新结算流程失败");
  }
  mergeServerAuditLogs(payload);
  if (payload.workflow) upsertById(state.billingWorkflows, payload.workflow);
  if (state.selectedBillingWorkflowDetail?.workflow?.id === payload.workflow?.id) {
    state.selectedBillingWorkflowDetail.workflow = payload.workflow;
    if (payload.event) {
      state.selectedBillingWorkflowDetail.events = [payload.event, ...(state.selectedBillingWorkflowDetail.events || [])];
    }
  }
  logClientPerf("billing_workflow.advance", startedAt, { workflowId, toStatus });
  return payload.workflow;
}

async function loadBillingWorkflowDetail(workflowId) {
  if (!remotePersistence) return null;
  const response = await fetch(`${API_BILLING_WORKFLOWS_URL}/${encodeURIComponent(workflowId)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "加载流程详情失败");
  }
  state.selectedBillingWorkflowId = workflowId;
  state.selectedBillingWorkflowDetail = payload;
  state.showWorkflowStatements = false;
  if (payload.workflow) upsertById(state.billingWorkflows, payload.workflow);
  return payload;
}

async function deleteBillingWorkflow(workflowId) {
  const response = await fetch(`${API_BILLING_WORKFLOWS_URL}/${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "删除结算流程失败");
  }
  mergeServerAuditLogs(payload);
  state.billingWorkflows = state.billingWorkflows.filter((item) => item.id !== workflowId);
  invalidateStateIndexCache();
  if (state.selectedBillingWorkflowId === workflowId) {
    state.selectedBillingWorkflowId = "";
    state.selectedBillingWorkflowDetail = null;
    state.showWorkflowStatements = false;
  }
  return payload.workflow;
}

async function updateEntity(collection, itemId, item) {
  return entityRequest(collection, "PUT", item, itemId);
}

async function deleteEntityRequest(collection, itemId) {
  return entityRequest(collection, "DELETE", null, itemId);
}

function mergeServerAuditLogs(payload) {
  if (Array.isArray(payload?.auditLogs) && payload.auditLogs.length) {
    state.auditLogs = mergeAuditLogs(payload.auditLogs, state.auditLogs || []);
  }
}

function logClientPerf(label, startedAt, details = {}) {
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
  const detailText = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(`[perf] ${label} ${elapsedMs}ms${detailText ? ` ${detailText}` : ""}`);
}

function reportSaveError(error) {
  showFlashNotice("保存失败", error?.message || "保存失败", "error");
}

function upsertById(items, item) {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
  invalidateStateIndexCache();
}

function upsertPrincipalIdentity(item) {
  const normalized = {
    ...item,
    pi: String(item.pi || "").trim(),
    principalType: normalizePrincipalType(item.principalType),
    freeCageAllowance: freeCageAllowanceForPrincipalType(item.principalType),
  };
  if (!normalized.pi) return;
  const index = PRINCIPAL_IDENTITIES.findIndex((existing) => normalizePersonName(existing.pi) === normalizePersonName(normalized.pi));
  if (index >= 0) {
    PRINCIPAL_IDENTITIES[index] = normalized;
  } else {
    PRINCIPAL_IDENTITIES.push(normalized);
  }
  PRINCIPAL_IDENTITY_BY_NAME = new Map(PRINCIPAL_IDENTITIES.map((item) => [normalizePersonName(item.pi), item]));
}

function normalize(data) {
  const next = { ...structuredClone(seedData), ...data };
  if (next.activeView === "settings") next.activeView = next.lastSettingsView || "rooms";
  next.selectedSlotIds = Array.isArray(next.selectedSlotIds) ? next.selectedSlotIds : [];
  next.quantitySheets = Array.isArray(next.quantitySheets) ? next.quantitySheets : [];
  next.intakeBatches = Array.isArray(next.intakeBatches) ? next.intakeBatches.map(normalizeIncomingBatchDraft) : [];
  next.billingWorkflows = Array.isArray(next.billingWorkflows) ? next.billingWorkflows : [];
  next.settingsNavExpanded = Boolean(next.settingsNavExpanded);
  next.lastSettingsView = ["rooms", "data", "users", "system", "logs"].includes(next.lastSettingsView) ? next.lastSettingsView : "rooms";
  next.flashNotice = next.flashNotice && typeof next.flashNotice === "object"
    ? {
        type: ["success", "warning", "error"].includes(next.flashNotice.type) ? next.flashNotice.type : "success",
        title: String(next.flashNotice.title || ""),
        message: String(next.flashNotice.message || ""),
      }
    : null;
  next.confirmDialog = next.confirmDialog && typeof next.confirmDialog === "object"
    ? {
        type: String(next.confirmDialog.type || ""),
        id: String(next.confirmDialog.id || ""),
        title: String(next.confirmDialog.title || ""),
        message: String(next.confirmDialog.message || ""),
        confirmLabel: String(next.confirmDialog.confirmLabel || "确认"),
        payload: next.confirmDialog.payload && typeof next.confirmDialog.payload === "object" ? next.confirmDialog.payload : {},
      }
    : null;
  next.quantitySheetDraft = normalizeQuantitySheetDraft(next.quantitySheetDraft || makeQuantitySheetDraft(next.billingMonth || today.slice(0, 7)));
  next.billingSource = next.billingSource === "quantity_sheet" ? "quantity_sheet" : "cage_map";
  next.billingPi = next.billingPi || piForIacuc(next.billingIacuc) || next.quantitySheetDraft.pi || "";
  next.billingPrincipalType = principalTypeForPi(next.billingPi);
  next.freeCageAllowance = Number(next.freeCageAllowance ?? FREE_CAGES_DEFAULT);
  next.billingWorkflowFilter = ["todo", "all", "done"].includes(next.billingWorkflowFilter) ? next.billingWorkflowFilter : "todo";
  next.selectedBillingWorkflowId = String(next.selectedBillingWorkflowId || "");
  next.selectedBillingWorkflowDetail = next.selectedBillingWorkflowDetail && typeof next.selectedBillingWorkflowDetail === "object" ? next.selectedBillingWorkflowDetail : null;
  next.showWorkflowStatements = Boolean(next.showWorkflowStatements);
  next.selectedIntakeBatchId = String(next.selectedIntakeBatchId || "");
  next.selectedIntakeBatchIds = Array.isArray(next.selectedIntakeBatchIds) ? next.selectedIntakeBatchIds.filter(Boolean) : [];
  next.intakeBatchFilter = INTAKE_BATCH_FILTER_OPTIONS.some(([value]) => value === next.intakeBatchFilter) ? next.intakeBatchFilter : "todo";
  next.intakeBatchDraft = normalizeIncomingBatchDraft(next.intakeBatchDraft || next.intakeBatches.find((item) => item.id === next.selectedIntakeBatchId) || makeIncomingBatchDraft());
  next.editingIntakeBatchId = String(next.editingIntakeBatchId || "");
  next.editingIntakeBatchDraft = next.editingIntakeBatchDraft ? normalizeIncomingBatchDraft(next.editingIntakeBatchDraft) : null;
  next.showIntakeCardPreview = Boolean(next.showIntakeCardPreview);
  next.principalIdentityFilter = String(next.principalIdentityFilter || "");
  next.batchMode = Boolean(next.batchMode);
  next.showCageEditor = Boolean(next.showCageEditor);
  next.showRoomForm = Boolean(next.showRoomForm);
  next.editingRoomId = next.editingRoomId || "";
  next.showRackForm = Boolean(next.showRackForm);
  next.sidebarCollapsed = Boolean(next.sidebarCollapsed);
  next.samplingMode = next.samplingMode || "";
  next.editingRackId = next.editingRackId || "";
  next.rackFormDraft = normalizeRackFormDraft(next.rackFormDraft);
  next.rooms = Array.isArray(next.rooms) ? next.rooms.map(normalizeRoomDefaults) : [];
  next.roomSummaries = Array.isArray(next.roomSummaries) ? next.roomSummaries.map((item) => ({ ...item })) : [];
  next.rackSummaries = Array.isArray(next.rackSummaries) ? next.rackSummaries.map((item) => ({ ...item })) : [];
  next.dashboardSummary = next.dashboardSummary && typeof next.dashboardSummary === "object" ? { ...next.dashboardSummary } : null;
  next.occupancies = Array.isArray(next.occupancies)
    ? next.occupancies.map((item) => ({
        ...item,
        animalCount: numericOrNull(item.animalCount),
        billingItem: normalizeBillingItem(item.billingItem || ""),
        customerType: normalizeCustomerType(item.customerType || ""),
        animalSex: normalizeAnimalSex(item.animalSex || ""),
        birthDate: normalizeDateInput(item.birthDate || ""),
      }))
    : [];

  if (!remotePersistence && (!next.racks.length || !next.slots.length)) {
    const generated = generateInfrastructure(next.rooms);
    next.racks = generated.racks;
    next.slots = generated.slots;
  }

  if (!remotePersistence) {
    next.rooms.forEach((room) => {
      const generatedRacks = next.racks.filter((rack) => rack.roomId === room.id);
      if (!generatedRacks.length) {
        const generated = generateInfrastructure([room]);
        next.racks.push(...generated.racks);
        next.slots.push(...generated.slots);
      }
    });
  }

  updateSlotStatuses(next);
  ensureInfrastructureSummaries(next);
  return next;
}

function normalizeRoomDefaults(room) {
  const inferredBillingItem = inferBillingItemFromRoom(room);
  const manualBilling = roomHasManualBillingProfile(room, inferredBillingItem);
  const species = normalizeSpecies(room.defaultSpecies || room.species || BILLING_RULES[inferredBillingItem]?.species || "mouse");
  const billingItem = normalizeBillingItem((manualBilling ? room.defaultBillingItem : inferredBillingItem) || room.defaultBillingItem || billingItemForSpecies(species));
  return {
    ...room,
    facility: normalizeFacility(room.facility || "zhujiang"),
    defaultSpecies: normalizeSpecies(BILLING_RULES[billingItem]?.species || species),
    defaultBillingItem: billingItem,
    defaultCustomerType: normalizeCustomerType(room.defaultCustomerType || "internal"),
    defaultAnimalCount: Math.max(numericOrZero(room.defaultAnimalCount ?? 1), 1),
    billingProfileConfigured: manualBilling,
    billingProfileConfirmed: Boolean(room.billingProfileConfirmed),
  };
}

function roomHasManualBillingProfile(room = {}, inferredBillingItem = "") {
  if (room.billingProfileConfirmed) return true;
  if (!room.billingProfileConfigured) return false;
  const fallbackMouse =
    (!room.defaultBillingItem || room.defaultBillingItem === "mouse_standard") &&
    (!room.defaultSpecies || room.defaultSpecies === "mouse");
  return !(fallbackMouse && inferredBillingItem && inferredBillingItem !== "mouse_standard");
}

function inferBillingItemFromRoom(room = {}) {
  const text = `${room.name || ""} ${room.area || ""} ${room.defaultSpecies || ""} ${room.species || ""}`;
  if (/糖尿病.*大鼠|大鼠.*糖尿病/.test(text)) return "rat_diabetic";
  if (/糖尿病.*小鼠|小鼠.*糖尿病/.test(text)) return "mouse_diabetic";
  if (/豚鼠/.test(text)) return "guinea_pig";
  if (/大鼠/.test(text)) return "rat_standard";
  if (/兔/.test(text)) return "rabbit";
  if (/猴/.test(text)) return "monkey";
  if (/犬|狗/.test(text)) return "dog";
  if (/猪/.test(text)) return "pig";
  if (/小鼠/.test(text)) return "mouse_standard";
  return "";
}

function normalizeFacility(value) {
  return FACILITY_OPTIONS.some(([key]) => key === value) ? value : "zhujiang";
}

function normalizeSpecies(value) {
  return SPECIES_OPTIONS.some(([key]) => key === value) ? value : "mouse";
}

function normalizeBillingItem(value) {
  return BILLING_RULES[value] ? value : "mouse_standard";
}

function normalizeCustomerType(value) {
  return value === "external" ? "external" : "internal";
}

function normalizeAnimalSex(value) {
  return ["male", "female", "unknown"].includes(value) ? value : "unknown";
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function animalSexLabel(value) {
  return {
    male: "雄",
    female: "雌",
    unknown: "未填写",
  }[normalizeAnimalSex(value)];
}

function billingItemForSpecies(species) {
  return {
    mouse: "mouse_standard",
    rat: "rat_standard",
    guinea_pig: "guinea_pig",
    rabbit: "rabbit",
    monkey: "monkey",
    pig: "pig",
    dog: "dog",
  }[species] || "mouse_standard";
}

function facilityLabel(value) {
  return FACILITY_OPTIONS.find(([key]) => key === value)?.[1] || value || "-";
}

function speciesLabel(value) {
  return SPECIES_OPTIONS.find(([key]) => key === value)?.[1] || value || "-";
}

function billingItemLabel(value) {
  return BILLING_ITEM_OPTIONS.find(([key]) => key === value)?.[1] || value || "-";
}

function customerTypeLabel(value) {
  return normalizeCustomerType(value) === "external" ? "院外" : "院内";
}

function billingUnitLabel(value) {
  if (value === "mixed") return "混合";
  return value === "animal_day" ? "只/天" : "笼/天";
}

function billingPriceLabel(profile) {
  return `¥${MONEY_FORMAT.format(profile.unitPrice)} / ${billingUnitLabel(profile.unit)}`;
}

function billingProfileForRoom(room = {}) {
  const normalized = normalizeRoomDefaults(room);
  const rule = BILLING_RULES[normalized.defaultBillingItem] || BILLING_RULES.mouse_standard;
  const customerType = normalizeCustomerType(normalized.defaultCustomerType);
  return {
    facility: normalized.facility,
    species: rule.species,
    billingItem: normalized.defaultBillingItem,
    customerType,
    unit: rule.unit,
    unitPrice: customerType === "external" ? rule.externalPrice : rule.internalPrice,
    tiered: Boolean(rule.tiered && customerType === "internal"),
    freeAllowance: Boolean(rule.freeAllowance && customerType === "internal"),
    defaultAnimalCount: normalized.defaultAnimalCount,
  };
}

function billingProfileForSlotId(slotId) {
  const slot = stateIndexes().slotById.get(slotId);
  return billingProfileForSlot(slot);
}

function billingProfileForSlot(slot, occupancy = {}) {
  const indexes = stateIndexes();
  const rack = slot ? indexes.rackById.get(slot.rackId) : null;
  const room = rack ? indexes.roomById.get(rack.roomId) : null;
  const base = billingProfileForRoom(room || {});
  const billingItem = normalizeBillingItem(occupancy.billingItem || base.billingItem);
  const customerType = normalizeCustomerType(occupancy.customerType || base.customerType);
  const rule = BILLING_RULES[billingItem] || BILLING_RULES.mouse_standard;
  return {
    ...base,
    species: rule.species,
    billingItem,
    customerType,
    unit: rule.unit,
    unitPrice: customerType === "external" ? rule.externalPrice : rule.internalPrice,
    tiered: Boolean(rule.tiered && customerType === "internal"),
    freeAllowance: Boolean(rule.freeAllowance && customerType === "internal"),
  };
}

function billingProfileForOccupancy(occupancy = {}) {
  const slot = stateIndexes().slotById.get(occupancy.slotId);
  return billingProfileForSlot(slot, occupancy);
}

function occupancyAnimalCount(occupancy, profile) {
  return Math.max(numericOrZero(occupancy?.animalCount ?? profile.defaultAnimalCount ?? 1), 1);
}

function optionList(options, selected) {
  return options.map(([value, label]) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeText(label)}</option>`).join("");
}

function generateInfrastructure(rooms) {
  const racks = [];
  const slots = [];

  rooms.forEach((room) => {
    for (let rackIndex = 1; rackIndex <= Number(room.rackCount); rackIndex += 1) {
      const generated = generateRackInfrastructure(room, rackIndex, Number(room.rows), Number(room.cols));
      racks.push(generated.rack);
      slots.push(...generated.slots);
    }
  });

  return { racks, slots };
}

function generateRackInfrastructure(room, rackIndex, rows, cols, rackId = rackIdFor(room.id, rackIndex)) {
  const rack = {
    id: rackId,
    roomId: room.id,
    name: `${room.name} ${rackCode(rackIndex)} 号笼架`,
    rows: Number(rows),
    cols: Number(cols),
    index: rackIndex,
  };
  const slots = [];
  for (let row = 1; row <= Number(rows); row += 1) {
    for (let col = 1; col <= Number(cols); col += 1) {
      slots.push({
        id: slotIdForRack(rackId, row, col),
        rackId,
        row,
        col,
        code: `${columnLabel(col)}${row}`,
        status: "empty",
      });
    }
  }
  return { rack, slots };
}

function rackIdFor(roomId, rackIndex) {
  const suffix = roomId.replace(/^room-/, "");
  return `rack-${suffix}-${rackIndex}`;
}

function slotIdForRack(rackId, row, col) {
  const suffix = rackId.replace(/^rack-/, "");
  return `slot-${suffix}-${row}-${col}`;
}

function updateSlotStatuses(targetState = state) {
  const currentOccupancyBySlot = new Map();
  targetState.occupancies
    .filter((item) => item.status === "active" || item.status === "reserved")
    .forEach((item) => currentOccupancyBySlot.set(item.slotId, item));

  targetState.slots = targetState.slots.map((slot) => ({
    ...slot,
    status: currentOccupancyBySlot.get(slot.id)?.status ?? "empty",
  }));
  syncInfrastructureSummariesForLoadedState(targetState);
}

function syncInfrastructureSummariesForLoadedState(targetState = state) {
  if (targetState !== state) {
    ensureInfrastructureSummaries(targetState);
    return;
  }
  if (infrastructureLoadState.scope === "full" || !state.roomSummaries.length || !state.dashboardSummary) {
    refreshInfrastructureSummaries();
    return;
  }
  if (infrastructureLoadState.scope !== "room" || !infrastructureLoadState.roomId) return;
  const roomId = infrastructureLoadState.roomId;
  const partial = computeInfrastructureSummaries({
    rooms: state.rooms.filter((room) => room.id === roomId),
    racks: state.racks.filter((rack) => rack.roomId === roomId),
    slots: state.slots,
    occupancies: state.occupancies,
  });
  const previousRoom = roomSummaryById(roomId) || {
    slotCount: 0,
    activeCount: 0,
    reservedCount: 0,
    emptyCount: 0,
    periodOpenCount: 0,
    periodNormalCount: 0,
    periodOverdueCount: 0,
  };
  const nextRoom = partial.roomSummaries[0] || {
    roomId,
    rackCount: 0,
    slotCount: 0,
    activeCount: 0,
    reservedCount: 0,
    emptyCount: 0,
    periodOpenCount: 0,
    periodNormalCount: 0,
    periodOverdueCount: 0,
    occupancyRecordCount: 0,
  };
  const deltas = [
    ["total", "slotCount"],
    ["active", "activeCount"],
    ["reserved", "reservedCount"],
    ["empty", "emptyCount"],
    ["periodOpen", "periodOpenCount"],
    ["periodNormal", "periodNormalCount"],
    ["periodOverdue", "periodOverdueCount"],
  ];
  deltas.forEach(([dashboardKey, roomKey]) => {
    state.dashboardSummary[dashboardKey] = numericOrZero(state.dashboardSummary[dashboardKey]) - numericOrZero(previousRoom[roomKey]) + numericOrZero(nextRoom[roomKey]);
  });
  state.roomSummaries = (state.roomSummaries || []).map((item) => item.roomId === roomId ? nextRoom : item);
  const partialRackMap = new Map(partial.rackSummaries.map((item) => [item.rackId, item]));
  state.rackSummaries = (state.rackSummaries || []).map((item) => partialRackMap.get(item.rackId) || item);
}

function render() {
  const previousView = lastRenderedView;
  const previousScrollY = window.scrollY;
  const previousWorkspaceScrollTop = document.querySelector(".workspace")?.scrollTop ?? 0;
  const shouldPreserveScroll = previousView === state.activeView;
  if (remotePersistence && !currentUser) {
    document.querySelector("#app").innerHTML = renderLoginView();
    bindAuthEvents();
    lastRenderedView = "login";
    return;
  }
  const adminViews = new Set(["data", "users"]);
  if (currentUser?.role !== "admin" && adminViews.has(state.activeView)) {
    state.activeView = "cages";
  }

  saveState();
  document.querySelector("#app").innerHTML = `
    <div class="shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      ${renderSidebar()}
      <main class="workspace">
        ${renderFlashNotice()}
        ${state.activeView === "dashboard" ? renderDashboardView() : ""}
        ${state.activeView === "cages" ? renderCageView() : ""}
        ${state.activeView === "intake" ? renderIntakeBatchView() : ""}
        ${state.activeView === "billing" ? renderBillingView() : ""}
        ${state.activeView === "workflow-center" ? renderWorkflowCenterView() : ""}
        ${state.activeView === "rooms" ? renderRoomManagementView() : ""}
        ${state.activeView === "data" ? renderDataManagementView() : ""}
        ${state.activeView === "system" ? renderSystemManagementView() : ""}
        ${state.activeView === "users" ? renderUserManagementView() : ""}
        ${state.activeView === "logs" ? renderAuditView() : ""}
        ${renderWorkspaceFooter()}
      </main>
      ${renderConfirmDialog()}
    </div>
  `;

  bindEvents();
  lastRenderedView = state.activeView;
  if (shouldPreserveScroll) {
    requestAnimationFrame(() => {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
      window.scrollTo({ top: Math.min(previousScrollY, maxScroll) });
      const workspace = document.querySelector(".workspace");
      if (workspace) {
        const maxWorkspaceScroll = Math.max(workspace.scrollHeight - workspace.clientHeight, 0);
        workspace.scrollTop = Math.min(previousWorkspaceScrollTop, maxWorkspaceScroll);
      }
    });
  }
}

function renderConfirmDialog() {
  if (!state.confirmDialog?.message) return "";
  return `
    <div class="confirm-dialog-backdrop" role="presentation">
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle">
        <div>
          <h2 id="confirmDialogTitle">${escapeText(state.confirmDialog.title || "请确认")}</h2>
          <p>${escapeText(state.confirmDialog.message)}</p>
        </div>
        <div class="confirm-dialog-actions">
          <button class="secondary" type="button" id="cancelConfirmDialog">取消</button>
          <button class="danger-button" type="button" id="confirmDialogAction">${escapeText(state.confirmDialog.confirmLabel || "确认")}</button>
        </div>
      </section>
    </div>
  `;
}

function renderFlashNotice() {
  if (!state.flashNotice?.message) return "";
  return `
    <div class="flash-notice ${state.flashNotice.type || "success"}" role="status" aria-live="polite">
      <strong>${escapeText(state.flashNotice.title || "已完成")}</strong>
      <span>${escapeText(state.flashNotice.message)}</span>
    </div>
  `;
}

function renderSidebar() {
  const businessNavItems = [
    ["dashboard", "主页", "home"],
    ["intake", "笼卡管理", "tag"],
    ["cages", "笼位管理", "grid"],
    ["billing", "饲养费管理", "calculator"],
    ["workflow-center", "流程中心", "refresh"],
  ];
  const settingsNavItems = [
    ...(currentUser
      ? [
          ["rooms", "房间管理", "building"],
          ["system", "关于系统", "settings"],
        ]
      : []),
    ...(currentUser?.role === "admin"
      ? [
          ["data", "数据管理", "database"],
          ["users", "账号管理", "users"],
        ]
      : []),
    ...(currentUser ? [["logs", "操作日志", "receipt"]] : []),
  ];
  const settingsViews = settingsNavItems.map(([view]) => view);
  const settingsActive = settingsViews.includes(state.activeView);
  const settingsNavExpanded = state.settingsNavExpanded;

  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img src="./assets/cageledger-icon.svg" alt="" /></div>
        <div>
          <strong>CageLedger</strong>
          <span>实验动物笼位管理与计费系统</span>
        </div>
      </div>
      <button
        class="nav-toggle"
        id="sidebarToggle"
        type="button"
        title="${state.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}"
        aria-label="${state.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}"
      >
        ${iconSvg(state.sidebarCollapsed ? "chevronRight" : "chevronLeft")}
        <span>${state.sidebarCollapsed ? "展开" : "隐藏导航栏"}</span>
      </button>
      <nav class="nav">
        <div class="nav-group">
          <span class="nav-group-title">业务</span>
          ${businessNavItems
            .map(
              ([view, label, icon]) => `
                <button class="nav-item ${state.activeView === view ? "active" : ""}" data-view="${view}" title="${escapeAttr(pageMeta(view).description)}" aria-label="${escapeAttr(label)}">
                  ${iconSvg(icon)}
                  <span>${label}</span>
                </button>
              `,
            )
            .join("")}
          ${
            settingsNavItems.length
              ? `
                <button class="nav-item nav-item-settings-root ${settingsActive ? "active" : ""} ${settingsNavExpanded ? "expanded" : ""}" id="settingsNavToggle" type="button" title="打开系统设置" aria-label="系统设置" aria-expanded="${settingsNavExpanded ? "true" : "false"}">
                  ${iconSvg("settings")}
                  <span>系统设置</span>
                </button>
              `
              : ""
          }
        </div>
      </nav>
      ${settingsNavItems.length ? renderSettingsDrawer(settingsNavItems, settingsNavExpanded) : ""}
      ${renderSidebarAccount()}
    </aside>
  `;
}

function renderSettingsDrawer(settingsNavItems, expanded) {
  if (!expanded) return "";
  const activeItem = settingsNavItems.find(([view]) => view === state.activeView) || settingsNavItems.find(([view]) => view === state.lastSettingsView) || settingsNavItems[0];
  return `
    <div class="settings-drawer ${isCompactViewport() ? "settings-drawer-mobile" : "settings-drawer-desktop"}">
      <div class="settings-drawer-head">
        <strong>系统设置</strong>
        <span>当前页面：${escapeText(activeItem?.[1] || "房间管理")}</span>
      </div>
      <div class="settings-drawer-grid">
        ${settingsNavItems
          .map(
            ([view, label, icon]) => `
              <button class="settings-drawer-item ${state.activeView === view ? "active" : ""}" data-view="${view}" title="${escapeAttr(pageMeta(view).description)}" aria-label="${escapeAttr(label)}">
                ${iconSvg(icon)}
                <span>${label}</span>
                <small>${escapeText(pageMeta(view).description)}</small>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderLoginView() {
  return `
    <main class="login-page">
      <section class="login-card">
        <div class="brand login-brand">
          <div class="brand-mark"><img src="./assets/cageledger-icon.svg" alt="" /></div>
          <div>
            <strong>CageLedger</strong>
            <span>实验动物笼位管理与计费系统</span>
          </div>
        </div>
        <form id="loginForm" class="form">
          <label>
            用户名
            <input name="username" autocomplete="username" placeholder="请输入用户名" required />
          </label>
          <label>
            密码
            <input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required />
          </label>
          <p class="login-error" id="loginError"></p>
          <button class="primary" type="submit">${iconSvg("save")}登录</button>
        </form>
        ${renderVersionMeta("login-version")}
      </section>
    </main>
  `;
}

function pageMeta(view) {
  return {
    cages: {
      title: "笼位管理",
      description: "按饲养间和笼架查看、录入和维护笼位占用。",
    },
    billing: {
      title: "饲养费管理",
      description: "按项目负责人和月份汇总多个 IACUC 的饲养费用。",
    },
    intake: {
      title: "笼卡管理",
      description: "解析预约接收消息、保存待接收批次并批量打印笼卡。",
    },
    "workflow-center": {
      title: "流程中心",
      description: "跟踪结算单发送、签回、交财务和修订版本。",
    },
    rooms: {
      title: "房间管理",
      description: "维护饲养间、笼架和笼位基础结构。",
    },
    data: {
      title: "数据管理",
      description: "维护 IACUC 索引和外部数据源。",
    },
    system: {
      title: "关于系统",
      description: "查看系统版本、更新状态、更新记录和系统 Wiki。",
    },
    users: {
      title: "账号管理",
      description: "维护系统管理员和房间管理员账号。",
    },
    logs: {
      title: "操作日志",
      description: "查看系统写入操作和审计记录。",
    },
  }[view] || {
    title: "CageLedger",
    description: "实验动物笼位管理与计费系统。",
  };
}

function renderSidebarAccount() {
  if (!currentUser) {
    return `
      <div class="sidebar-account">
        <span>运行模式</span>
        <strong>静态模式</strong>
        <small>${state.rooms.length} 个饲养间</small>
        ${renderVersionMeta("sidebar-version")}
      </div>
    `;
  }

  return `
    <div class="sidebar-account">
      <span>当前账号</span>
      <strong title="${escapeAttr(currentUser.displayName)}">${escapeText(currentUser.displayName)}</strong>
      <small>${currentUser.role === "admin" ? "管理员" : "房间管理员"} · ${state.rooms.length} 个饲养间</small>
      <button id="logoutButton" class="secondary logout-button" type="button" title="退出登录" aria-label="退出登录">
        ${iconSvg("logout")}
        <span>退出</span>
      </button>
      ${renderVersionMeta("sidebar-version")}
    </div>
  `;
}

function renderWorkspaceFooter() {
  return `
    <footer class="workspace-footer">
      ${renderVersionMeta("workspace-version")}
    </footer>
  `;
}

function renderVersionMeta(className) {
  const version = systemInfo.version ? `v${systemInfo.version}` : "版本未设置";
  return `
    <div class="version-meta ${className}">
      <span>${escapeText(systemInfo.name || "CageLedger")} ${escapeText(version)}</span>
      <small>${escapeText([systemInfo.organization, systemInfo.department].filter(Boolean).join(" · "))}</small>
      <small>${escapeText(systemInfo.copyright || "")}</small>
    </div>
  `;
}

function metric(label, value, tone) {
  return `
    <div class="metric ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function computeInfrastructureSummaries(source = state) {
  const roomSummaries = new Map((source.rooms || []).map((room) => [room.id, {
    roomId: room.id,
    rackCount: 0,
    slotCount: 0,
    activeCount: 0,
    reservedCount: 0,
    emptyCount: 0,
    periodOpenCount: 0,
    periodNormalCount: 0,
    periodOverdueCount: 0,
    occupancyRecordCount: 0,
  }]));
  const rackSummaries = new Map((source.racks || []).map((rack) => [rack.id, {
    rackId: rack.id,
    roomId: rack.roomId,
    slotCount: 0,
    activeCount: 0,
    reservedCount: 0,
    emptyCount: 0,
    periodOpenCount: 0,
    periodNormalCount: 0,
    periodOverdueCount: 0,
    occupancyRecordCount: 0,
  }]));
  const rackById = new Map((source.racks || []).map((rack) => [rack.id, rack]));
  const slotById = new Map((source.slots || []).map((slot) => [slot.id, slot]));
  const currentBySlot = new Map();
  (source.occupancies || []).forEach((item) => {
    if ((item.status === "active" || item.status === "reserved") && item.slotId) currentBySlot.set(item.slotId, item);
    const slot = slotById.get(item.slotId);
    const rackId = item.rackId || slot?.rackId || "";
    const roomId = item.roomId || rackById.get(rackId)?.roomId || "";
    if (rackSummaries.has(rackId)) rackSummaries.get(rackId).occupancyRecordCount += 1;
    if (roomSummaries.has(roomId)) roomSummaries.get(roomId).occupancyRecordCount += 1;
  });
  const dashboardSummary = { total: 0, active: 0, reserved: 0, empty: 0, periodOpen: 0, periodNormal: 0, periodOverdue: 0 };
  (source.racks || []).forEach((rack) => {
    if (roomSummaries.has(rack.roomId)) roomSummaries.get(rack.roomId).rackCount += 1;
  });
  (source.slots || []).forEach((slot) => {
    const rackSummary = rackSummaries.get(slot.rackId);
    const roomId = rackById.get(slot.rackId)?.roomId || "";
    const roomSummary = roomSummaries.get(roomId);
    const occupancy = currentBySlot.get(slot.id);
    const tone = occupancyPeriodTone(occupancy);
    dashboardSummary.total += 1;
    if (rackSummary) rackSummary.slotCount += 1;
    if (roomSummary) roomSummary.slotCount += 1;
    if (slot.status === "active") {
      dashboardSummary.active += 1;
      if (rackSummary) rackSummary.activeCount += 1;
      if (roomSummary) roomSummary.activeCount += 1;
    } else if (slot.status === "reserved") {
      dashboardSummary.reserved += 1;
      if (rackSummary) rackSummary.reservedCount += 1;
      if (roomSummary) roomSummary.reservedCount += 1;
    } else {
      dashboardSummary.empty += 1;
      if (rackSummary) rackSummary.emptyCount += 1;
      if (roomSummary) roomSummary.emptyCount += 1;
    }
    if (tone === "open") {
      dashboardSummary.periodOpen += 1;
      if (rackSummary) rackSummary.periodOpenCount += 1;
      if (roomSummary) roomSummary.periodOpenCount += 1;
    } else if (tone === "normal") {
      dashboardSummary.periodNormal += 1;
      if (rackSummary) rackSummary.periodNormalCount += 1;
      if (roomSummary) roomSummary.periodNormalCount += 1;
    } else if (tone === "overdue") {
      dashboardSummary.periodOverdue += 1;
      if (rackSummary) rackSummary.periodOverdueCount += 1;
      if (roomSummary) roomSummary.periodOverdueCount += 1;
    }
  });
  return {
    roomSummaries: [...roomSummaries.values()],
    rackSummaries: [...rackSummaries.values()],
    dashboardSummary,
  };
}

function ensureInfrastructureSummaries(targetState = state) {
  if (targetState.dashboardSummary && targetState.roomSummaries?.length && targetState.rackSummaries?.length) return;
  Object.assign(targetState, computeInfrastructureSummaries(targetState));
}

function refreshInfrastructureSummaries() {
  Object.assign(state, computeInfrastructureSummaries(state));
}

async function reloadInfrastructureOverview() {
  if (!remotePersistence) {
    await reloadInfrastructureOverview();
    return;
  }
  const response = await fetch(buildBootstrapUrl("summary"), { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) throw new Error(payload.error || "刷新设施概览失败");
  state.roomSummaries = payload.roomSummaries || [];
  state.rackSummaries = payload.rackSummaries || [];
  state.dashboardSummary = payload.dashboardSummary || null;
}

function roomSummaryById(roomId) {
  return (state.roomSummaries || []).find((item) => item.roomId === roomId) || null;
}

function rackSummaryById(rackId) {
  return (state.rackSummaries || []).find((item) => item.rackId === rackId) || null;
}

function renderDashboardView() {
  const counts = slotStatusCounts();
  const occupied = counts.active + counts.reserved;
  const activePct = percent(counts.active, counts.total);
  const reservedPct = percent(counts.reserved, counts.total);
  const emptyPct = percent(counts.empty, counts.total);
  const occupiedPct = percent(occupied, counts.total);
  const periodTotal = counts.periodOpen + counts.periodNormal + counts.periodOverdue;
  const periodOpenPct = percent(counts.periodOpen, periodTotal);
  const periodNormalPct = percent(counts.periodNormal, periodTotal);
  const periodOverduePct = percent(counts.periodOverdue, periodTotal);

  return `
    <section class="dashboard-view">
      <div class="dashboard-hero">
        <div>
          <span class="dashboard-kicker">CageLedger · CL</span>
          <h1>实验动物笼位管理与计费系统</h1>
          <p>以笼位占用时间线作为计费依据，集中管理笼位状态、IACUC 项目归属和饲养费核算。</p>
        </div>
        <div class="dashboard-hero-stat">
          <span>总笼位</span>
          <strong>${counts.total}</strong>
          <small>${state.rooms.length} 个饲养间 · ${state.racks.length} 个笼架</small>
        </div>
      </div>

      <div class="dashboard-metrics">
        ${metric("总笼位", counts.total, "neutral")}
        ${metric("在用", counts.active, "active")}
        ${metric("已预约", counts.reserved, "reserved")}
        ${metric("空", counts.empty, "empty")}
        ${metric("未填结束", counts.periodOpen, "empty")}
        ${metric("正常周期", counts.periodNormal, "active")}
        ${metric("超期饲养", counts.periodOverdue, "reserved")}
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-head compact">
            <div>
              <h2>笼位状态分布</h2>
              <p>同时展示笼位状态和饲养周期分类，便于快速识别超期风险。</p>
            </div>
          </div>
          <div class="status-chart">
            <div
              class="donut-chart"
              style="--active:${activePct}; --reserved:${reservedPct}; --empty:${emptyPct};"
              aria-label="笼位状态分布图"
            >
              <span>${occupiedPct}%</span>
              <small>占用/预约</small>
            </div>
            <div class="chart-legend">
              ${chartLegend("active", "在用", counts.active, activePct)}
              ${chartLegend("reserved", "已预约", counts.reserved, reservedPct)}
              ${chartLegend("empty", "空", counts.empty, emptyPct)}
              ${chartLegend("period-open", "未填结束日期", counts.periodOpen, periodOpenPct)}
              ${chartLegend("period-normal", "正常饲养周期", counts.periodNormal, periodNormalPct)}
              ${chartLegend("period-overdue", "超期饲养", counts.periodOverdue, periodOverduePct)}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head compact">
            <div>
              <h2>饲养间使用情况</h2>
              <p>按饲养间展示状态与饲养周期分类，便于比较容量与超期分布。</p>
            </div>
          </div>
          <div class="room-capacity-list">
            ${roomCapacityRows().map(renderRoomCapacityRow).join("")}
          </div>
        </section>
      </div>
    </section>
  `;
}

function slotStatusCounts() {
  if ((!state.slots.length || infrastructureLoadState.scope === "summary") && state.dashboardSummary) {
    return {
      total: numericOrZero(state.dashboardSummary.total),
      active: numericOrZero(state.dashboardSummary.active),
      reserved: numericOrZero(state.dashboardSummary.reserved),
      empty: numericOrZero(state.dashboardSummary.empty),
      periodOpen: numericOrZero(state.dashboardSummary.periodOpen),
      periodNormal: numericOrZero(state.dashboardSummary.periodNormal),
      periodOverdue: numericOrZero(state.dashboardSummary.periodOverdue),
    };
  }
  const total = state.slots.length;
  const active = state.slots.filter((slot) => slot.status === "active").length;
  const reserved = state.slots.filter((slot) => slot.status === "reserved").length;
  const empty = Math.max(total - active - reserved, 0);
  const periodCounts = {
    periodOpen: 0,
    periodNormal: 0,
    periodOverdue: 0,
  };
  state.slots.forEach((slot) => {
    const tone = occupancyPeriodTone(currentOccupancy(slot.id));
    if (tone === "open") periodCounts.periodOpen += 1;
    if (tone === "normal") periodCounts.periodNormal += 1;
    if (tone === "overdue") periodCounts.periodOverdue += 1;
  });
  return { total, active, reserved, empty, ...periodCounts };
}

function roomCapacityRows() {
  return visibleRooms().map((room) => {
    const summary = roomSummaryById(room.id);
    const slots = slotsForRoom(room.id);
    const total = summary ? numericOrZero(summary.slotCount) : slots.length;
    const active = summary ? numericOrZero(summary.activeCount) : slots.filter((slot) => slot.status === "active").length;
    const reserved = summary ? numericOrZero(summary.reservedCount) : slots.filter((slot) => slot.status === "reserved").length;
    const empty = summary ? numericOrZero(summary.emptyCount) : Math.max(total - active - reserved, 0);
    let periodOpen = summary ? numericOrZero(summary.periodOpenCount) : 0;
    let periodNormal = summary ? numericOrZero(summary.periodNormalCount) : 0;
    let periodOverdue = summary ? numericOrZero(summary.periodOverdueCount) : 0;
    if (!summary) {
      slots.forEach((slot) => {
        const tone = occupancyPeriodTone(currentOccupancy(slot.id));
        if (tone === "open") periodOpen += 1;
        if (tone === "normal") periodNormal += 1;
        if (tone === "overdue") periodOverdue += 1;
      });
    }
    return {
      id: room.id,
      name: room.name,
      area: room.area,
      total,
      active,
      reserved,
      empty,
      periodOpen,
      periodNormal,
      periodOverdue,
    };
  });
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function chartLegend(tone, label, value, pct) {
  return `
    <div class="chart-legend-item">
      <span class="status-dot ${tone}"></span>
      <strong>${label}</strong>
      <small>${value} 笼 · ${pct}%</small>
    </div>
  `;
}

function renderRoomCapacityRow(room) {
  const reservedPct = percent(room.reserved, room.total);
  const emptyPct = percent(room.empty, room.total);
  const occupiedPct = percent(room.active + room.reserved, room.total);
  const periodOpenPct = percent(room.periodOpen, room.total);
  const periodNormalPct = percent(room.periodNormal, room.total);
  const periodOverduePct = percent(room.periodOverdue, room.total);
  return `
    <div class="room-capacity-row">
      <div class="room-capacity-head">
        <div>
          <strong>${escapeText(room.name)}</strong>
          <span>${escapeText(room.area || "未设置区域")} · ${room.total} 笼</span>
        </div>
        <em>${occupiedPct}% 占用/预约</em>
      </div>
      <div class="stacked-capacity-track" aria-label="${escapeAttr(room.name)} 笼位使用和周期分布">
        <i class="period-open" style="width:${periodOpenPct}%"></i>
        <i class="period-normal" style="width:${periodNormalPct}%"></i>
        <i class="period-overdue" style="width:${periodOverduePct}%"></i>
        <i class="reserved" style="width:${reservedPct}%"></i>
        <i class="empty" style="width:${emptyPct}%"></i>
      </div>
      <div class="room-capacity-meta">
        <span class="meta-pill period-open">未填结束 ${room.periodOpen}</span>
        <span class="meta-pill period-normal">正常周期 ${room.periodNormal}</span>
        <span class="meta-pill period-overdue">超期饲养 ${room.periodOverdue}</span>
        <span class="meta-pill active">在用 ${room.active}</span>
        <span class="meta-pill reserved">已预约 ${room.reserved}</span>
        <span class="meta-pill empty">空 ${room.empty}</span>
        <span class="meta-pill total">总笼位 ${room.total}</span>
      </div>
    </div>
  `;
}

function renderCageView() {
  const selectedRoom = getSelectedRoom();
  if (!selectedRoom) {
    return `
      <section class="content-grid">
        <div class="panel large">
          <div class="empty-state">
            ${iconSvg("grid")}
            <h2>尚未创建饲养间</h2>
            <p>先在饲养间管理中创建饲养间和笼架，再录入笼位占用信息。</p>
            ${currentUser?.role === "admin" ? `<button class="primary" type="button" data-view="rooms">${iconSvg("plus")}新增饲养间</button>` : ""}
          </div>
        </div>
      </section>
    `;
  }
  const racks = racksForRoom(selectedRoom.id);
  const selectedRack = getSelectedRack(racks);
  const cageLoading = remotePersistence && infrastructureLoadState.loading && infrastructureLoadState.scope !== "full";
  if (!selectedRack) {
    return `
      <section class="content-grid">
        <div class="panel large">
          <div class="empty-state">
            ${iconSvg("grid")}
            <h2>${cageLoading ? "正在加载笼位" : "尚未创建笼架"}</h2>
            <p>${cageLoading ? "正在加载当前饲养间笼位信息。" : "当前饲养间还没有笼架，请先添加笼架后再录入笼位。"}</p>
            ${currentUser ? `<button class="primary" type="button" data-view="rooms">${iconSvg("plus")}新增笼架</button>` : ""}
          </div>
        </div>
      </section>
    `;
  }
  const slots = slotsForRack(selectedRack.id);
  const visibleSlots = state.slotFilter === "all" ? slots : slots.filter((slot) => slot.status === state.slotFilter);
  const selectedSlot = getSelectedSlot(visibleSlots, slots);
  const selectedBatchSlots = slots.filter((slot) => state.selectedSlotIds.includes(slot.id));

  return `
    <section class="cage-layout">
      <div class="panel large cage-preview">
        <div class="panel-head">
          <div>
            <h2>动态笼位图</h2>
            <p>${selectedRoom.name} · ${rackDisplayName(selectedRack, selectedRoom)}</p>
          </div>
          <div class="toolbar">
            <select id="roomSelect">
              ${visibleRooms().map((room) => `<option value="${room.id}" ${room.id === selectedRoom.id ? "selected" : ""}>${room.name}</option>`).join("")}
            </select>
            <select id="rackSelect">
              ${racks.map((rack) => `<option value="${rack.id}" ${rack.id === selectedRack.id ? "selected" : ""}>${escapeText(rackDisplayName(rack, selectedRoom))}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="legend">
          ${legend("empty", "空")}
          ${legend("reserved", "已预约")}
          ${legend("active", "在用")}
          ${legend("period-open", "未填结束日期")}
          ${legend("period-normal", "正常饲养周期")}
          ${legend("period-overdue", "超期饲养")}
        </div>
        <div class="filter-row" role="group" aria-label="笼位状态筛选">
          ${filterButton("all", "全部")}
          ${filterButton("active", "在用")}
          ${filterButton("reserved", "已预约")}
          ${filterButton("empty", "空")}
          <button class="segmented batch-toggle ${state.batchMode ? "active" : ""}" id="batchModeToggle" type="button">
            ${iconSvg("grid")}多选录入${state.selectedSlotIds.length ? ` (${state.selectedSlotIds.length})` : ""}
          </button>
          ${
            state.batchMode
              ? `
                <button class="segmented" id="selectVisibleSlots" type="button">全选当前</button>
                <button class="segmented" id="clearBatchSelection" type="button">清空选择</button>
              `
              : ""
          }
        </div>
        <div class="rack-grid" style="--cols:${selectedRack.cols}">
          ${cageLoading && !visibleSlots.length ? `<p class="muted">正在加载当前饲养间笼位。</p>` : visibleSlots.map((slot) => renderSlot(slot)).join("")}
        </div>
        <div id="slotHoverPreview" class="slot-hover-preview" hidden></div>
        ${state.showCageEditor ? "" : renderCageEditorQuickAction(selectedSlot, selectedBatchSlots)}
        ${
          state.showCageEditor
            ? `
              <div class="cage-editor-backdrop" id="closeCageEditor"></div>
              <div class="panel detail-panel cage-editor cage-editor-popover" id="cageEditorPopover">
                <div class="editor-modal-actions">
                  <button class="secondary" type="button" id="closeCageEditorButton">${iconSvg("chevronRight")}关闭编辑</button>
                </div>
                ${state.batchMode ? renderBatchSlotDetail(selectedBatchSlots) : renderSlotDetail(selectedSlot)}
              </div>
            `
            : ""
        }
      </div>
    </section>
  `;
}

function renderCageEditorQuickAction(selectedSlot, selectedBatchSlots) {
  const label = state.batchMode
    ? `编辑已选 ${selectedBatchSlots.length || 0} 个笼位`
    : `编辑当前笼位 ${selectedSlot ? slotPositionCode(selectedSlot) : ""}`.trim();
  return `
    <button class="primary cage-editor-fab" type="button" data-open-cage-editor>
      ${iconSvg("edit")}${escapeText(label)}
    </button>
  `;
}

function legend(status, label) {
  return `<span class="legend-item"><i class="status-dot ${status}"></i>${label}</span>`;
}

function filterButton(value, label) {
  return `<button class="segmented ${state.slotFilter === value ? "active" : ""}" data-filter="${value}">${label}</button>`;
}

function renderSlot(slot) {
  const occupancy = currentOccupancy(slot.id);
  const isSelected = slot.id === state.selectedSlotId || state.selectedSlotIds.includes(slot.id);
  const isBatchSelected = state.selectedSlotIds.includes(slot.id);
  const showCurrentLabel = !state.batchMode && slot.id === state.selectedSlotId;
  const slotCode = cageCodeForSlot(slot.id);
  const periodTone = occupancyPeriodTone(occupancy);
  const title = occupancy
    ? `${slotCode} ${occupancy.iacuc || ""} ${occupancy.pi || ""} ${occupancy.owner || ""} ${occupancy.startDate || ""}`
    : `${slotCode} 空`;

  return `
    <button class="slot ${slot.status} ${periodTone ? `period-${periodTone}` : ""} ${isSelected ? "selected" : ""} ${isBatchSelected ? "batch-selected" : ""} ${showCurrentLabel ? "current-selected" : ""}" data-slot="${slot.id}" title="${escapeAttr(title)}">
      <span class="slot-code">${slotCode}</span>
      ${
        occupancy
          ? `
            <strong class="slot-iacuc">${escapeText(occupancy.iacuc || "未填写 IACUC")}</strong>
            <span class="slot-person">${escapeText(occupancy.pi || "未填写PI")} / ${escapeText(occupancy.owner || "未填写实验负责人")}</span>
            <span class="slot-date">${escapeText(occupancy.startDate || "未设置入住时间")}</span>
          `
          : `
            <strong class="slot-empty-text">空</strong>
          `
      }
      ${state.batchMode && isBatchSelected ? `<span class="slot-selected-label">已选</span>` : ""}
      ${showCurrentLabel ? `<span class="slot-current-label">当前</span>` : ""}
      <span class="slot-preview-template" hidden>${renderSlotPreview(slot, occupancy, slotCode)}</span>
    </button>
  `;
}

function renderSlotPreview(slot, occupancy, slotCode) {
  const rack = state.racks.find((item) => item.id === slot.rackId);
  const room = rack ? state.rooms.find((item) => item.id === rack.roomId) : null;
  const rows = [
    ["状态", statusLabel(slot.status)],
    ["房间", room?.name || "-"],
    ["笼架", rack ? rackDisplayName(rack, room) : "-"],
    ["位置", slotPositionCode(slot)],
    ["笼位编号", slotCode || "-"],
  ];

  if (occupancy) {
    const profile = billingProfileForSlot(slot, occupancy);
    rows.push(
      ["笼盒编号", occupancy.cageCode || "-"],
      ["收费项目", billingItemLabel(profile.billingItem)],
      ["计费单位", billingUnitLabel(profile.unit)],
      ["动物数量", profile.unit === "animal_day" ? occupancyAnimalCount(occupancy, profile) : "-"],
      ...(profile.species === "monkey"
        ? [
            ["性别", animalSexLabel(occupancy.animalSex)],
            ["出生日期", occupancy.birthDate || "-"],
            ["年龄", formatAnimalAge(occupancy.birthDate) || "-"],
          ]
        : []),
      ["IACUC", occupancy.iacuc || "-"],
      ["项目名称", occupancy.project || "-"],
      ["项目负责人", occupancy.pi || "-"],
      ["实验负责人", occupancy.owner || "-"],
      ["开始日期", occupancy.startDate || "-"],
      ["饲养周期(天)", occupancy.feedingDays || "-"],
      ["结束日期", occupancy.endDate || "-"],
      ["备注", occupancy.notes || "-"],
    );
  }

  return `
    <span class="slot-preview-head">
      <strong>${escapeText(slotCode || slotPositionCode(slot))}</strong>
      <em class="${escapeAttr(slot.status)}">${escapeText(statusLabel(slot.status))}</em>
    </span>
    <span class="slot-preview-rows">
      ${rows.map(([label, value]) => `<span class="slot-preview-row"><span>${escapeText(label)}</span><strong>${escapeText(value)}</strong></span>`).join("")}
    </span>
  `;
}

function renderSlotDetail(slot) {
  if (!slot) {
    return `
      <div class="empty-state">
        ${iconSvg("grid")}
        <h2>没有符合筛选条件的笼位</h2>
      </div>
    `;
  }

  const current = currentOccupancy(slot.id);
  const occupancy = current ?? emptyOccupancy(slot.id);
  const history = state.occupancies.filter((item) => item.slotId === slot.id);
  const profile = billingProfileForSlot(slot, occupancy);
  const showAnimalCount = profile.unit === "animal_day";
  const showMonkeyFields = profile.species === "monkey";

  return `
    <div class="panel-head compact">
      <div>
        <h2>笼位 ${slotPositionCode(slot)}</h2>
        <p>${statusLabel(slot.status)}</p>
      </div>
      <span class="pill ${slot.status}">${statusLabel(slot.status)}</span>
    </div>

    <form id="slotForm" class="form compact-slot-form">
      <input type="hidden" name="slotId" value="${slot.id}" />
      <div class="compact-form-row two-one">
        <label class="field-required">
          状态
          <select name="status">
            ${statusOption("empty", occupancy.status)}
            ${statusOption("reserved", occupancy.status)}
            ${statusOption("active", occupancy.status)}
          </select>
        </label>
        <label>
          笼盒编号
          <input name="cageCode" value="${escapeAttr(occupancy.cageCode)}" placeholder="请输入笼盒编号，如 M-A001" />
        </label>
        ${
          showAnimalCount
            ? `
              <label class="field-required">
                动物数量
                <input name="animalCount" type="number" min="1" value="${escapeAttr(occupancy.animalCount || profile.defaultAnimalCount || 1)}" placeholder="请输入本笼动物只数" required />
              </label>
            `
            : ""
        }
      </div>
      <div class="room-billing-hint">
        <span>${escapeText(facilityLabel(profile.facility))}</span>
        <span>${escapeText(billingItemLabel(profile.billingItem))}</span>
        <span>${escapeText(customerTypeLabel(profile.customerType))}</span>
        <span>${escapeText(billingUnitLabel(profile.unit))}</span>
        <span>${escapeText(billingPriceLabel(profile))}</span>
      </div>
      <div class="compact-form-row third">
        <label class="field-required">
          IACUC 编号
          ${renderIacucLookupInput("iacuc", occupancy.iacuc, { required: false })}
        </label>
        <label class="field-auto">
          项目名称
          <textarea name="project" rows="2" placeholder="选择 IACUC 后自动填充，也可手动输入">${escapeText(occupancy.project)}</textarea>
        </label>
      </div>
      <div class="compact-form-row third">
        <label class="field-auto">
          项目负责人
          <input name="pi" value="${escapeAttr(occupancy.pi)}" placeholder="选择 IACUC 后自动填充" />
        </label>
        <label class="field-auto">
          实验负责人
          <input name="owner" value="${escapeAttr(occupancy.owner)}" placeholder="选择 IACUC 后自动填充" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          开始日期
          <input type="date" name="startDate" value="${occupancy.startDate || today}" placeholder="请选择开始日期" />
        </label>
        <label>
          饲养周期（天）
          <input type="number" name="feedingDays" min="1" step="1" value="${escapeAttr(occupancy.feedingDays || "")}" placeholder="请输入饲养周期天数" />
        </label>
        <label>
          结束/最后计费日期
          <input type="date" name="endDate" value="${occupancy.endDate}" placeholder="请选择结束日期" />
        </label>
      </div>
      ${
        showMonkeyFields
          ? `
            <div class="compact-form-row third">
              <label>
                性别
                <select name="animalSex">
                  <option value="unknown" ${normalizeAnimalSex(occupancy.animalSex) === "unknown" ? "selected" : ""}>请选择</option>
                  <option value="male" ${normalizeAnimalSex(occupancy.animalSex) === "male" ? "selected" : ""}>雄</option>
                  <option value="female" ${normalizeAnimalSex(occupancy.animalSex) === "female" ? "selected" : ""}>雌</option>
                </select>
              </label>
              <label>
                出生日期
                <input type="date" name="birthDate" value="${escapeAttr(occupancy.birthDate || "")}" />
              </label>
              <label>
                年龄
                <input type="text" value="${escapeAttr(formatAnimalAge(occupancy.birthDate) || "自动计算")}" data-monkey-age readonly />
              </label>
            </div>
          `
          : ""
      }
      <label class="full-field">
        备注
        <textarea name="notes" rows="3" placeholder="请输入品系、周龄、特殊饲养要求等备注">${escapeText(occupancy.notes)}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="primary">${iconSvg("save")}保存笼位</button>
        ${
          occupancy.status === "active"
            ? `<button type="button" class="secondary" id="openSampleSlot">${iconSvg("check")}已取材</button>`
            : ""
        }
        <button type="button" class="ghost" id="clearSlot">${iconSvg("trash")}设为空</button>
      </div>
      ${occupancy.status === "active" && state.samplingMode === "single" ? renderSamplingPanel("single", occupancy.endDate || today) : ""}
    </form>

    <div class="history">
      <h3>占用历史</h3>
      ${history.length ? history.map(renderHistoryItem).join("") : `<p class="muted">暂无历史记录。</p>`}
    </div>
  `;
}

function renderBatchSlotDetail(slots) {
  if (!slots.length) {
    return `
      <div class="empty-state">
        ${iconSvg("grid")}
        <h2>请选择要批量录入的笼位</h2>
        <p class="muted">开启多选录入后，点击或按住拖过笼位可加入或移出批量选择。</p>
      </div>
    `;
  }

  const batchState = getBatchEditState(slots);
  const activeCount = selectedActiveOccupancies(slots).length;
  if (batchState.hasConflict) {
    return `
      <div class="panel-head compact">
        <div>
          <h2>批量编辑冲突</h2>
          <p>已选择 ${slots.length} 个笼位，但包含多个不同 IACUC 编号。</p>
        </div>
        <span class="pill ended">需重新选择</span>
      </div>

      <div class="selected-list">
        ${slots.map((slot) => `<span>${slotPositionCode(slot)}</span>`).join("")}
      </div>

      <div class="warning-box">
        <strong>请只选择相同 IACUC 编号的笼位进行批量编辑。</strong>
        <p>当前选择包含：${batchState.iacucs.map((iacuc) => escapeText(iacuc)).join("、")}。为了避免误覆盖项目负责人、实验负责人和计费归属，系统已暂停批量保存。</p>
      </div>

      <div class="form-actions">
        <button type="button" class="secondary" id="clearBatchSelection">${iconSvg("refresh")}重新选择</button>
        ${
          activeCount
            ? `<button type="button" class="secondary" id="openSampleBatchSlots">${iconSvg("check")}批量已取材 (${activeCount})</button>`
            : ""
        }
        <button type="button" class="ghost" id="clearBatchSlots">${iconSvg("trash")}批量设为空</button>
      </div>
      ${activeCount && state.samplingMode === "batch" ? renderSamplingPanel("batch", today, activeCount) : ""}
    `;
  }

  const draft = batchState.draft;

  return `
    <div class="panel-head compact">
      <div>
        <h2>批量录入</h2>
        <p>${draft.iacuc ? `已自动带入 ${escapeText(draft.iacuc)} 的项目信息。` : `已选择 ${slots.length} 个笼位，保存后写入相同项目信息。`}</p>
      </div>
      <span class="pill active">${slots.length} 个笼位</span>
    </div>

    <div class="selected-list">
      ${slots.map((slot) => `<span>${slotPositionCode(slot)}</span>`).join("")}
    </div>

    <form id="batchSlotForm" class="form compact-slot-form">
      <div class="compact-form-row third">
        <label class="field-required">
          状态
          <select name="status">
            ${statusOption("active", draft.status)}
            ${statusOption("reserved", draft.status)}
          </select>
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          IACUC 编号
          ${renderIacucLookupInput("iacuc", draft.iacuc, { required: false })}
        </label>
        <label class="field-auto">
          项目名称
          <textarea name="project" rows="2" placeholder="选择 IACUC 后自动填充，也可手动输入">${escapeText(draft.project)}</textarea>
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-auto">
          项目负责人
          <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="选择 IACUC 后自动填充" />
        </label>
        <label class="field-auto">
          实验负责人
          <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="选择 IACUC 后自动填充" />
        </label>
      </div>
      <div class="compact-form-row half">
        <label class="field-required">
          开始日期
          <input type="date" name="startDate" value="${draft.startDate}" placeholder="请选择开始日期" />
        </label>
        <label>
          饲养周期（天）
          <input type="number" name="feedingDays" min="1" step="1" value="${escapeAttr(draft.feedingDays || "")}" placeholder="请输入饲养周期天数" />
        </label>
        <label>
          结束/最后计费日期
          <input type="date" name="endDate" value="${draft.endDate}" placeholder="请选择结束日期" />
        </label>
      </div>
      <label class="full-field">
        备注
        <textarea name="notes" rows="3" placeholder="请输入批量备注，笼盒编号请单笼维护">${escapeText(draft.notes)}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="primary">${iconSvg("save")}批量保存</button>
        ${
          activeCount
            ? `<button type="button" class="secondary" id="openSampleBatchSlots">${iconSvg("check")}批量已取材 (${activeCount})</button>`
            : ""
        }
        <button type="button" class="ghost" id="clearBatchSlots">${iconSvg("trash")}批量设为空</button>
      </div>
      ${activeCount && state.samplingMode === "batch" ? renderSamplingPanel("batch", today, activeCount) : ""}
    </form>

  `;
}

function statusOption(status, current) {
  return `<option value="${status}" ${status === current ? "selected" : ""}>${statusLabel(status)}</option>`;
}

function renderIacucLookupInput(name, value = "", options = {}) {
  const placeholder = options.placeholder || "请输入或选择 IACUC 编号";
  const required = options.required ? "required" : "";
  const compact = options.compact ? " compact" : "";
  return `
    <div class="iacuc-lookup-field${compact}">
      <input
        name="${escapeAttr(name)}"
        value="${escapeAttr(value)}"
        placeholder="${escapeAttr(placeholder)}"
        autocomplete="off"
        data-iacuc-lookup
        ${required}
      />
      ${renderIacucLookupPanel(value)}
    </div>
  `;
}

function renderIacucLookupPanel(value = "") {
  const options = iacucOptions(value);
  const hasKeyword = String(value || "").trim();
  const total = iacucIndexMeta?.count ?? IACUC_INDEX.length;
  const statusText = IACUC_INDEX_LOADING ? "正在加载索引" : total ? `${total} 条索引` : "暂无索引";
  return `
    <div class="iacuc-suggest-panel" data-iacuc-suggest-panel>
      <div class="iacuc-suggest-head">
        <span>${hasKeyword ? "匹配伦理号" : "常用伦理号"}</span>
        <small>${statusText}</small>
      </div>
      <div class="iacuc-suggest-list">
        ${
          IACUC_INDEX_LOADING
            ? `<div class="iacuc-suggest-empty">正在加载伦理号索引</div>`
            : options.length
            ? options.map(renderIacucSuggestion).join("")
            : `<div class="iacuc-suggest-empty">未匹配到索引，可继续手动输入</div>`
        }
      </div>
    </div>
  `;
}

function renderIacucSuggestion(item) {
  const title = item.project || item.pi || "未填写项目信息";
  const meta = [item.pi, item.owner, item.funding].filter(Boolean).join(" · ");
  return `
    <button
      class="iacuc-suggest-item"
      type="button"
      data-iacuc-pick="${escapeAttr(item.iacuc)}"
      title="${escapeAttr(title)}"
    >
      <strong>${escapeText(item.iacuc)}</strong>
      <span>${escapeText(title)}</span>
      ${meta ? `<small>${escapeText(meta)}</small>` : ""}
    </button>
  `;
}

function renderSamplingPanel(mode, defaultDate, count = 1) {
  return `
    <div class="sampling-panel" data-sampling-mode="${mode}">
      <label>
        取材日期（最后计费日期）
        <input type="date" id="${mode === "batch" ? "batchSampleDate" : "sampleDate"}" value="${defaultDate || today}" placeholder="请选择取材日期" />
      </label>
      <div class="form-actions compact-actions">
        <button type="button" class="primary" id="${mode === "batch" ? "confirmSampleBatchSlots" : "confirmSampleSlot"}">
          ${iconSvg("check")}${mode === "batch" ? `确认 ${count} 笼已取材` : "确认已取材"}
        </button>
        <button type="button" class="secondary" id="cancelSampling">取消</button>
      </div>
    </div>
  `;
}

function getBatchEditState(slots) {
  const occupiedItems = slots.map((slot) => currentOccupancy(slot.id)).filter(Boolean);
  const iacucByKey = new Map();

  occupiedItems.forEach((item) => {
    const key = normalizeIacucNumber(item.iacuc);
    if (key) iacucByKey.set(key, item.iacuc);
  });

  const iacucs = [...iacucByKey.values()];
  const hasConflict = iacucs.length > 1;
  const draft = hasConflict ? emptyBatchDraft() : buildBatchDraft(occupiedItems);

  return {
    hasConflict,
    iacucs,
    draft,
  };
}

function buildBatchDraft(occupiedItems) {
  const iacuc = commonValue(occupiedItems, "iacuc");
  const matched = iacuc ? findIacucInfo(iacuc) : null;

  return {
    status: commonValue(occupiedItems, "status") || "active",
    iacuc: matched?.iacuc || iacuc,
    project: commonValue(occupiedItems, "project") || matched?.project || "",
    pi: commonValue(occupiedItems, "pi") || matched?.pi || "",
    owner: commonValue(occupiedItems, "owner") || matched?.owner || "",
    startDate: commonValue(occupiedItems, "startDate") || today,
    feedingDays: commonValue(occupiedItems, "feedingDays"),
    endDate: commonValue(occupiedItems, "endDate"),
    notes: commonValue(occupiedItems, "notes"),
  };
}

function emptyBatchDraft() {
  return {
    status: "active",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    startDate: today,
    feedingDays: "",
    endDate: "",
    notes: "",
  };
}

function commonValue(items, key) {
  if (!items.length) return "";
  const values = [...new Set(items.map((item) => item[key] || ""))];
  return values.length === 1 ? values[0] : "";
}

function selectedActiveOccupancies(slots) {
  return slots
    .map((slot) => currentOccupancy(slot.id))
    .filter((item) => item?.status === "active");
}

function renderHistoryItem(item) {
  return `
    <div class="history-item">
      <span class="pill ${item.endReason === "sampled" ? "sampled" : item.status}">${historyStatusLabel(item)}</span>
      <div>
        <strong>${item.cageCode || "未填写笼盒编号"}</strong>
        <p>${item.iacuc || "无 IACUC"} · ${item.startDate || "-"} 至 ${item.endDate || "至今"}</p>
      </div>
    </div>
  `;
}

function renderIntakeBatchView() {
  const draft = state.intakeBatchDraft || makeIncomingBatchDraft();
  const selectedCount = state.selectedIntakeBatchIds.length;
  const canPrintCurrent = draft.cards.length > 0;
  const visibleBatches = filteredIntakeBatches();
  return `
    <section class="billing-layout quantity-billing-layout intake-layout">
      <div class="panel large">
        <form id="intakeBatchForm">
          <div class="panel-head">
            <div>
              <h2>接收笼卡</h2>
              <p>粘贴课题组预约接收消息，系统解析批次、项目和装笼建议，并保存为待打印批次。</p>
            </div>
          </div>

          <div class="intake-entry-layout">
            <div class="intake-message-field">
              <div class="intake-message-head">
                <span>预约消息识别</span>
                <button id="parseIncomingMessage" class="secondary compact-action" type="button">${iconSvg("refresh")}识别文本</button>
              </div>
              <textarea name="rawMessage" rows="8" placeholder="粘贴课题组发送的预约接收文本，点击“识别文本”自动提取批次号、供应商、品系、数量、房间、进驻日期等信息。">${escapeText(draft.rawMessage)}</textarea>
            </div>
            <div class="intake-action-panel">
              <select id="intakeBatchSelect" aria-label="选择待接收批次">
                <option value="">编辑已保存批次</option>
                ${state.intakeBatches
                  .map(
                    (item) => `<option value="${escapeAttr(item.id)}" ${item.id === draft.id ? "selected" : ""}>${escapeText(intakeStatusLabel(item.status))} · ${escapeText(item.batchNo || "未命名批次")}</option>`,
                  )
                  .join("")}
              </select>
              <div class="intake-action-grid">
                <button id="saveIntakeBatch" class="primary" type="submit">${iconSvg("save")}保存为待接收批次</button>
                <button id="printCurrentCageCards" class="secondary" type="button" ${canPrintCurrent ? "" : "disabled"}>${iconSvg("download")}打印当前笼卡</button>
                <button id="previewCurrentCageCard" class="secondary" type="button" ${canPrintCurrent ? "" : "disabled"}>${iconSvg("search")}预览当前笼卡</button>
              </div>
            </div>
          </div>

          <div class="intake-form-grid">
            <input type="hidden" name="id" value="${escapeAttr(draft.id)}" />
            <input type="hidden" name="purchaseOrderNo" value="${escapeAttr(draft.purchaseOrderNo)}" />
            <input type="hidden" name="project" value="${escapeAttr(draft.project)}" />
            <input type="hidden" name="sex" value="${escapeAttr(draft.sex)}" />
            <input type="hidden" name="notes" value="${escapeAttr(draft.notes)}" />
            <input type="hidden" name="strainRaw" value="${escapeAttr(draft.strainRaw)}" />
            <div class="intake-field-row three">
              <label class="field-required">
                购买单位
                <input name="supplier" value="${escapeAttr(draft.supplier)}" placeholder="供应商名称" required />
              </label>
              <label class="field-required">
                批次号
                <input name="batchNo" value="${escapeAttr(draft.batchNo)}" placeholder="（IACUC编号）年月日批次" required />
              </label>
              <label>
                IACUC 编号
                ${renderIacucLookupInput("iacuc", draft.iacuc)}
              </label>
            </div>
            <div class="intake-field-row two">
              <label class="field-auto">
                项目负责人
                <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="IACUC 匹配后自动填充" />
              </label>
              <label class="field-auto">
                实验负责人/助手
                <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="默认打印实验负责人，助手可手写" />
              </label>
            </div>
            <div class="intake-field-row four">
              <label>
                物种
                <select name="species">
                  ${SPECIES_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === draft.species ? "selected" : ""}>${escapeText(label)}</option>`).join("")}
                </select>
              </label>
              <label>
                品系
                <input name="strainStandard" value="${escapeAttr(draft.strainStandard)}" placeholder="如 C57BL/6J" />
              </label>
              <label class="field-required">
                数量（只）
                <input name="quantity" type="number" min="1" value="${draft.quantity ?? ""}" placeholder="请输入动物数量" required />
              </label>
              <label>
                房间
                <input name="roomName" value="${escapeAttr(draft.roomName)}" placeholder="可修改" />
              </label>
            </div>
            <div class="intake-field-row three">
              <label class="field-required">
                接收日期
                <input name="intakeDate" type="date" value="${escapeAttr(draft.intakeDate)}" required />
              </label>
              <label>
                饲养周期
                <input name="husbandryDays" type="number" min="1" value="${draft.husbandryDays ?? ""}" placeholder="天数" />
              </label>
              <label>
                结束日期
                <input name="endDate" type="date" value="${escapeAttr(draft.endDate)}" />
              </label>
            </div>
            <div class="intake-field-row two">
              <label>
                打印张数
                <input name="finalCardCount" type="number" min="0" value="${draft.finalCardCount ?? 0}" />
              </label>
              <label>
                状态
                <select name="status">
                  ${INTAKE_STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === draft.status ? "selected" : ""}>${escapeText(label)}</option>`).join("")}
                </select>
              </label>
            </div>
            <input type="hidden" name="receiverName" value="${escapeAttr(draft.receiverName || currentUser?.displayName || "")}" />
            <input type="hidden" name="vetPhone" value="${escapeAttr(draft.vetPhone)}" />
            <input type="hidden" name="suggestedAnimalsPerCage" value="${escapeAttr(draft.suggestedAnimalsPerCage ?? defaultAnimalsPerCage(draft.species))}" />
            <input type="hidden" name="suggestedCardCount" value="${escapeAttr(draft.suggestedCardCount ?? 0)}" />
          </div>
        </form>

        <div class="panel intake-batch-list-panel">
          <div class="panel-head compact">
            <div>
              <h2>待接收批次列表</h2>
              <p>支持攒单后一起打印；打印后可将状态切到“已打印”。</p>
            </div>
            <div class="toolbar intake-batch-toolbar">
              <div class="filter-row intake-filter-row" role="group" aria-label="待接收批次筛选">
                ${INTAKE_BATCH_FILTER_OPTIONS.map(([value, label]) => intakeBatchFilterButton(value, label)).join("")}
              </div>
              <button id="printSelectedCageCards" class="primary" type="button" ${selectedCount ? "" : "disabled"}>${iconSvg("download")}打印勾选批次（${selectedCount}）</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="workflow-table intake-batch-table">
              <thead><tr><th></th><th>状态</th><th>批次号</th><th>购买单位</th><th>数量</th><th>房间</th><th>接收日期</th><th>笼卡</th><th></th></tr></thead>
              <tbody>
                ${
                  visibleBatches.length
                    ? visibleBatches.map(renderIntakeBatchRow).join("")
                    : `<tr><td colspan="9">${state.intakeBatches.length ? "当前筛选下没有待接收批次。" : "还没有保存待接收批次。"}</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
        ${renderIntakeBatchEditorModal()}
        ${state.showIntakeCardPreview ? renderIntakeCardPreviewModal(draft) : ""}
      </div>
    </section>
  `;
}

function renderIntakeCardVisualPreview(batch) {
  const card = batch.cards[0];
  if (!card) {
    return `<div class="intake-card-preview-empty">填写批次数量和打印张数后生成笼卡预览。</div>`;
  }
  return `
    <div class="intake-card-preview-surface">
      <div class="intake-card-preview-meta">
        <span>预览第 1 张 / 共 ${escapeText(batch.finalCardCount || 0)} 张</span>
        <span>数量不能整除时，最后一张“数目变化”会留空。</span>
      </div>
      <div class="intake-card-preview-frame">
        ${renderIntakeCardPrint(batch, card)}
      </div>
    </div>
  `;
}

function renderIntakeCardPreviewModal(batch) {
  const normalized = normalizeIncomingBatchDraft(batch);
  return `
    <div class="editor-modal-backdrop" id="closeIntakeCardPreview"></div>
    <div class="panel detail-panel editor-modal intake-card-preview-modal">
      <div class="editor-modal-actions">
        <button class="secondary" type="button" id="closeIntakeCardPreviewButton">${iconSvg("chevronRight")}关闭预览</button>
      </div>
      <div class="panel-head compact">
        <div>
          <h2>预览当前笼卡</h2>
          <p>按实际打印模板预览第一张笼卡；完整张数仍以打印张数为准。</p>
        </div>
      </div>
      ${renderIntakeCardVisualPreview(normalized)}
    </div>
  `;
}

function filteredIntakeBatches() {
  return state.intakeBatches.filter((batch) => intakeBatchMatchesFilter(batch, state.intakeBatchFilter));
}

function intakeBatchMatchesFilter(batch, filter) {
  if (filter === "all") return true;
  if (filter === "todo") return batch.status !== "printed";
  return batch.status === filter;
}

function intakeBatchFilterButton(value, label) {
  const count = state.intakeBatches.filter((batch) => intakeBatchMatchesFilter(batch, value)).length;
  return `<button class="segmented ${state.intakeBatchFilter === value ? "active" : ""}" type="button" data-intake-batch-filter="${value}">${escapeText(label)} ${count}</button>`;
}

function renderIntakeBatchRow(batch) {
  const checked = state.selectedIntakeBatchIds.includes(batch.id);
  const supplierShortName = abbreviateSupplierName(batch.supplier);
  return `
    <tr class="workflow-row ${batch.id === state.selectedIntakeBatchId ? "selected-row" : ""}" data-open-intake-batch="${escapeAttr(batch.id)}">
      <td><input type="checkbox" data-select-intake-batch="${escapeAttr(batch.id)}" ${checked ? "checked" : ""} aria-label="选择 ${escapeAttr(batch.batchNo || batch.id)}" /></td>
      <td><span class="pill ${batch.status === "printed" ? "active" : "reserved"}">${escapeText(intakeStatusLabel(batch.status))}</span></td>
      <td>${escapeText(batch.batchNo || "-")}</td>
      <td title="${escapeAttr(batch.supplier || "")}">${escapeText(supplierShortName || batch.supplier || "-")}</td>
      <td>${escapeText(batch.quantity ?? "-")}</td>
      <td>${escapeText(batch.roomName || "-")}</td>
      <td>${escapeText(batch.intakeDate || "-")}</td>
      <td>${escapeText(batch.finalCardCount || 0)} 张</td>
      <td>
        <button class="ghost" type="button" data-open-intake-batch-button="${escapeAttr(batch.id)}">编辑</button>
        <button class="ghost danger-text" type="button" data-delete-intake-batch="${escapeAttr(batch.id)}">删除</button>
      </td>
    </tr>
  `;
}

function renderIntakeBatchEditorModal() {
  const draft = state.editingIntakeBatchDraft ? normalizeIncomingBatchDraft(state.editingIntakeBatchDraft) : null;
  if (!draft) return "";
  return `
    <div class="editor-modal-backdrop" id="closeIntakeBatchEditor"></div>
    <div class="panel detail-panel editor-modal intake-batch-editor-modal">
      <div class="editor-modal-actions">
        <button class="secondary" type="button" id="closeIntakeBatchEditorButton">${iconSvg("chevronRight")}关闭编辑</button>
      </div>
      <div class="panel-head compact">
        <div>
          <h2>编辑待接收批次</h2>
          <p>${escapeText(draft.batchNo || "未命名批次")} · 修改后只更新这条记录，不影响上方预约消息识别。</p>
        </div>
        <span class="pill ${draft.status === "printed" ? "active" : "reserved"}">${escapeText(intakeStatusLabel(draft.status))}</span>
      </div>
      <form id="intakeBatchEditForm" class="form intake-edit-form">
        <input type="hidden" name="id" value="${escapeAttr(draft.id)}" />
        <input type="hidden" name="rawMessage" value="${escapeAttr(draft.rawMessage)}" />
        <input type="hidden" name="purchaseOrderNo" value="${escapeAttr(draft.purchaseOrderNo)}" />
        <input type="hidden" name="project" value="${escapeAttr(draft.project)}" />
        <input type="hidden" name="sex" value="${escapeAttr(draft.sex)}" />
        <input type="hidden" name="notes" value="${escapeAttr(draft.notes)}" />
        <input type="hidden" name="strainRaw" value="${escapeAttr(draft.strainRaw)}" />
        <input type="hidden" name="receiverName" value="${escapeAttr(draft.receiverName || currentUser?.displayName || "")}" />
        <input type="hidden" name="vetPhone" value="${escapeAttr(draft.vetPhone)}" />
        <input type="hidden" name="suggestedAnimalsPerCage" value="${escapeAttr(draft.suggestedAnimalsPerCage ?? defaultAnimalsPerCage(draft.species))}" />
        <input type="hidden" name="suggestedCardCount" value="${escapeAttr(draft.suggestedCardCount ?? 0)}" />
        <div class="intake-field-row two">
          <label class="field-required">
            购买单位
            <input name="supplier" value="${escapeAttr(draft.supplier)}" placeholder="供应商名称" required />
          </label>
          <label class="field-required">
            批次号
            <input name="batchNo" value="${escapeAttr(draft.batchNo)}" placeholder="（IACUC编号）年月日批次" required />
          </label>
        </div>
        <div class="intake-field-row two">
          <label>
            IACUC 编号
            ${renderIacucLookupInput("iacuc", draft.iacuc)}
          </label>
          <label>
            物种
            <select name="species">
              ${SPECIES_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === draft.species ? "selected" : ""}>${escapeText(label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="intake-field-row two">
          <label class="field-auto">
            项目负责人
            <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="IACUC 匹配后自动填充" />
          </label>
          <label class="field-auto">
            实验负责人/助手
            <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="默认打印实验负责人，助手可手写" />
          </label>
        </div>
        <div class="intake-field-row two">
          <label>
            品系
            <input name="strainStandard" value="${escapeAttr(draft.strainStandard)}" placeholder="如 C57BL/6J" />
          </label>
          <label class="field-required">
            数量（只）
            <input name="quantity" type="number" min="1" value="${draft.quantity ?? ""}" placeholder="请输入动物数量" required />
          </label>
        </div>
        <div class="intake-field-row two">
          <label>
            房间
            <input name="roomName" value="${escapeAttr(draft.roomName)}" placeholder="可修改" />
          </label>
          <label class="field-required">
            接收日期
            <input name="intakeDate" type="date" value="${escapeAttr(draft.intakeDate)}" required />
          </label>
        </div>
        <div class="intake-field-row two">
          <label>
            饲养周期
            <input name="husbandryDays" type="number" min="1" value="${draft.husbandryDays ?? ""}" placeholder="天数" />
          </label>
          <label>
            结束日期
            <input name="endDate" type="date" value="${escapeAttr(draft.endDate)}" />
          </label>
        </div>
        <div class="intake-field-row two">
          <label>
            打印张数
            <input name="finalCardCount" type="number" min="0" value="${draft.finalCardCount ?? 0}" />
          </label>
          <label>
            状态
            <select name="status">
              ${INTAKE_STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === draft.status ? "selected" : ""}>${escapeText(label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="primary">${iconSvg("save")}保存修改</button>
          <button type="button" class="secondary" id="cancelIntakeBatchEdit">取消</button>
        </div>
      </form>
    </div>
  `;
}

function intakeStatusLabel(value) {
  return INTAKE_STATUS_OPTIONS.find(([key]) => key === value)?.[1] || "待完善";
}

function formatShortDate(value) {
  const normalized = normalizeFlexibleDate(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${year.slice(2)}.${Number(month)}.${Number(day)}`;
}

function renderBillingView() {
  return `
    <section class="billing-source-tabs" role="tablist" aria-label="饲养费核算方式">
      <button class="segmented ${state.billingSource === "cage_map" ? "active" : ""}" type="button" data-billing-source="cage_map">动态笼位图（自动）</button>
      <button class="segmented ${state.billingSource === "quantity_sheet" ? "active" : ""}" type="button" data-billing-source="quantity_sheet">数量统计表（录入）</button>
    </section>
    ${state.billingSource === "quantity_sheet" ? renderQuantitySheetBillingView() : renderCageMapBillingView()}
  `;
}

function renderWorkflowCenterView() {
  if (!remotePersistence) {
    return `
      <section class="content-grid">
        <div class="panel large">
          <div class="empty-state">
            ${iconSvg("refresh")}
            <h2>流程中心仅在共享模式下可用</h2>
            <p>当前离线演示模式不会持久化结算流程、版本和事件记录。</p>
          </div>
        </div>
      </section>
    `;
  }
  return `
    <section class="workflow-center-view">
      ${renderBillingWorkflowPanel()}
      ${state.selectedBillingWorkflowDetail ? renderBillingWorkflowDetailModal() : ""}
    </section>
  `;
}

function renderCageMapBillingView() {
  const statement = buildStatement(state.billingPi, state.billingMonth);
  const canGenerateStatement = !remotePersistence || currentUser?.role === "admin";

  return `
    <section class="billing-layout quantity-billing-layout">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>动态笼位图结算</h2>
            <p>按每天实际在养笼数计算，已预约默认不计费。</p>
          </div>
          <div class="billing-sheet-actions">
            <div class="billing-filter-grid">
              <input id="billingMonth" type="month" value="${state.billingMonth}" placeholder="请选择结算月份" />
              <input id="billingPi" type="text" value="${escapeAttr(state.billingPi)}" list="billingPiOptions" placeholder="请输入或选择项目负责人" />
            </div>
            <div class="billing-action-stack">
              <div class="billing-action-grid">
                <button id="exportBilling" class="secondary" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出饲养明细 CSV</button>
                <button id="exportSettlementPdf" class="secondary" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出结算单 PDF</button>
              </div>
              <div class="billing-action-grid single">
                <button id="generateBillingWorkflow" class="primary billing-workflow-button" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("refresh")}发起结算流程</button>
              </div>
            </div>
          </div>
        </div>

        <datalist id="billingPiOptions">
          ${piOptions(state.billingPi)
            .map((item) => `<option value="${escapeAttr(item.pi)}" label="${escapeAttr(item.iacucs.join("、"))}"></option>`)
            .join("")}
        </datalist>

        <div class="statement-summary">
          ${summaryTile("项目负责人", state.billingPi || "-")}
          ${summaryTile("伦理编号", statement.iacucs.length ? statement.iacucs.join("、") : "-")}
          ${summaryTile("项目数量", statement.iacucs.length)}
          ${summaryTile("免费笼数/天", statement.freeCageAllowance)}
          ${summaryTile("累计笼日", statement.totalCageDays)}
          ${summaryTile("收费笼日", statement.totalBillableCageDays)}
          ${summaryTile("应收金额", `¥${MONEY_FORMAT.format(statement.totalAmount)}`)}
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>笼数</th>
                <th>收费笼数</th>
                <th>当日费用</th>
                <th>累计费用</th>
              </tr>
            </thead>
            <tbody>
              ${statement.rows.map(renderBillingRow).join("")}
            </tbody>
          </table>
        </div>
        ${
          canGenerateStatement
            ? ""
            : `<p class="muted">共享模式下只有系统管理员可以生成和导出正式结算单。</p>`
        }
      </div>
    </section>
  `;
}

function renderQuantitySheetBillingView() {
  const draft = state.quantitySheetDraft || makeQuantitySheetDraft(state.billingMonth);
  const statement = buildQuantitySheetStatement(draft);
  const canGenerateStatement = !remotePersistence || Boolean(currentUser);
  const quantityLoading = remotePersistence && lazyDataState.quantitySheetsLoading && !state.quantitySheets.length;
  const managerValue = draft.manager || currentUser?.displayName || "";
  const quantityRoom = state.rooms.find((room) => room.id === quantitySheetRoomId(draft));
  const quantityProfile = billingProfileForRoom(quantityRoom || {});
  const isAnimalBilling = quantityProfile.unit === "animal_day";

  return `
    <section class="billing-layout quantity-billing-layout">
      <div class="panel large">
        <form id="quantitySheetForm">
          <div class="panel-head">
            <div>
              <h2>数量统计表结算</h2>
              <p>录入纸质数量统计表中的变更行，系统按房间计费口径展开每日明细。</p>
            </div>
            <div class="quantity-sheet-actions">
              <select id="quantitySheetSelect" aria-label="选择数量统计表">
                <option value="">${quantityLoading ? "正在加载统计表" : "请选择统计表或新建"}</option>
                ${state.quantitySheets
                  .map((sheet) => `<option value="${escapeAttr(sheet.id)}" ${sheet.id === draft.id ? "selected" : ""}>${escapeText(sheet.month)} · ${escapeText(sheet.iacuc)}</option>`)
                  .join("")}
              </select>
              <div class="quantity-action-stack">
                <div class="quantity-action-grid">
                  <button id="newQuantitySheet" class="secondary" type="button">${iconSvg("plus")}新建</button>
                  <button id="saveQuantitySheet" class="secondary" type="submit">${iconSvg("save")}保存统计表</button>
                  <button id="deleteQuantitySheet" class="ghost danger-text" type="button" ${state.quantitySheets.some((sheet) => sheet.id === draft.id) ? "" : "disabled"}>${iconSvg("trash")}删除统计表</button>
                </div>
                <div class="quantity-action-grid">
                  <button id="exportBilling" class="secondary" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出饲养明细 CSV</button>
                  <button id="exportSettlementPdf" class="secondary" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("download")}导出结算单 PDF</button>
                  <button id="generateBillingWorkflow" class="primary quantity-workflow-button" type="button" ${canGenerateStatement ? "" : "disabled"}>${iconSvg("refresh")}发起结算流程</button>
                </div>
              </div>
            </div>
          </div>
          ${quantityLoading ? `<p class="muted">正在加载数量统计表，请稍候。</p>` : ""}

          <div class="quantity-sheet-fields">
            <div class="quantity-field-group quantity-field-group-basic">
              <label class="field-required">
                结算月份
                <input id="quantitySheetMonth" name="month" type="month" value="${escapeAttr(draft.month || state.billingMonth)}" placeholder="请选择结算月份" required />
              </label>
              <label>
                房间号
                <select name="roomId">
                  <option value="">请选择房间号</option>
                  ${visibleRooms()
                    .map((room) => `<option value="${escapeAttr(room.id)}" ${room.id === quantitySheetRoomId(draft) ? "selected" : ""}>${escapeText(room.name)}</option>`)
                    .join("")}
                </select>
              </label>
              <label>
                管理员
                <input name="manager" value="${escapeAttr(managerValue)}" placeholder="请输入管理员姓名" />
              </label>
            </div>
            <div class="quantity-field-group quantity-field-group-project">
              <label class="field-required">
                IACUC 编号
                ${renderIacucLookupInput("iacuc", draft.iacuc, { required: true })}
              </label>
              <label class="wide field-auto">
                项目名称
                <input name="project" value="${escapeAttr(draft.project)}" placeholder="选择 IACUC 后自动填充，也可手动输入" />
              </label>
              <label class="field-auto">
                支撑经费
                <input name="funding" value="${escapeAttr(draft.funding)}" placeholder="选择 IACUC 后自动填充" />
              </label>
              <label class="field-auto">
                项目负责人
                <input name="pi" value="${escapeAttr(draft.pi)}" placeholder="选择 IACUC 后自动填充" />
              </label>
              <label class="field-auto">
                实验负责人
                <input name="owner" value="${escapeAttr(draft.owner)}" placeholder="选择 IACUC 后自动填充" />
              </label>
            </div>
            <div class="quantity-field-group quantity-field-group-billing">
              ${
                isAnimalBilling
                  ? `
                    <label class="field-required">
                      月初结余动物数
                      <input name="initialAnimalCount" type="number" min="0" value="${draft.initialAnimalCount ?? 0}" placeholder="请输入月初动物数" />
                    </label>
                  `
                  : ""
              }
              <label class="field-required">
                月初结余笼数
                <input name="initialCageCount" type="number" min="0" value="${draft.initialCageCount ?? 0}" placeholder="请输入月初笼数" />
              </label>
              <label>
                计费口径
                <input value="${escapeAttr(billingUnitLabel(quantityProfile.unit))}" disabled />
                <input type="hidden" name="billingUnit" value="${escapeAttr(quantityProfile.unit)}" />
              </label>
            </div>
            <div class="room-billing-hint">
              <span>${escapeText(facilityLabel(quantityProfile.facility))}</span>
              <span>${escapeText(billingItemLabel(quantityProfile.billingItem))}</span>
              <span>${escapeText(customerTypeLabel(quantityProfile.customerType))}</span>
              <span>单价 ¥${MONEY_FORMAT.format(quantityProfile.unitPrice)} / ${escapeText(billingUnitLabel(quantityProfile.unit))}</span>
            </div>
          </div>
          <div class="table-wrap quantity-entry-wrap">
            <table class="quantity-entry-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>新增类型</th>
                  <th>新增</th>
                  <th>减少类型</th>
                  <th>减少</th>
                  <th>${isAnimalBilling ? "结余动物数" : "结余笼数"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${draft.rows.map((row, index) => renderQuantitySheetRow(row, index)).join("")}
              </tbody>
            </table>
          </div>
          <button id="addQuantitySheetRow" class="secondary" type="button">${iconSvg("plus")}添加变更行</button>
        </form>

        <div class="quantity-preview-section">
          <div class="panel-head compact">
            <div>
              <h2>结算预览</h2>
              <p>预览会按同月同项目负责人名下全部统计表汇总展开。</p>
            </div>
          </div>
          <div class="statement-summary compact-summary">
            ${summaryTile("项目负责人", statement.pi || draft.pi || "-")}
            ${summaryTile("伦理编号", statement.iacucs.length ? statement.iacucs.join("、") : "-")}
            ${summaryTile("免费笼数/天", statement.freeCageAllowance)}
            ${summaryTile("累计笼日", statement.totalCageDays)}
            ${summaryTile("累计动物日", statement.totalAnimalDays || 0)}
            ${summaryTile("收费笼日", statement.totalBillableCageDays)}
            ${summaryTile("应收金额", `¥${MONEY_FORMAT.format(statement.totalAmount)}`)}
          </div>
          <div class="table-wrap mini-statement">
            <table>
              <thead><tr><th>日期</th><th>数量</th><th>收费数量</th><th>费用</th></tr></thead>
              <tbody>${statement.rows.filter((row) => row.cageCount || row.animalCount).map(renderQuantityPreviewRow).join("") || `<tr><td colspan="4">录入月初结余或变更行后显示明细</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderBillingWorkflowPanel() {
  const items = filteredBillingWorkflows();
  const workflowLoading = remotePersistence && lazyDataState.billingWorkflowsLoading && !state.billingWorkflows.length;
  const counts = {
    todo: state.billingWorkflows.filter((item) => workflowIsTodo(item)).length,
    done: state.billingWorkflows.filter((item) => item.workflowStatus === "submitted_to_finance").length,
    all: state.billingWorkflows.length,
  };
  return `
    <section class="workflow-center-panel">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>结算流程跟踪</h2>
            <p>按项目负责人汇总单据跟踪发送、签回和交财务进度；单据内可包含多个伦理号，发送后重生成为修订版并自动保留旧版本留痕。</p>
          </div>
          <div class="toolbar workflow-filter-toolbar">
            <button class="segmented ${state.billingWorkflowFilter === "todo" ? "active" : ""}" type="button" data-workflow-filter="todo">待办 ${counts.todo}</button>
            <button class="segmented ${state.billingWorkflowFilter === "all" ? "active" : ""}" type="button" data-workflow-filter="all">全部 ${counts.all}</button>
            <button class="segmented ${state.billingWorkflowFilter === "done" ? "active" : ""}" type="button" data-workflow-filter="done">已完成 ${counts.done}</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="workflow-table">
            <thead>
              <tr>
                <th>结算月份</th>
                <th>项目负责人</th>
                <th>来源</th>
                <th>当前状态</th>
                <th>版本</th>
                <th>应收金额</th>
                <th>最近更新</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${
                workflowLoading
                  ? `<tr><td colspan="8">正在加载结算流程。</td></tr>`
                  : items.length
                  ? items.map(renderBillingWorkflowRow).join("")
                  : `<tr><td colspan="8">当前筛选下没有结算流程。</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderBillingWorkflowRow(item) {
  const currentVersion = item.currentVersion || {};
  const summary = currentVersion.summary || {};
  const nextStatus = nextWorkflowStatus(item.workflowStatus);
  const scopeLabel = item.scopeType === "pi" ? item.pi || item.scopeKey?.replace(/^pi::/, "") || "-" : item.iacuc || "-";
  const iacucList = Array.isArray(item.iacucs) ? item.iacucs.filter(Boolean) : [];
  const iacucLabel = iacucList.length ? iacucList.join("、") : item.iacuc || "-";
  return `
    <tr class="workflow-row" data-open-workflow="${escapeAttr(item.id)}">
      <td>${escapeText(item.month || "-")}</td>
      <td class="workflow-principal-cell">
        <strong>${escapeText(scopeLabel)}</strong>
        <span>${escapeText(iacucLabel)}</span>
      </td>
      <td>${escapeText(workflowSourceLabel(item.sourceType))}</td>
      <td><span class="pill active">${escapeText(workflowStatusLabel(item.workflowStatus))}</span></td>
      <td>${escapeText(currentVersion.documentNumber || `v${item.currentVersionNo || 0}`)}<br /><span class="muted">v${item.currentVersionNo || 0}</span></td>
      <td>¥${MONEY_FORMAT.format(Number(item.totalAmount || summary.totalAmount || 0))}</td>
      <td>${escapeText(formatLogTime(item.latestEventAt || item.generatedAt || "")) || "-"}</td>
      <td>
        <div class="workflow-row-actions">
          <button class="ghost" type="button" data-open-workflow-button="${escapeAttr(item.id)}">查看</button>
          ${
            nextStatus
              ? `<button class="secondary" type="button" data-advance-workflow="${escapeAttr(item.id)}" data-next-status="${escapeAttr(nextStatus)}">${escapeText(workflowActionLabel(nextStatus))}</button>`
              : `<span class="muted">已完成</span>`
          }
          <button class="ghost danger-text" type="button" data-delete-workflow="${escapeAttr(item.id)}">删除</button>
        </div>
      </td>
    </tr>
  `;
}

function renderBillingWorkflowDetailModal() {
  const detail = state.selectedBillingWorkflowDetail || {};
  const workflow = detail.workflow || {};
  const versions = detail.versions || [];
  const events = detail.events || [];
  const lines = detail.lines || [];
  const currentVersion = workflow.currentVersion || {};
  const statement = currentVersion.statement || {};
  const timeline = workflowTimelineItems(workflow);
  const currentNode = timeline.find((item) => item.state === "current") || timeline.find((item) => item.state === "done") || timeline[0] || {};
  const showStatements = Boolean(state.showWorkflowStatements);
  return `
    <div class="editor-modal-backdrop" id="closeWorkflowDetail"></div>
    <div class="panel detail-panel editor-modal workflow-detail-modal">
      <div class="workflow-modal-head">
        <div>
          <h2>${escapeText(workflow.pi || workflow.scopeKey?.replace(/^pi::/, "") || "结算流程")}</h2>
          <p>${escapeText(workflow.month || "-")} · ${escapeText(workflowSourceLabel(workflow.sourceType))} · 当前版本 ${escapeText(currentVersion.documentNumber || `v${workflow.currentVersionNo || 0}`)}</p>
        </div>
        <div class="workflow-modal-actions">
          <span class="pill active">${escapeText(workflowStatusLabel(workflow.workflowStatus))}</span>
          <button class="ghost danger-text" type="button" data-delete-workflow="${escapeAttr(workflow.id || state.selectedBillingWorkflowId)}">删除流程</button>
          <button class="secondary" type="button" id="closeWorkflowDetailButton">${iconSvg("chevronRight")}关闭</button>
        </div>
      </div>

      <div class="workflow-timeline">
        ${timeline
          .map(
            (item) => `
              <div class="workflow-node ${item.state}">
                <span class="workflow-node-dot"></span>
                <div>
                  <strong>${escapeText(item.label)}</strong>
                  <small>${escapeText(item.time || (item.state === "upcoming" ? "待推进" : item.state === "current" ? "当前节点" : "已完成"))}</small>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>

      <section class="panel workflow-detail-card workflow-overview-card">
        <div class="workflow-current-node">
          <span class="workflow-node-dot"></span>
          <div>
            <span>当前节点</span>
            <strong>${escapeText(currentNode.label || workflowStatusLabel(workflow.workflowStatus))}</strong>
            <small>${escapeText(currentNode.time || "待推进")}</small>
          </div>
        </div>
        <div class="workflow-overview-meta">
          <div><span>结算月份</span><strong>${escapeText(workflow.month || "-")}</strong></div>
          <div><span>来源</span><strong>${escapeText(workflowSourceLabel(workflow.sourceType))}</strong></div>
          <div><span>伦理号数</span><strong>${Array.isArray(workflow.iacucs) ? workflow.iacucs.filter(Boolean).length : 0}</strong></div>
          <div><span>应收金额</span><strong>¥${MONEY_FORMAT.format(Number(workflow.totalAmount || 0))}</strong></div>
        </div>
        <button class="secondary workflow-statement-toggle ${showStatements ? "active" : ""}" type="button" data-toggle-workflow-statements>
          ${iconSvg("receipt")}
          已生成结算单 ${versions.length ? versions.length : ""}
        </button>
      </section>

      ${
        showStatements
          ? `
      <div class="workflow-detail-grid">
        <section class="panel workflow-detail-card">
          <div class="panel-head compact">
            <div>
              <h2>结算单摘要</h2>
              <p>当前有效版本对应的汇总信息。</p>
            </div>
          </div>
          <div class="statement-summary">
            ${summaryTile("项目负责人", workflow.pi || "-")}
            ${summaryTile("结算月份", workflow.month || "-")}
            ${summaryTile("伦理号数", Array.isArray(workflow.iacucs) ? workflow.iacucs.filter(Boolean).length : 0)}
            ${summaryTile("应收金额", `¥${MONEY_FORMAT.format(Number(workflow.totalAmount || 0))}`)}
          </div>
          <div class="workflow-meta-list">
            <div><span>项目名称</span><strong>${escapeText(workflow.project || "-")}</strong></div>
            <div><span>实验负责人</span><strong>${escapeText(workflow.owner || "-")}</strong></div>
            <div><span>支撑经费</span><strong>${escapeText(workflow.funding || "-")}</strong></div>
            <div><span>伦理编号</span><strong>${escapeText((workflow.iacucs || []).join("、") || statement.iacuc || "-")}</strong></div>
          </div>
        </section>

        <section class="panel workflow-detail-card">
          <div class="panel-head compact">
            <div>
              <h2>版本记录</h2>
              <p>发送后修订会生成新版本并保留旧版本作废留痕。</p>
            </div>
          </div>
          <div class="workflow-version-list">
            ${
              versions.length
                ? versions
                    .map(
                      (version) => `
                        <div class="rule-card">
                          <strong>${escapeText(version.documentNumber || `v${version.versionNo}`)}</strong>
                          <span>${escapeText(version.versionStatus === "active" ? "当前有效版本" : "历史作废版本")}</span>
                          <p>${escapeText(workflowStatusLabel(version.workflowStatus))} · ${escapeText(formatLogTime(version.generatedAt)) || "-"}</p>
                          ${version.voidReason ? `<p class="muted">作废原因：${escapeText(version.voidReason)}</p>` : ""}
                        </div>
                      `,
                    )
                    .join("")
                : `<p class="muted">暂无版本记录。</p>`
            }
          </div>
        </section>
      </div>

      <section class="panel workflow-detail-card">
        <div class="panel-head compact">
          <div>
            <h2>流程事件</h2>
            <p>记录生成、发送、签回、交财务和修订等关键动作。</p>
          </div>
        </div>
        <div class="workflow-event-list">
          ${
            events.length
              ? events
                  .map(
                    (event) => `
                      <div class="audit-row">
                        <div>
                          <strong>${escapeText(workflowEventLabel(event.eventType))}</strong>
                          <p class="muted">${escapeText(event.actor?.displayName || "-")} · ${escapeText(formatLogTime(event.at)) || "-"}</p>
                        </div>
                        <span class="muted">${escapeText(event.note || "")}</span>
                      </div>
                    `,
                  )
                  .join("")
              : `<p class="muted">暂无流程事件。</p>`
          }
        </div>
      </section>

      <section class="panel workflow-detail-card">
        <div class="panel-head compact">
          <div>
            <h2>当前结算单明细</h2>
            <p>当前有效版本对应的每日结算内容。</p>
          </div>
        </div>
        <div class="table-wrap workflow-lines-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>笼数</th>
                <th>免费笼数</th>
                <th>收费笼数</th>
                <th>当日费用</th>
                <th>累计费用</th>
              </tr>
            </thead>
            <tbody>
              ${
                lines.length
                  ? lines
                      .filter((line) => Number(line.cageCount || line.animalCount || 0) > 0)
                      .map(
                        (line) => `
                          <tr>
                            <td>${escapeText(line.date || "-")}</td>
                            <td>${Number(line.cageCount || 0)}</td>
                            <td>${Number(line.freeCages || 0)}</td>
                            <td>${Number(line.billableCages || 0)}</td>
                            <td>¥${MONEY_FORMAT.format(Number(line.amount || 0))}</td>
                            <td>¥${MONEY_FORMAT.format(Number(line.cumulative || 0))}</td>
                          </tr>
                        `,
                      )
                      .join("") || `<tr><td colspan="6">当前结算单没有非零明细。</td></tr>`
                  : `<tr><td colspan="6">当前结算单暂无明细。</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
          `
          : ""
      }
    </div>
  `;
}

function summaryTile(label, value) {
  return `
    <div class="summary-tile">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderBillingRow(row) {
  return `
    <tr>
      <td>${row.date}</td>
      <td>${row.cageCount}</td>
      <td>${row.billableCages}</td>
      <td>¥${MONEY_FORMAT.format(row.amount)}</td>
      <td>¥${MONEY_FORMAT.format(row.cumulative)}</td>
    </tr>
  `;
}

function renderQuantitySheetRow(row, index) {
  const showTransferIn = row.addedType === "转入";
  const showTransferOut = row.removedType === "转出";
  const balance = quantitySheetRowBalance(index);
  return `
    <tr data-quantity-row="${index}">
      <td><input name="rowDate" type="date" value="${escapeAttr(row.date)}" placeholder="请选择日期" required /></td>
      <td class="quantity-type-cell">
        <div class="quantity-inline-field">
          <select name="addedType">
            ${["", "购入", "转入", "分笼"].map((value) => `<option value="${value}" ${row.addedType === value ? "selected" : ""}>${value || "请选择"}</option>`).join("")}
          </select>
          ${
            showTransferIn
              ? renderIacucLookupInput("transferInFromIacuc", row.transferInFromIacuc || "", { placeholder: "来源伦理号", compact: true })
              : ""
          }
        </div>
      </td>
      <td><input class="quantity-count-input" name="addedCount" type="number" min="0" value="${row.addedCount ?? ""}" placeholder="0" /></td>
      <td class="quantity-type-cell">
        <div class="quantity-inline-field">
          <select name="removedType">
            ${["", "取材", "死亡", "转出"].map((value) => `<option value="${value}" ${row.removedType === value ? "selected" : ""}>${value || "请选择"}</option>`).join("")}
          </select>
          ${
            showTransferOut
              ? renderIacucLookupInput("transferOutToIacuc", row.transferOutToIacuc || "", { placeholder: "目标伦理号", compact: true })
              : ""
          }
        </div>
      </td>
      <td><input class="quantity-count-input" name="removedCount" type="number" min="0" value="${row.removedCount ?? ""}" placeholder="0" /></td>
      <td>${balance}</td>
      <td><button class="icon-danger" type="button" data-remove-qrow="${index}" title="删除行">${iconSvg("trash")}</button></td>
    </tr>
  `;
}

function quantitySheetRowBalance(rowIndex) {
  const draft = normalizeQuantitySheetDraft(state.quantitySheetDraft || {});
  const profile = billingProfileForRoom(state.rooms.find((room) => room.id === quantitySheetRoomId(draft)) || {});
  let current = profile.unit === "animal_day" ? numericOrZero(draft.initialAnimalCount) : numericOrZero(draft.initialCageCount);
  for (let index = 0; index <= rowIndex; index += 1) {
    const row = draft.rows[index];
    if (!row) break;
    current = Math.max(current + numericOrZero(row.addedCount) - numericOrZero(row.removedCount), 0);
  }
  return current;
}

function renderQuantityPreviewRow(row) {
  const isAnimalRow = numericOrZero(row.animalCount) > 0 && numericOrZero(row.cageCount) === 0;
  return `
    <tr>
      <td>${row.date}</td>
      <td>${isAnimalRow ? row.animalCount : row.cageCount}</td>
      <td>${isAnimalRow ? row.billableAnimals : row.billableCages}</td>
      <td>¥${MONEY_FORMAT.format(row.amount)}</td>
    </tr>
  `;
}

function renderAdjustment(item) {
  const valueLabel = item.type === "free_cages" ? `${principalTypeLabel(item.principalType)} · ${item.value} 笼/天免费` : item.type === "discount" ? `${item.value}% 减免` : item.value;
  return `
    <div class="rule-card">
      <strong>${item.targetId}</strong>
      <span>${valueLabel}</span>
      <p>${item.reason}</p>
    </div>
  `;
}

function renderRoomManagementView() {
  const rackDraft = currentRackFormDraft();
  const rackFormRoomId = rackDraft.roomId;
  const canManageRooms = !remotePersistence || currentUser?.role === "admin";
  const editingRoom = state.editingRoomId ? state.rooms.find((room) => room.id === state.editingRoomId) : null;
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>饲养间与笼架</h2>
            <p>饲养间下可维护多个笼架，每个笼架可设置独立行列数。</p>
          </div>
          ${canManageRooms ? `<button id="resetDemo" class="secondary">${iconSvg("refresh")}重置示例数据</button>` : ""}
        </div>
        <div class="room-list">
          ${visibleRooms().map(renderRoomCard).join("") || `<p class="muted">当前账号没有授权饲养间。</p>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>编辑操作</h2>
            <p>默认展示预览，点击按钮后弹出对应编辑窗口。</p>
          </div>
        </div>
        <div class="form-actions">
          ${canManageRooms ? `<button class="secondary" type="button" id="openRoomForm">${iconSvg("plus")}新增饲养间</button>` : ""}
          <button class="secondary" type="button" id="openRackForm" ${visibleRooms().length ? "" : "disabled"}>${iconSvg("plus")}新增笼架</button>
        </div>
      </div>
      ${
        canManageRooms && state.showRoomForm
          ? renderRoomForm(editingRoom)
          : ""
      }
      ${
        state.showRackForm
          ? `
            <div class="editor-modal-backdrop" id="closeRackForm"></div>
            <div class="panel detail-panel editor-modal">
              <div class="editor-modal-actions">
                <button class="secondary" type="button" id="closeRackFormButton">${iconSvg("chevronRight")}关闭编辑</button>
              </div>
              <div class="panel-head compact">
                <div>
                  <h2>新增笼架</h2>
                  <p>给已创建饲养间添加一个独立规格的笼架。</p>
                </div>
              </div>
              <form id="rackForm" class="form">
                <label class="field-required">
                  所属饲养间
                  <select name="roomId" required>
                    <option value="" disabled ${visibleRooms().length ? "" : "selected"}>请选择饲养间</option>
                    ${visibleRooms()
                      .map((room) => `<option value="${escapeAttr(room.id)}" ${room.id === rackFormRoomId ? "selected" : ""}>${escapeText(room.name)}</option>`)
                      .join("")}
                  </select>
                </label>
                <label class="field-required">
                  笼架编号
                  <input type="number" name="index" min="1" value="${suggestedRackIndex(rackFormRoomId)}" placeholder="请输入笼架编号" required />
                </label>
                <div class="form-row">
                  <label class="field-required">
                    行数 X
                    <input type="number" name="rows" min="1" value="${escapeAttr(rackDraft.rows)}" placeholder="请输入行数" required />
                  </label>
                  <label class="field-required">
                    列数 Y
                    <input type="number" name="cols" min="1" value="${escapeAttr(rackDraft.cols)}" placeholder="请输入列数" required />
                  </label>
                </div>
                <button class="primary" type="submit">${iconSvg("plus")}新增笼架</button>
              </form>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderRoomForm(room) {
  const isEditing = Boolean(room);
  const normalized = normalizeRoomDefaults(room || {});
  const profile = billingProfileForRoom(normalized);
  return `
    <div class="editor-modal-backdrop" id="closeRoomForm"></div>
    <div class="panel detail-panel editor-modal">
      <div class="editor-modal-actions">
        <button class="secondary" type="button" id="closeRoomFormButton">${iconSvg("chevronRight")}关闭编辑</button>
      </div>
      <div class="panel-head compact">
        <div>
          <h2>${isEditing ? "编辑饲养间" : "新增饲养间"}</h2>
          <p>${isEditing ? "修改饲养间基础信息和默认计费配置。" : "先建立饲养间，再按实际摆放新增笼架。"}</p>
        </div>
      </div>
      <form id="roomForm" class="form">
        <input type="hidden" name="roomId" value="${escapeAttr(room?.id || "")}" />
        <label class="field-required">
          饲养间名称
          <input name="name" required value="${escapeAttr(room?.name || "")}" placeholder="请输入饲养间名称，如 SPF 小鼠饲养间 C" />
        </label>
        <label>
          区域
          <input name="area" value="${escapeAttr(room?.area || "")}" placeholder="请输入区域，如 屏障区" />
        </label>
        <div class="form-row">
          <label class="field-required">
            所属设施
            <select name="facility" required>
              ${optionList(FACILITY_OPTIONS, normalized.facility || "zhujiang")}
            </select>
          </label>
          <label class="field-required">
            默认动物
            <select name="defaultSpecies" required>
              ${optionList(SPECIES_OPTIONS, normalized.defaultSpecies || "mouse")}
            </select>
          </label>
        </div>
        <label class="field-required">
          默认收费项目
          <select name="defaultBillingItem" required>
            ${optionList(BILLING_ITEM_OPTIONS, profile.billingItem || "mouse_standard")}
          </select>
        </label>
        <div class="form-row">
          <label class="field-required">
            默认院内/院外
            <select name="defaultCustomerType" required>
              ${optionList(CUSTOMER_TYPE_OPTIONS, profile.customerType || "internal")}
            </select>
          </label>
          <label class="field-required">
            默认每笼只数
            <input name="defaultAnimalCount" type="number" min="1" value="${escapeAttr(normalized.defaultAnimalCount || 1)}" placeholder="请输入默认每笼动物数" required />
          </label>
        </div>
        <div class="room-billing-hint">
          <span>${escapeText(facilityLabel(normalized.facility))}</span>
          <span>${escapeText(billingItemLabel(profile.billingItem))}</span>
          <span>${escapeText(customerTypeLabel(profile.customerType))}</span>
          <span>${escapeText(billingPriceLabel(profile))}</span>
        </div>
        <button class="primary" type="submit">${iconSvg(isEditing ? "save" : "plus")}${isEditing ? "保存饲养间" : "新增饲养间"}</button>
      </form>
    </div>
  `;
}

function renderUserManagementView() {
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>账号管理</h2>
            <p>查看系统管理员和房间管理员账号。</p>
          </div>
        </div>
        <div class="user-list">
          ${users.map(renderUserRow).join("") || `<p class="muted">暂无账号。</p>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head compact">
          <div>
            <h2>创建账号</h2>
            <p>为各饲养间管理员创建独立账号。</p>
          </div>
        </div>
        <form id="userForm" class="form">
          <label class="field-required">
            用户名
            <input name="username" required placeholder="请输入登录名，如 room_a_admin" />
          </label>
          <label class="field-required">
            显示姓名
            <input name="displayName" required placeholder="请输入显示姓名，如 SPF A 管理员" />
          </label>
          <label class="field-required">
            初始密码
            <input name="password" type="password" placeholder="请输入初始密码" required />
          </label>
          <label>
            角色
            <select name="role">
              <option value="room_admin">房间管理员</option>
              <option value="admin">系统管理员</option>
            </select>
          </label>
          <div class="user-room-access user-room-access-create">
            <div class="user-room-access-title">饲养间授权</div>
            ${renderRoomAccessDropdown([])}
          </div>
          <button class="primary" type="submit">${iconSvg("plus")}创建账号</button>
        </form>
      </div>
    </section>
  `;
}

function renderRoomAccessDropdown(selectedRoomIds = [], options = {}) {
  const selectedSet = new Set(selectedRoomIds || []);
  const selectedRooms = state.rooms.filter((room) => selectedSet.has(room.id));
  const disabled = options.disabled ? "disabled" : "";
  const summary = options.admin
    ? "系统管理员默认全部饲养间"
    : formatRoomAccessSummary(selectedRooms.map((room) => room.name));
  return `
    <details class="room-access-dropdown ${disabled}" data-room-access-dropdown data-room-access-locked="${options.locked ? "true" : "false"}">
      <summary data-room-access-summary>${escapeText(summary)}</summary>
      <div class="room-access-options">
        <p class="room-access-note">房间管理员仅可编辑选择的饲养间。</p>
        ${
          state.rooms
            .map(
              (room) => `
                <label>
                  <input
                    type="checkbox"
                    name="roomIds"
                    value="${escapeAttr(room.id)}"
                    data-room-name="${escapeAttr(room.name)}"
                    ${selectedSet.has(room.id) ? "checked" : ""}
                    ${disabled}
                  />
                  <span>${escapeText(room.name)}</span>
                </label>
              `,
            )
            .join("") || `<span class="muted">暂无饲养间。</span>`
        }
      </div>
    </details>
  `;
}

function formatRoomAccessSummary(roomNames) {
  if (!roomNames.length) return "请选择授权饲养间";
  const visibleNames = roomNames.slice(0, 2).join("、");
  return roomNames.length > 2 ? `已选择 ${roomNames.length} 个：${visibleNames} 等` : `已选择 ${roomNames.length} 个：${visibleNames}`;
}

function renderDataManagementView() {
  return `
    <section class="content-grid">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>数据管理</h2>
            <p>维护系统外部数据源和后续导入导出任务。</p>
          </div>
        </div>
        ${renderIacucStatusCard()}
        ${renderPrincipalIdentityPanel()}
      </div>
      <div class="panel">
        ${renderIacucAdminPanel()}
      </div>
    </section>
  `;
}

function renderSystemManagementView() {
  return `
    <section class="system-layout">
      <div class="panel large">
        <div class="panel-head">
          <div>
            <h2>关于系统</h2>
            <p>查看系统状态、版本更新和系统 Wiki。</p>
          </div>
        </div>
        ${renderSystemUpdateCard()}
        ${renderReleaseNotes()}
      </div>
      <div class="system-side">
        <div class="panel">
          ${renderSystemWikiHomeCard()}
        </div>
      </div>
    </section>
  `;
}

function renderIacucStatusCard() {
  return `
    <div class="rule-card">
      <strong>IACUC 索引</strong>
      <span>${iacucIndexMeta?.count ?? IACUC_INDEX.length} 条记录</span>
      <p>${iacucIndexMeta?.updatedAt ? `最后更新：${escapeText(formatLogTime(iacucIndexMeta.updatedAt))}` : "尚未上传索引文件。"}</p>
      <p>索引用于录入笼位和生成结算单时自动匹配项目名称、项目负责人、实验负责人和支撑经费。</p>
    </div>
  `;
}

function renderPrincipalIdentityPanel() {
  const loading = remotePersistence && lazyDataState.principalIdentitiesLoading && !lazyDataState.principalIdentitiesLoaded;
  const allItems = principalIdentityRows();
  const items = filteredPrincipalIdentityRows(allItems);
  return `
    <div class="system-section">
      <div class="panel-head compact">
        <div>
          <h2>项目负责人身份</h2>
          <p>默认按独立科研人员计算 10 笼/天免费；需要减免 20 笼/天的负责人改为 PI。</p>
        </div>
      </div>
      <div class="toolbar">
        <input id="principalIdentityFilter" type="search" value="${escapeAttr(state.principalIdentityFilter)}" placeholder="检索姓名、PI、独立科研人员、10 或 20" />
        <button id="applyPrincipalIdentityFilter" class="secondary" type="button">${iconSvg("search")}检索</button>
        <button id="clearPrincipalIdentityFilter" class="secondary" type="button">清空</button>
        <span class="muted">${loading ? "正在加载负责人身份" : `${items.length} / ${allItems.length} 人`}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目负责人</th>
              <th>IACUC 数</th>
              <th>负责人身份</th>
              <th>免费笼数/天</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length
                ? items.map(renderPrincipalIdentityRow).join("")
                : `<tr><td colspan="5">${allItems.length ? "没有匹配的项目负责人。" : "上传 IACUC 汇总表后显示项目负责人。"}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPrincipalIdentityRow(item) {
  const principalType = normalizePrincipalType(item.principalType);
  return `
    <tr>
      <td>${escapeText(item.pi)}</td>
      <td>${item.iacucCount}</td>
      <td>
        <select data-principal-type="${escapeAttr(item.pi)}">
          <option value="${BILLING_PRINCIPAL_INDEPENDENT}" ${principalType === BILLING_PRINCIPAL_INDEPENDENT ? "selected" : ""}>独立科研人员</option>
          <option value="${BILLING_PRINCIPAL_PI}" ${principalType === BILLING_PRINCIPAL_PI ? "selected" : ""}>PI</option>
        </select>
      </td>
      <td>${freeCageAllowanceForPrincipalType(principalType)}</td>
      <td><button class="secondary" type="button" data-save-principal="${escapeAttr(item.pi)}">${iconSvg("save")}保存</button></td>
    </tr>
  `;
}

function renderSystemUpdateCard() {
  const info = systemUpdateInfo;
  const statusText = updateStatusText(info);

  return `
    <div class="rule-card update-card">
      <strong>系统更新</strong>
      <span>${escapeText(statusText)}</span>
      <p>系统版本：${escapeText(systemInfo.version ? `v${systemInfo.version}` : "未设置")}</p>
      <p>所属单位：${escapeText(systemInfo.organization || "-")} · ${escapeText(systemInfo.department || "-")}</p>
      <p>开发人员：${escapeText(systemInfo.developer || "-")} · ${escapeText(systemInfo.contactEmail || "-")}</p>
      <p>开源协议：${escapeText(systemInfo.license || "-")}</p>
      <p>版权信息：${escapeText(systemInfo.copyright || "-")}</p>
      ${info?.latestVersion ? `<p>最新发布版：v${escapeText(info.latestVersion)}${info.latestMessage ? ` · ${escapeText(info.latestMessage)}` : ""}</p>` : ""}
      <p>当前运行版本：${escapeText(systemInfo.version ? `v${systemInfo.version}` : "未设置")}</p>
      ${info?.latestUrl ? `<p><a href="${escapeAttr(info.latestUrl)}" target="_blank" rel="noreferrer">查看最新发布页</a></p>` : ""}
      ${info?.checkedAt ? `<p>检查时间：${escapeText(formatLogTime(info.checkedAt))}</p>` : ""}
      ${info?.error ? `<p class="error-text">${escapeText(info.error)}</p>` : ""}
      <div class="update-card-actions">
        <button id="clearClientCache" class="secondary" type="button">${iconSvg("refresh")}清理本地缓存并刷新</button>
        <button id="checkSystemUpdate" class="secondary" type="button">${iconSvg("refresh")}${info?.loading ? "检查中" : "检查更新"}</button>
      </div>
    </div>
  `;
}

function renderReleaseNotes() {
  return `
    <div class="system-section">
      <div class="panel-head compact">
        <div>
          <h2>更新记录</h2>
          <p>记录当前系统主要版本变化。</p>
        </div>
      </div>
      <div class="release-list">
        ${SYSTEM_RELEASE_NOTES.map(renderReleaseNote).join("")}
      </div>
    </div>
  `;
}

function renderReleaseNote(note) {
  return `
    <article class="release-card">
      <div>
        <strong>v${escapeText(note.version)}</strong>
        <span>${escapeText(note.title)}</span>
      </div>
      <ul>
        ${note.items.map((item) => `<li>${renderReleaseItem(item)}</li>`).join("")}
      </ul>
      ${note.note ? `<p class="release-note-meta"><strong>备注：</strong>${renderReleaseItem(note.note)}</p>` : ""}
    </article>
  `;
}

function renderReleaseItem(item) {
  const escaped = escapeText(item);
  return escaped.replace(/(@[^\s，。；、]+)/g, '<span class="mention-theme">$1</span>');
}

function renderSystemWikiHomeCard() {
  return `
    <div class="panel-head compact">
      <div>
        <h2>系统 Wiki</h2>
        <p>统一查看用户手册、部署说明、API 与开发维护文档。</p>
      </div>
    </div>
    <div class="wiki-home-card">
      <div class="wiki-home-hero">
        ${iconSvg("book")}
        <div>
          <strong>CageLedger Wiki</strong>
          <span>面向使用者、管理员和开发维护者的单一文档入口。</span>
        </div>
      </div>
      <div class="wiki-home-groups">
        <div>
          <strong>使用者</strong>
          <span>快速开始、用户手册、笼卡、笼位、饲养费</span>
        </div>
        <div>
          <strong>管理员</strong>
          <span>部署、配置、权限、IACUC、备份、排障</span>
        </div>
        <div>
          <strong>开发维护者</strong>
          <span>项目结构、API、发布链、开发规范</span>
        </div>
      </div>
      <a class="doc-link" href="${escapeAttr(SYSTEM_WIKI_URL)}" target="_blank" rel="noreferrer">
        <strong>打开系统 Wiki</strong>
        <span>进入 Gitea Wiki 查看全部正式文档。</span>
      </a>
    </div>
  `;
}

function updateStatusText(info) {
  if (!info) return "尚未检查远端版本。";
  if (info.loading) return "正在检查远端版本。";
  if (info.error) return "检查失败";
  if (info.disabled) return "最新发布版检查已关闭";
  if (info.updateAvailable === true) return "发现新版本";
  if (info.updateAvailable === false) return "当前已是最新版本";
  return "已获取最新发布版，当前运行版本未知";
}

function renderIacucAdminPanel() {
  return `
    <div class="panel-head compact">
      <div>
        <h2>IACUC 索引</h2>
        <p>上传 CSV 汇总表后，用于自动回填项目名称、项目负责人和实验负责人。</p>
      </div>
    </div>
    <form id="iacucUploadForm" class="form">
          <label class="field-required">
            动物实验申请汇总表 CSV
        <input name="file" type="file" accept=".csv,text/csv" required />
      </label>
      <button class="primary" type="submit">${iconSvg("upload")}上传并生成索引</button>
    </form>
    <p class="muted iacuc-index-status">
      当前索引：${iacucIndexMeta?.count ?? IACUC_INDEX.length} 条${iacucIndexMeta?.updatedAt ? ` · ${escapeText(formatLogTime(iacucIndexMeta.updatedAt))}` : ""}
    </p>
  `;
}

function renderUserRow(user) {
  const isCurrent = currentUser?.id === user.id;
  return `
    <form class="user-row user-edit-form" data-user-id="${escapeAttr(user.id)}">
      <div class="user-fields">
        <label>
          登录名
          <input name="username" value="${escapeAttr(user.username)}" placeholder="请输入登录名" ${isCurrent ? "disabled" : "required"} />
        </label>
        <label>
          显示姓名
          <input name="displayName" value="${escapeAttr(user.displayName)}" placeholder="请输入显示姓名" ${isCurrent ? "disabled" : "required"} />
        </label>
        <label>
          新密码
          <input name="password" type="password" placeholder="请输入新密码，留空不修改" ${isCurrent ? "disabled" : ""} />
        </label>
        <label>
          角色
          <select name="role" ${isCurrent ? "disabled" : ""}>
            <option value="room_admin" ${user.role === "room_admin" ? "selected" : ""}>房间管理员</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>系统管理员</option>
          </select>
        </label>
        <div class="user-room-access">
          <div class="user-room-access-title">饲养间授权</div>
          ${renderRoomAccessDropdown(user.roomIds, {
            disabled: isCurrent || user.role === "admin",
            admin: user.role === "admin",
            locked: isCurrent,
          })}
        </div>
      </div>
      <div class="user-row-actions">
        ${
          isCurrent
            ? `<span class="muted">当前账号</span>`
            : `
              <button class="secondary" type="submit">${iconSvg("save")}保存</button>
              <button class="icon-danger" type="button" data-delete-user="${escapeAttr(user.id)}" aria-label="删除 ${escapeAttr(user.displayName)}">${iconSvg("trash")}</button>
            `
        }
      </div>
    </form>
  `;
}

function renderAuditView() {
  const logs = state.auditLogs || [];
  const loading = remotePersistence && lazyDataState.auditLogsLoading && !logs.length;
  return `
    <section class="panel large">
      <div class="panel-head">
        <div>
          <h2>操作日志</h2>
          <p>记录账号、动作、笼位和时间，便于追溯。</p>
        </div>
      </div>
      <div class="audit-list">
        ${
          loading
            ? `<div class="empty-state">${iconSvg("receipt")}<h2>正在加载操作日志</h2></div>`
            : logs.length
            ? logs.map(renderAuditLog).join("")
            : `<div class="empty-state">${iconSvg("receipt")}<h2>暂无操作日志</h2></div>`
        }
      </div>
    </section>
  `;
}

function renderAuditLog(log) {
  const actor = log.actorDisplayName || "未记录账号";
  return `
    <div class="audit-row">
      <div>
        <strong>${escapeText(log.message || "操作记录")}</strong>
        <p>${escapeText(actor)} · ${escapeText(log.action || "manual")}</p>
      </div>
      <time>${escapeText(formatLogTime(log.at))}</time>
    </div>
  `;
}

function renderRoomCard(room) {
  const normalizedRoom = normalizeRoomDefaults(room);
  const racks = racksForRoom(room.id);
  const summary = roomSummaryById(room.id);
  const slots = slotsForRoom(room.id);
  const slotCount = summary ? numericOrZero(summary.slotCount) : slots.length;
  const active = summary ? numericOrZero(summary.activeCount) : slots.filter((slot) => slot.status === "active").length;
  const reserved = summary ? numericOrZero(summary.reservedCount) : slots.filter((slot) => slot.status === "reserved").length;
  const canManageRooms = !remotePersistence || currentUser?.role === "admin";
  const profile = billingProfileForRoom(normalizedRoom);

  return `
    <div class="room-tree">
      <div class="room-tree-head">
        <div>
          <h3>${room.name}</h3>
          <p>${room.area || "未设置区域"} · ${facilityLabel(normalizedRoom.facility)} · ${billingItemLabel(profile.billingItem)} · ${billingUnitLabel(profile.unit)} · ${billingPriceLabel(profile)}</p>
        </div>
        <div class="tree-actions">
          <span>${slotCount} 笼位</span>
          <span>${active} 在用</span>
          <span>${reserved} 预约</span>
          ${
            canManageRooms
              ? `
                <button type="button" class="secondary compact-action" data-edit-room="${room.id}" title="编辑饲养间" aria-label="编辑饲养间 ${room.name}">
                  ${iconSvg("edit")}编辑
                </button>
                <button type="button" class="icon-danger" data-delete-room="${room.id}" title="删除饲养间" aria-label="删除饲养间 ${room.name}">
                  ${iconSvg("trash")}
                </button>
              `
              : ""
          }
        </div>
      </div>
      <div class="rack-tree">
        ${racks.map((rack) => renderRackTreeItem(room, rack)).join("")}
      </div>
    </div>
  `;
}

function renderRackTreeItem(room, rack) {
  const summary = rackSummaryById(rack.id);
  const slots = slotsForRack(rack.id);
  const slotCount = summary ? numericOrZero(summary.slotCount) : slots.length;
  const active = summary ? numericOrZero(summary.activeCount) : slots.filter((slot) => slot.status === "active").length;
  const reserved = summary ? numericOrZero(summary.reservedCount) : slots.filter((slot) => slot.status === "reserved").length;

  return `
    <div class="rack-tree-item">
      <div class="rack-name">
        <span class="tree-branch"></span>
        <strong>笼架 ${rackCode(rack)}</strong>
        <small>${rack.rows} 行 * ${rack.cols} 列</small>
      </div>
      <div class="tree-actions">
        <span>${slotCount} 笼位</span>
        <span>${active} 在用</span>
        <span>${reserved} 预约</span>
        <button type="button" class="secondary compact-action" data-edit-rack="${rack.id}" title="编辑笼架" aria-label="编辑 ${room.name} 笼架 ${rackCode(rack)}">
          ${iconSvg("edit")}编辑
        </button>
        <button type="button" class="icon-danger" data-delete-rack="${rack.id}" title="删除笼架" aria-label="删除 ${room.name} 笼架 ${rackCode(rack)}">
          ${iconSvg("trash")}
        </button>
      </div>
      ${state.editingRackId === rack.id ? renderRackEditForm(room, rack) : ""}
    </div>
  `;
}

function renderRackEditForm(room, rack) {
  return `
    <form class="rack-edit-form" data-rack-edit-form="${escapeAttr(rack.id)}">
      <input type="hidden" name="rackId" value="${escapeAttr(rack.id)}" />
      <label class="field-required">
        编号
        <input type="number" name="index" min="1" value="${escapeAttr(rack.index)}" required />
      </label>
      <label class="field-required">
        行数 X
        <input type="number" name="rows" min="1" value="${escapeAttr(rack.rows)}" required />
      </label>
      <label class="field-required">
        列数 Y
        <input type="number" name="cols" min="1" value="${escapeAttr(rack.cols)}" required />
      </label>
      <div class="rack-edit-actions">
        <button class="primary" type="submit">${iconSvg("save")}保存</button>
        <button class="secondary" type="button" data-cancel-rack-edit="${escapeAttr(rack.id)}">取消</button>
      </div>
    </form>
  `;
}

function bindEvents() {
  decorateRequiredFields();
  document.querySelector("#logoutButton")?.addEventListener("click", logout);
  document.querySelector("#sidebarToggle")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    render();
  });
  document.querySelector("#settingsNavToggle")?.addEventListener("click", () => {
    const settingsViews = ["rooms", "data", "users", "system", "logs"];
    if (!settingsViews.includes(state.activeView)) {
      state.activeView = state.lastSettingsView || "rooms";
      state.settingsNavExpanded = true;
    } else {
      state.settingsNavExpanded = !state.settingsNavExpanded;
    }
    render();
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeView = button.dataset.view;
      if (["rooms", "data", "users", "system", "logs"].includes(state.activeView)) {
        state.lastSettingsView = state.activeView;
        state.settingsNavExpanded = false;
      } else {
        state.settingsNavExpanded = false;
      }
      render();
      try {
        await ensureViewDataLoaded(state.activeView);
      } catch (error) {
        reportSaveError(error);
      }
      render();
    });
  });

  document.querySelector("#roomSelect")?.addEventListener("change", async (event) => {
    state.selectedRoomId = event.target.value;
    state.selectedRackId = state.racks.find((rack) => rack.roomId === state.selectedRoomId)?.id;
    state.selectedSlotId = "";
    state.selectedSlotIds = [];
    if (remotePersistence) {
      try {
        await loadRoomInfrastructure(state.selectedRoomId);
      } catch (error) {
        reportSaveError(error);
      }
    }
    render();
  });

  document.querySelector("#rackSelect")?.addEventListener("change", (event) => {
    state.selectedRackId = event.target.value;
    state.selectedSlotId = state.slots.find((slot) => slot.rackId === state.selectedRackId)?.id;
    state.selectedSlotIds = [];
    render();
  });

  document.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => startBatchSlotDrag(event, button));
    button.addEventListener("click", () => {
      if (suppressNextSlotClick) {
        suppressNextSlotClick = false;
        return;
      }
      if (state.batchMode) {
        toggleBatchSlot(button.dataset.slot);
      } else {
        state.selectedSlotId = button.dataset.slot;
        state.selectedSlotIds = [];
      }
      render();
    });
    button.addEventListener("mouseenter", () => showSlotHoverPreview(button));
    button.addEventListener("mousemove", () => positionSlotHoverPreview(button));
    button.addEventListener("mouseleave", hideSlotHoverPreview);
    button.addEventListener("focus", () => showSlotHoverPreview(button));
    button.addEventListener("blur", hideSlotHoverPreview);
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.slotFilter = button.dataset.filter;
      state.selectedSlotIds = [];
      render();
    });
  });

  document.querySelector("#batchModeToggle")?.addEventListener("click", () => {
    state.batchMode = !state.batchMode;
    state.selectedSlotIds = state.batchMode && state.selectedSlotId ? [state.selectedSlotId] : [];
    render();
  });
  document.querySelector("#selectVisibleSlots")?.addEventListener("click", selectVisibleSlots);
  document.querySelector("#clearBatchSelection")?.addEventListener("click", () => {
    state.selectedSlotIds = [];
    render();
  });
  document.querySelector("#slotForm")?.addEventListener("submit", handleSlotSubmit);
  bindIacucLookupInputs("#slotForm", autofillIacucFields);
  bindFeedingPeriodInputs("#slotForm");
  bindMonkeyAgeField("#slotForm");
  document.querySelector("#batchSlotForm")?.addEventListener("submit", handleBatchSlotSubmit);
  bindIacucLookupInputs("#batchSlotForm", autofillIacucFields);
  bindFeedingPeriodInputs("#batchSlotForm");
  document.querySelector("#openSampleSlot")?.addEventListener("click", () => openSampling("single"));
  document.querySelector("#openSampleBatchSlots")?.addEventListener("click", () => openSampling("batch"));
  document.querySelector("#confirmSampleSlot")?.addEventListener("click", sampleSelectedSlot);
  document.querySelector("#confirmSampleBatchSlots")?.addEventListener("click", sampleBatchSlots);
  document.querySelector("#cancelSampling")?.addEventListener("click", () => {
    state.samplingMode = "";
    render();
  });
  document.querySelector("#clearSlot")?.addEventListener("click", clearSelectedSlot);
  document.querySelector("#clearBatchSlots")?.addEventListener("click", clearBatchSlots);
  document.querySelectorAll("[data-open-cage-editor]").forEach((button) => {
    button.addEventListener("click", openCageEditor);
  });
  document.querySelector("#closeCageEditor")?.addEventListener("click", () => {
    state.showCageEditor = false;
    render();
  });
  document.querySelector("#closeCageEditorButton")?.addEventListener("click", () => {
    state.showCageEditor = false;
    render();
  });
  positionCageEditorPopover();
  window.onresize = () => {
    positionCageEditorPopover();
  };
  document.querySelectorAll("[data-billing-source]").forEach((button) => {
    button.addEventListener("click", async () => {
      captureQuantitySheetDraft();
      state.billingSource = button.dataset.billingSource;
      render();
      if (state.activeView === "billing") {
        try {
          await ensureViewDataLoaded("billing");
        } catch (error) {
          reportSaveError(error);
        }
      }
      render();
    });
  });
  document.querySelector("#billingMonth")?.addEventListener("change", (event) => {
    state.billingMonth = event.target.value;
    render();
  });
  document.querySelector("#billingPi")?.addEventListener("change", (event) => {
    updateBillingPi(event.target.value);
  });
  document.querySelector("#billingPi")?.addEventListener("blur", (event) => {
    updateBillingPi(event.target.value);
  });
  document.querySelector("#billingPi")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      updateBillingPi(event.target.value);
    }
  });
  document.querySelector("#exportBilling")?.addEventListener("click", exportBillingCsv);
  document.querySelector("#exportSettlementPdf")?.addEventListener("click", exportSettlementPdf);
  document.querySelector("#generateBillingWorkflow")?.addEventListener("click", async () => {
    try {
      await persistBillingWorkflowFromCurrent();
    } catch (error) {
      reportSaveError(error);
    }
  });
  document.querySelector("#quantitySheetForm")?.addEventListener("submit", handleQuantitySheetSubmit);
  document.querySelector("#quantitySheetSelect")?.addEventListener("change", handleQuantitySheetSelect);
  document.querySelector("#newQuantitySheet")?.addEventListener("click", newQuantitySheetDraft);
  document.querySelector("#deleteQuantitySheet")?.addEventListener("click", deleteCurrentQuantitySheet);
  document.querySelector("#addQuantitySheetRow")?.addEventListener("click", addQuantitySheetRow);
  bindIntakeRequiredNotice("#intakeBatchForm", "无法保存待接收批次");
  document.querySelector("#intakeBatchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const savedBatch = await saveIntakeBatchDraft();
      pushLog(`保存待接收批次：${savedBatch.batchNo || savedBatch.id}`);
      state.selectedIntakeBatchId = "";
      state.intakeBatchDraft = makeIncomingBatchDraft();
      showFlashNotice("保存成功", `已保存为待接收批次：${savedBatch.batchNo || savedBatch.id}`);
    } catch (error) {
      reportSaveError(error);
    }
  });
  document.querySelector("#intakeBatchSelect")?.addEventListener("change", handleIntakeBatchSelect);
  bindIntakeRequiredNotice("#intakeBatchEditForm", "无法保存待接收批次");
  document.querySelector("#intakeBatchEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const editedBatch = readIncomingBatchForm(event.target);
      const savedBatch = await saveIntakeBatch(editedBatch);
      pushLog(`更新待接收批次：${savedBatch.batchNo || savedBatch.id}`);
      closeIntakeBatchEditor();
      showFlashNotice("保存成功", `待接收批次已更新：${savedBatch.batchNo || savedBatch.id}`);
    } catch (error) {
      reportSaveError(error);
    }
  });
  document.querySelector("#closeIntakeBatchEditor")?.addEventListener("click", () => {
    closeIntakeBatchEditor();
    render();
  });
  document.querySelector("#closeIntakeBatchEditorButton")?.addEventListener("click", () => {
    closeIntakeBatchEditor();
    render();
  });
  document.querySelector("#cancelIntakeBatchEdit")?.addEventListener("click", () => {
    closeIntakeBatchEditor();
    render();
  });
  document.querySelector("#parseIncomingMessage")?.addEventListener("click", parseCurrentIncomingMessage);
  document.querySelector("#printCurrentCageCards")?.addEventListener("click", () => {
    captureIntakeBatchDraft();
    printIntakeBatches([normalizeIncomingBatchDraft(state.intakeBatchDraft)]);
  });
  document.querySelector("#previewCurrentCageCard")?.addEventListener("click", () => {
    captureIntakeBatchDraft();
    state.showIntakeCardPreview = true;
    render();
  });
  document.querySelector("#closeIntakeCardPreview")?.addEventListener("click", () => {
    state.showIntakeCardPreview = false;
    render();
  });
  document.querySelector("#closeIntakeCardPreviewButton")?.addEventListener("click", () => {
    state.showIntakeCardPreview = false;
    render();
  });
  document.querySelector("#printSelectedCageCards")?.addEventListener("click", () => {
    const batches = state.intakeBatches.filter((item) => state.selectedIntakeBatchIds.includes(item.id));
    printIntakeBatches(batches);
  });
  document.querySelectorAll("[data-intake-batch-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.intakeBatchFilter = button.dataset.intakeBatchFilter || "todo";
      render();
    });
  });
  document.querySelectorAll("[data-select-intake-batch]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", (event) => {
      toggleSelectedIntakeBatch(input.dataset.selectIntakeBatch, event.target.checked);
      render();
    });
  });
  document.querySelectorAll("[data-open-intake-batch]").forEach((row) => {
    row.addEventListener("click", () => {
      openIntakeBatchEditor(row.dataset.openIntakeBatch);
      render();
    });
  });
  document.querySelectorAll("[data-open-intake-batch-button]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openIntakeBatchEditor(button.dataset.openIntakeBatchButton);
      render();
    });
  });
  document.querySelectorAll("[data-delete-intake-batch]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const batchId = button.dataset.deleteIntakeBatch;
      const batch = state.intakeBatches.find((item) => item.id === batchId);
      if (!batch) return;
      openConfirmDialog({
        type: "delete-intake-batch",
        id: batchId,
        title: "删除待接收批次",
        message: `确认删除待接收批次 ${batch.batchNo || batch.id}？`,
        confirmLabel: "删除",
      });
    });
  });
  document.querySelector("#cancelConfirmDialog")?.addEventListener("click", closeConfirmDialog);
  document.querySelector(".confirm-dialog-backdrop")?.addEventListener("click", (event) => {
    if (event.target.classList.contains("confirm-dialog-backdrop")) closeConfirmDialog();
  });
  document.querySelector("#confirmDialogAction")?.addEventListener("click", handleConfirmDialogAction);
  bindIacucLookupInputs("#intakeBatchForm", (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    const current = readIncomingBatchForm(form);
    state.intakeBatchDraft = applyIncomingBatchIacucInfo(current);
    render();
  });
  bindIacucLookupInputs("#intakeBatchEditForm", (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    state.editingIntakeBatchDraft = applyIncomingBatchIacucInfo(readIncomingBatchForm(form));
    render();
  });
  document.querySelectorAll("[data-remove-qrow]").forEach((button) => {
    button.addEventListener("click", () => removeQuantitySheetRow(Number(button.dataset.removeQrow)));
  });
  document.querySelectorAll("[data-workflow-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.billingWorkflowFilter = button.dataset.workflowFilter;
      render();
    });
  });
  document.querySelectorAll("[data-open-workflow]").forEach((row) => {
    row.addEventListener("click", async () => {
      try {
        await loadBillingWorkflowDetail(row.dataset.openWorkflow);
        render();
      } catch (error) {
        reportSaveError(error);
      }
    });
  });
  document.querySelectorAll("[data-open-workflow-button]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await loadBillingWorkflowDetail(button.dataset.openWorkflowButton);
        render();
      } catch (error) {
        reportSaveError(error);
      }
    });
  });
  document.querySelectorAll("[data-advance-workflow]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await advanceBillingWorkflow(button.dataset.advanceWorkflow, button.dataset.nextStatus);
        pushLog(`更新结算流程：${workflowActionLabel(button.dataset.nextStatus)}`);
        render();
      } catch (error) {
        reportSaveError(error);
      }
    });
  });
  document.querySelectorAll("[data-delete-workflow]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const workflowId = button.dataset.deleteWorkflow;
      const workflow = billingWorkflowById(workflowId) || state.selectedBillingWorkflowDetail?.workflow || {};
      const label = [workflow.pi || workflow.iacuc || "该流程", workflow.month || ""].filter(Boolean).join(" ");
      openConfirmDialog({
        type: "delete-workflow",
        id: workflowId,
        title: "删除结算流程",
        message: `确认删除 ${label} 的结算流程？删除后会同时移除版本记录、明细和流程事件。`,
        confirmLabel: "删除",
        payload: { label },
      });
    });
  });
  document.querySelector("#closeWorkflowDetail")?.addEventListener("click", closeBillingWorkflowDetail);
  document.querySelector("#closeWorkflowDetailButton")?.addEventListener("click", closeBillingWorkflowDetail);
  document.querySelector("[data-toggle-workflow-statements]")?.addEventListener("click", () => {
    state.showWorkflowStatements = !state.showWorkflowStatements;
    render();
  });
  bindIacucLookupInputs("#quantitySheetForm", autofillQuantitySheetIacucFields);
  document.querySelector("#quantitySheetForm")?.addEventListener("change", (event) => {
    const name = event.target?.name;
    if (name === "addedType" || name === "removedType") {
      captureQuantitySheetDraft();
      render();
    }
  });
  document.querySelector("#quantitySheetForm select[name='roomId']")?.addEventListener("change", syncQuantitySheetRoomName);
  document.querySelector("#rateForm")?.addEventListener("submit", handleRateSubmit);
  const roomForm = document.querySelector("#roomForm");
  roomForm?.addEventListener("submit", handleRoomSubmit);
  roomForm?.addEventListener("change", syncRoomBillingFields);
  document.querySelector("#rackForm")?.addEventListener("submit", handleRackSubmit);
  document.querySelector("#rackForm select[name='roomId']")?.addEventListener("change", syncRackFormIndex);
  document.querySelectorAll("#rackForm input[name='rows'], #rackForm input[name='cols']").forEach((input) => {
    input.addEventListener("input", updateRackFormDraft);
  });
  document.querySelectorAll("[data-edit-rack]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingRackId = button.dataset.editRack;
      render();
    });
  });
  document.querySelectorAll("[data-cancel-rack-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.editingRackId === button.dataset.cancelRackEdit) state.editingRackId = "";
      render();
    });
  });
  document.querySelectorAll("[data-rack-edit-form]").forEach((form) => {
    form.addEventListener("submit", handleRackEditSubmit);
  });
  const userForm = document.querySelector("#userForm");
  userForm?.addEventListener("submit", handleUserSubmit);
  if (userForm) bindUserRoomAccessControls(userForm);
  document.querySelectorAll(".user-edit-form").forEach((form) => {
    form.addEventListener("submit", handleUserUpdate);
    bindUserRoomAccessControls(form);
  });
  document.querySelector("#iacucUploadForm")?.addEventListener("submit", handleIacucUpload);
  document.querySelector("#principalIdentityFilter")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyPrincipalIdentityFilter();
    }
  });
  document.querySelector("#applyPrincipalIdentityFilter")?.addEventListener("click", applyPrincipalIdentityFilter);
  document.querySelector("#clearPrincipalIdentityFilter")?.addEventListener("click", () => {
    state.principalIdentityFilter = "";
    render();
  });
  document.querySelectorAll("[data-save-principal]").forEach((button) => {
    button.addEventListener("click", () => {
      const pi = button.dataset.savePrincipal;
      const select = document.querySelector(`[data-principal-type="${cssEscape(pi)}"]`);
      savePrincipalIdentityFromTable(pi, select?.value);
    });
  });
  document.querySelector("#checkSystemUpdate")?.addEventListener("click", checkSystemUpdate);
  document.querySelector("#clearClientCache")?.addEventListener("click", () => {
    openConfirmDialog({
      type: "clear-client-cache",
      title: "清理本地缓存并刷新",
      message: "确认清理当前浏览器保存的本地缓存并重新加载页面？这会清空本地界面状态和已缓存资源。",
      confirmLabel: "清理并刷新",
    });
  });
  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", () => deleteUser(button.dataset.deleteUser));
  });
  document.querySelectorAll("[data-edit-room]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingRoomId = button.dataset.editRoom;
      state.showRoomForm = true;
      render();
    });
  });
  document.querySelectorAll("[data-delete-room]").forEach((button) => {
    button.addEventListener("click", () => deleteRoom(button.dataset.deleteRoom));
  });
  document.querySelectorAll("[data-delete-rack]").forEach((button) => {
    button.addEventListener("click", () => deleteRack(button.dataset.deleteRack));
  });
  document.querySelector("#openRoomForm")?.addEventListener("click", () => {
    state.editingRoomId = "";
    state.showRoomForm = true;
    render();
  });
  document.querySelector("#openRackForm")?.addEventListener("click", () => {
    state.showRackForm = true;
    render();
  });
  document.querySelector("#closeRoomForm")?.addEventListener("click", () => {
    state.showRoomForm = false;
    state.editingRoomId = "";
    render();
  });
  document.querySelector("#closeRackForm")?.addEventListener("click", () => {
    state.showRackForm = false;
    render();
  });
  document.querySelector("#closeRoomFormButton")?.addEventListener("click", () => {
    state.showRoomForm = false;
    state.editingRoomId = "";
    render();
  });
  document.querySelector("#closeRackFormButton")?.addEventListener("click", () => {
    state.showRackForm = false;
    render();
  });
  document.querySelector("#resetDemo")?.addEventListener("click", () => {
    if (remotePersistence) {
      showFlashNotice("当前不可用", "共享模式下不支持重置示例数据。", "warning");
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    state = normalize(structuredClone(seedData));
    render();
  });
}

function openCageEditor() {
  state.showCageEditor = true;
  render();
}

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function isCompactViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1180px)").matches;
}

function bindAuthEvents() {
  document.querySelector("#loginForm")?.addEventListener("submit", login);
}

function bindIntakeRequiredNotice(selector, title) {
  const form = document.querySelector(selector);
  if (!form || form.dataset.requiredNoticeBound === "true") return;
  form.dataset.requiredNoticeBound = "true";
  form.addEventListener(
    "invalid",
    (event) => {
      if (selector === "#intakeBatchForm") {
        state.intakeBatchDraft = readIncomingBatchForm(form);
      } else if (selector === "#intakeBatchEditForm") {
        state.editingIntakeBatchDraft = readIncomingBatchForm(form);
      }
      const fieldLabel = event.target.closest("label")?.childNodes?.[0]?.textContent?.trim() || "必填字段";
      showFlashNotice(title, `请先完善 ${fieldLabel}。`, "warning");
    },
    true,
  );
}

function bindMonkeyAgeField(scopeSelector) {
  const scope = document.querySelector(scopeSelector);
  const birthDateInput = scope?.querySelector("input[name='birthDate']");
  const ageInput = scope?.querySelector("[data-monkey-age]");
  if (!birthDateInput || !ageInput) return;
  const sync = () => {
    ageInput.value = formatAnimalAge(birthDateInput.value) || "自动计算";
  };
  birthDateInput.addEventListener("input", sync);
  birthDateInput.addEventListener("change", sync);
  sync();
}

function startBatchSlotDrag(event, slotButton) {
  if (!state.batchMode || event.button !== 0 || !slotButton?.dataset.slot) return;
  const slotId = slotButton.dataset.slot;
  suppressNextSlotClick = true;
  batchSlotDrag = {
    shouldSelect: !state.selectedSlotIds.includes(slotId),
    visitedSlotIds: new Set(),
  };
  event.preventDefault();
  hideSlotHoverPreview();
  document.body.classList.add("slot-dragging");
  applyBatchSlotDragTarget(slotButton);
  window.addEventListener("pointermove", handleBatchSlotDragMove);
  window.addEventListener("pointerup", finishBatchSlotDrag, { once: true });
  window.addEventListener("pointercancel", finishBatchSlotDrag, { once: true });
}

function handleBatchSlotDragMove(event) {
  if (!batchSlotDrag) return;
  const slotButton = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-slot]");
  if (!slotButton || !slotButton.closest(".rack-grid")) return;
  applyBatchSlotDragTarget(slotButton);
}

function applyBatchSlotDragTarget(slotButton) {
  const slotId = slotButton?.dataset.slot;
  if (!slotId || !batchSlotDrag || batchSlotDrag.visitedSlotIds.has(slotId)) return;

  batchSlotDrag.visitedSlotIds.add(slotId);
  state.selectedSlotId = slotId;
  if (batchSlotDrag.shouldSelect) {
    if (!state.selectedSlotIds.includes(slotId)) state.selectedSlotIds = [...state.selectedSlotIds, slotId];
    slotButton.classList.add("selected", "batch-selected");
  } else {
    state.selectedSlotIds = state.selectedSlotIds.filter((id) => id !== slotId);
    slotButton.classList.remove("batch-selected");
    if (state.selectedSlotId !== slotId) slotButton.classList.remove("selected");
  }
}

function finishBatchSlotDrag() {
  if (!batchSlotDrag) return;
  batchSlotDrag = null;
  document.body.classList.remove("slot-dragging");
  window.removeEventListener("pointermove", handleBatchSlotDragMove);
  window.removeEventListener("pointerup", finishBatchSlotDrag);
  window.removeEventListener("pointercancel", finishBatchSlotDrag);
  render();
}

function toggleBatchSlot(slotId) {
  state.selectedSlotId = slotId;
  if (state.selectedSlotIds.includes(slotId)) {
    state.selectedSlotIds = state.selectedSlotIds.filter((id) => id !== slotId);
  } else {
    state.selectedSlotIds = [...state.selectedSlotIds, slotId];
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const error = document.querySelector("#loginError");
  if (error) error.textContent = "";
  try {
    const response = await fetch(API_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (error) error.textContent = payload.error || "登录失败";
      return;
    }
    currentUser = payload.user;
    await Promise.all([loadIacucIndexStatus(), loadPersistedState()]);
    try {
      await ensureViewDataLoaded(state.activeView);
    } catch (loadError) {
      console.error(loadError);
      state.flashNotice = {
        type: "warning",
        title: "部分数据加载失败",
        message: loadError?.message || "当前页面的附加数据未完整加载。",
      };
    }
    render();
  } catch {
    if (error) error.textContent = "无法连接后端服务";
  }
}

async function logout() {
  await fetch(API_LOGOUT_URL, { method: "POST" }).catch(() => {});
  currentUser = null;
  users = [];
  IACUC_INDEX = [];
  IACUC_BY_NUMBER = new Map();
  IACUC_INDEX_LOADING = false;
  IACUC_INDEX_LOADED = false;
  IACUC_INDEX_PROMISE = null;
  iacucIndexMeta = null;
  invalidateIacucSearchCache();
  lazyDataState.quantitySheetsLoaded = false;
  lazyDataState.quantitySheetsLoading = false;
  lazyDataState.billingWorkflowsLoaded = false;
  lazyDataState.billingWorkflowsLoading = false;
  lazyDataState.auditLogsLoaded = false;
  lazyDataState.auditLogsLoading = false;
  lazyDataState.usersLoaded = false;
  lazyDataState.usersLoading = false;
  lazyDataState.principalIdentitiesLoaded = false;
  lazyDataState.principalIdentitiesLoading = false;
  PRINCIPAL_IDENTITIES = [];
  PRINCIPAL_IDENTITY_BY_NAME = new Map();
  render();
}

async function loadCurrentUser() {
  try {
    const response = await fetch(API_AUTH_ME_URL, { cache: "no-store" });
    if (response.ok) {
      remotePersistence = true;
      const payload = await response.json();
      currentUser = payload.user;
      return;
    }
    if (response.status === 401) {
      remotePersistence = true;
      currentUser = null;
      return;
    }
  } catch {
    remotePersistence = false;
    currentUser = null;
  }
}

async function loadUsers() {
  if (!currentUser || currentUser.role !== "admin") {
    users = [];
    lazyDataState.usersLoaded = true;
    lazyDataState.usersLoading = false;
    return;
  }
  lazyDataState.usersLoading = true;
  try {
    const response = await fetch(API_USERS_URL, { cache: "no-store" });
    if (!response.ok) {
      lazyDataState.usersLoading = false;
      return;
    }
    const payload = await response.json();
    users = payload.users || [];
    lazyDataState.usersLoaded = true;
    lazyDataState.usersLoading = false;
  } catch {
    users = [];
    lazyDataState.usersLoading = false;
  }
}

function bindUserRoomAccessControls(form) {
  const roleSelect = form.querySelector("select[name='role']");
  const dropdown = form.querySelector("[data-room-access-dropdown]");
  const summary = form.querySelector("[data-room-access-summary]");
  if (!dropdown || !summary) return;
  const sync = () => {
    const isAdmin = roleSelect?.value === "admin";
    const isLocked = dropdown.dataset.roomAccessLocked === "true";
    dropdown.classList.toggle("disabled", Boolean(isAdmin || isLocked));
    form.querySelectorAll("input[name='roomIds']").forEach((input) => {
      input.disabled = Boolean(isAdmin || isLocked);
    });
    if (isAdmin) {
      summary.textContent = "系统管理员默认全部饲养间";
      dropdown.removeAttribute("open");
      return;
    }
    const selectedRoomNames = Array.from(form.querySelectorAll("input[name='roomIds']:checked")).map(
      (input) => input.dataset.roomName || input.value,
    );
    summary.textContent = formatRoomAccessSummary(selectedRoomNames);
  };
  roleSelect?.addEventListener("change", sync);
  form.querySelectorAll("input[name='roomIds']").forEach((input) => {
    input.addEventListener("change", sync);
  });
  sync();
}

async function handleUserSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const role = form.get("role");
  const roomIds = role === "admin" ? [] : form.getAll("roomIds");
  const response = await fetch(API_USERS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: form.get("username"),
      displayName: form.get("displayName"),
      password: form.get("password"),
      role,
      roomIds,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    showFlashNotice("创建账号失败", payload.error || "创建账号失败", "error");
    return;
  }
  await loadUsers();
  render();
}

async function handleUserUpdate(event) {
  event.preventDefault();
  const formElement = event.target;
  const userId = formElement.dataset.userId;
  const form = new FormData(formElement);
  const role = form.get("role");
  const response = await fetch(`${API_USERS_URL}/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: form.get("username"),
      displayName: form.get("displayName"),
      password: form.get("password"),
      role,
      roomIds: role === "admin" ? [] : form.getAll("roomIds"),
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    showFlashNotice("保存账号失败", payload.error || "保存账号失败", "error");
    return;
  }
  await loadUsers();
  render();
}

async function deleteUser(userId) {
  const user = users.find((item) => item.id === userId);
  if (!user) return;
  openConfirmDialog({
    type: "delete-user",
    id: userId,
    title: "删除账号",
    message: `确认删除账号“${user.displayName}”？该账号将无法继续登录。`,
    confirmLabel: "删除",
    payload: { displayName: user.displayName },
  });
}

async function deleteUserConfirmed(userId) {
  const response = await fetch(`${API_USERS_URL}/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showFlashNotice("删除账号失败", payload.error || "删除账号失败", "error");
    return;
  }
  await loadUsers();
}

async function handleIacucUpload(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const file = form.get("file");
  if (!file || !file.name) return;

  try {
    const response = await fetch(API_IACUC_UPLOAD_URL, {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (!response.ok) {
      showFlashNotice("上传失败", payload.error || "上传失败", "error");
      return;
    }
    IACUC_INDEX = payload.items || [];
    IACUC_BY_NUMBER = new Map(IACUC_INDEX.map((item) => [iacucRawKey(item.iacuc), item]));
    IACUC_INDEX_LOADING = false;
    IACUC_INDEX_LOADED = true;
    IACUC_INDEX_PROMISE = null;
    invalidateIacucSearchCache();
    state.quantitySheetDraft = hydrateQuantitySheetIacucInfo(state.quantitySheetDraft);
    await loadPrincipalIdentities();
    iacucIndexMeta = {
      count: payload.count,
      updatedAt: payload.updatedAt,
      source: "data",
    };
    mergeServerAuditLogs(payload);
    showFlashNotice("上传完成", `已生成 IACUC 索引 ${payload.count} 条，重复编号 ${payload.duplicateCount || 0} 条。`, "success");
    render();
  } catch {
    showFlashNotice("上传失败", "请检查网络或文件格式。", "error");
  }
}

async function savePrincipalIdentityFromTable(pi, principalType) {
  try {
    const item = await savePrincipalIdentity(pi, normalizePrincipalType(principalType));
    pushLog(`更新 ${item.pi} 负责人身份为 ${principalTypeLabel(item.principalType)}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function applyPrincipalIdentityFilter() {
  const input = document.querySelector("#principalIdentityFilter");
  state.principalIdentityFilter = input?.value || "";
  render();
}

async function savePrincipalIdentity(pi, principalType) {
  const normalizedType = normalizePrincipalType(principalType);
  const item = {
    pi,
    principalType: normalizedType,
    freeCageAllowance: freeCageAllowanceForPrincipalType(normalizedType),
  };
  if (!remotePersistence) {
    upsertPrincipalIdentity(item);
    return item;
  }
  const response = await fetch(`${API_PRINCIPAL_IDENTITIES_URL}/${encodeURIComponent(pi)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存项目负责人身份失败");
  }
  mergeServerAuditLogs(payload);
  upsertPrincipalIdentity(payload.item || item);
  return payload.item || item;
}

async function checkSystemUpdate() {
  systemUpdateInfo = { loading: true };
  render();

  try {
    const response = await fetch(API_SYSTEM_UPDATE_URL, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      systemUpdateInfo = { error: payload.error || "检查更新失败" };
      render();
      return;
    }
    systemUpdateInfo = payload;
    render();
  } catch {
    systemUpdateInfo = { error: "无法连接后端服务" };
    render();
  }
}

async function clearClientCacheAndReload() {
  if (typeof window === "undefined") return;

  localStorage.clear();
  sessionStorage.clear();

  if ("caches" in window) {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    } catch {
      // Best-effort cache cleanup.
    }
  }

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch {
      // Best-effort service worker cleanup.
    }
  }

  if ("indexedDB" in window && typeof indexedDB.databases === "function") {
    try {
      const databases = await indexedDB.databases();
      await Promise.all(
        (databases || [])
          .map((database) => database?.name)
          .filter(Boolean)
          .map(
            (name) =>
              new Promise((resolve) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              }),
          ),
      );
    } catch {
      // IndexedDB cleanup is optional.
    }
  }

  try {
    sessionStorage.setItem(CACHE_RESET_NOTICE_KEY, JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    // Ignore notice persistence failure and continue refresh.
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_clr", `${Date.now()}`);
  window.location.replace(url.toString());
}

function selectVisibleSlots() {
  const selectedRoom = getSelectedRoom();
  if (!selectedRoom) return;
  const racks = state.racks.filter((rack) => rack.roomId === selectedRoom.id);
  const selectedRack = getSelectedRack(racks);
  if (!selectedRack) return;
  const slots = state.slots.filter((slot) => slot.rackId === selectedRack.id);
  const visibleSlots = state.slotFilter === "all" ? slots : slots.filter((slot) => slot.status === state.slotFilter);
  state.selectedSlotIds = visibleSlots.map((slot) => slot.id);
  state.selectedSlotId = state.selectedSlotIds[0] ?? state.selectedSlotId;
  render();
}

async function handleSlotSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const slotId = form.get("slotId");
  const status = form.get("status");
  const current = currentOccupancy(slotId);

  if (status === "empty") {
    try {
      await closeOccupancy(slotId, form.get("endDate") || today);
    } catch (error) {
      reportSaveError(error);
    }
    return;
  }

  const payload = {
    id: current?.id || crypto.randomUUID(),
    slotId,
    cageCode: form.get("cageCode").trim() || cageCodeForSlot(slotId),
    status,
    iacuc: form.get("iacuc").trim(),
    project: form.get("project").trim(),
    pi: form.get("pi").trim(),
    owner: form.get("owner").trim(),
    startDate: form.get("startDate") || today,
    feedingDays: normalizeFeedingDays(form.get("feedingDays")),
    endDate: "",
    animalCount: numericOrNull(form.get("animalCount")),
    animalSex: normalizeAnimalSex(form.get("animalSex")),
    birthDate: normalizeDateInput(form.get("birthDate")),
    billingItem: "",
    customerType: "",
    notes: form.get("notes").trim(),
    updatedAt: today,
  };
  payload.endDate = resolveEndDateByFeedingPeriod(payload.startDate, payload.feedingDays, form.get("endDate"));

  if (payload.status === "active") {
    const overdueItems = findOverdueOccupanciesByIacuc(payload.iacuc, [payload.id]);
    if (overdueItems.length) {
      showFlashNotice("超期提示", buildOverdueAlertMessage(payload.iacuc, overdueItems), "warning");
    }
  }

  try {
    const response = current
      ? await updateEntity("occupancies", current.id, payload)
      : await createEntity("occupancies", payload);
    upsertById(state.occupancies, response.item || payload);
    pushLog(`${current ? "更新" : "新增"}笼位 ${slotId} ${statusLabel(status)}`);
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function handleBatchSlotSubmit(event) {
  event.preventDefault();
  if (!state.selectedSlotIds.length) return;

  const selectedSlots = state.slots.filter((slot) => state.selectedSlotIds.includes(slot.id));
  const batchState = getBatchEditState(selectedSlots);
  if (batchState.hasConflict) {
    showFlashNotice("无法批量编辑", "当前选择包含多个不同 IACUC 编号，请只选择相同 IACUC 的笼位进行批量编辑。", "warning");
    return;
  }

  const form = new FormData(event.target);
  const payload = {
    status: form.get("status"),
    iacuc: form.get("iacuc").trim(),
    project: form.get("project").trim(),
    pi: form.get("pi").trim(),
    owner: form.get("owner").trim(),
    startDate: form.get("startDate") || today,
    feedingDays: normalizeFeedingDays(form.get("feedingDays")),
    endDate: "",
    notes: form.get("notes").trim(),
    updatedAt: today,
  };
  payload.endDate = resolveEndDateByFeedingPeriod(payload.startDate, payload.feedingDays, form.get("endDate"));

  if (payload.status === "active") {
    const editingIds = state.selectedSlotIds.map((slotId) => currentOccupancy(slotId)?.id).filter(Boolean);
    const overdueItems = findOverdueOccupanciesByIacuc(payload.iacuc, editingIds);
    if (overdueItems.length) {
      showFlashNotice("超期提示", buildOverdueAlertMessage(payload.iacuc, overdueItems), "warning");
    }
  }

  try {
    const savedItems = [];
    for (const slotId of state.selectedSlotIds) {
      const current = currentOccupancy(slotId);
      const next = {
        id: current?.id || crypto.randomUUID(),
        ...payload,
        slotId,
        cageCode: current?.cageCode || cageCodeForSlot(slotId),
      };
      const response = current
        ? await updateEntity("occupancies", current.id, next)
        : await createEntity("occupancies", next);
      savedItems.push(response.item || next);
    }
    savedItems.forEach((item) => upsertById(state.occupancies, item));
    pushLog(`批量更新 ${state.selectedSlotIds.length} 个笼位为 ${statusLabel(payload.status)}`);
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function autofillIacucFields(event) {
  const form = event.target.form;
  const match = findIacucInfo(event.target.value);
  if (!form || !match) return;

  const projectInput = form.elements.project;
  const piInput = form.elements.pi;
  const ownerInput = form.elements.owner;

  if (projectInput && match.project) projectInput.value = match.project;
  if (piInput && match.pi) piInput.value = match.pi;
  if (ownerInput && match.owner) ownerInput.value = match.owner;
  event.target.value = match.iacuc;
}

function bindIacucLookupInputs(scopeSelector, autofillHandler) {
  const scope = document.querySelector(scopeSelector);
  document.querySelectorAll(`${scopeSelector} [data-iacuc-lookup]`).forEach((input) => {
    input.addEventListener("focus", async () => {
      if (IACUC_INDEX_LOADED || IACUC_INDEX_LOADING) return;
      updateIacucLookupPanel(input);
      try {
        await ensureIacucIndexLoaded();
        updateIacucLookupPanel(input);
      } catch (error) {
        console.error(error);
        showFlashNotice("加载索引失败", "伦理号索引暂时不可用，当前仍可继续手动输入。", "warning");
        updateIacucLookupPanel(input);
      }
    });
    input.addEventListener("input", (event) => {
      input.closest(".iacuc-lookup-field")?.classList.remove("lookup-picked");
      updateIacucLookupPanel(input);
      if (input.name === "iacuc") autofillHandler(event);
    });
    input.addEventListener("change", (event) => {
      if (input.name === "iacuc") autofillHandler(event);
    });
    input.addEventListener("blur", (event) => {
      if (input.name === "iacuc") autofillHandler(event);
    });
  });

  scope?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-iacuc-pick]");
    if (!button || !scope.contains(button)) return;
    event.preventDefault();
    const field = button.closest(".iacuc-lookup-field");
    const input = field?.querySelector("[data-iacuc-lookup]");
    if (!input) return;
    input.value = button.dataset.iacucPick || "";
    updateIacucLookupPanel(input);
    if (input.name === "iacuc") autofillHandler({ target: input });
    field.classList.add("lookup-picked");
    input.blur();
  });
}

function updateIacucLookupPanel(input) {
  const field = input.closest(".iacuc-lookup-field");
  const panel = field?.querySelector("[data-iacuc-suggest-panel]");
  if (!panel) return;
  panel.outerHTML = renderIacucLookupPanel(input.value);
}

async function clearSelectedSlot() {
  try {
    await closeOccupancy(state.selectedSlotId, today, "cleared", { renderAfterSave: false });
    state.samplingMode = "";
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function openSampling(mode) {
  state.samplingMode = mode;
  render();
}

async function sampleSelectedSlot() {
  const current = currentOccupancy(state.selectedSlotId);
  if (!current || current.status !== "active") return;

  const sampledDate = document.querySelector("#sampleDate")?.value;
  if (!sampledDate) return;
  if (!validateEndDate(current, sampledDate)) return;

  try {
    await closeOccupancy(state.selectedSlotId, sampledDate, "sampled", { renderAfterSave: false });
    state.samplingMode = "";
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function sampleBatchSlots() {
  const selectedSlots = state.slots.filter((slot) => state.selectedSlotIds.includes(slot.id));
  const activeItems = selectedActiveOccupancies(selectedSlots);
  if (!activeItems.length) return;

  const sampledDate = document.querySelector("#batchSampleDate")?.value;
  if (!sampledDate) return;
  if (activeItems.some((item) => !validateEndDate(item, sampledDate))) return;
  openConfirmDialog({
    type: "sample-batch-slots",
    title: "批量标记已取材",
    message: `确定将 ${activeItems.length} 笼标记为已取材，并以 ${sampledDate} 作为最后计费日期？`,
    confirmLabel: "确认",
    payload: { sampledDate },
  });
}

async function sampleBatchSlotsConfirmed(sampledDate) {
  const selectedSlots = state.slots.filter((slot) => state.selectedSlotIds.includes(slot.id));
  const activeItems = selectedActiveOccupancies(selectedSlots);
  if (!activeItems.length) return;
  if (activeItems.some((item) => !validateEndDate(item, sampledDate))) return;
  try {
    const savedItems = [];
    for (const item of activeItems) {
      savedItems.push(await closeOccupancy(item.slotId, sampledDate, "sampled", { renderAfterSave: false }));
    }
    savedItems.filter(Boolean).forEach((item) => upsertById(state.occupancies, item));
    pushLog(`批量标记已取材 ${activeItems.length} 个笼位，最后计费日期 ${sampledDate}`);
    state.samplingMode = "";
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function clearBatchSlots() {
  if (!state.selectedSlotIds.length) return;
  openConfirmDialog({
    type: "clear-batch-slots",
    title: "批量设为空",
    message: `确定将已选择的 ${state.selectedSlotIds.length} 个笼位全部设为空？`,
    confirmLabel: "设为空",
  });
}

async function clearBatchSlotsConfirmed() {
  if (!state.selectedSlotIds.length) return;
  try {
    const savedItems = [];
    for (const slotId of state.selectedSlotIds) {
      savedItems.push(await closeOccupancy(slotId, today, "cleared", { renderAfterSave: false }));
    }
    savedItems.filter(Boolean).forEach((item) => upsertById(state.occupancies, item));
    pushLog(`批量设空 ${state.selectedSlotIds.length} 个笼位`);
    state.samplingMode = "";
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function closeOccupancy(slotId, endDate, reason = "cleared", options = {}) {
  const { renderAfterSave = true } = options;
  const current = currentOccupancy(slotId);
  if (!current) {
    if (renderAfterSave) render();
    return null;
  }

  const next = {
    ...current,
    status: "ended",
    endDate,
    endReason: reason,
    updatedAt: today,
  };

  const response = await updateEntity("occupancies", current.id, next);
  const saved = response.item || next;
  upsertById(state.occupancies, saved);
  pushLog(`${reason === "sampled" ? "已取材" : "设为空"}：结束笼位 ${slotId} 占用，最后计费日期 ${endDate}`);
  updateSlotStatuses();
  if (renderAfterSave) render();
  return saved;
}

async function handleRateSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const principalType = normalizePrincipalType(form.get("principalType"));
  const freeCageAllowance = freeCageAllowanceForPrincipalType(principalType);
  const targetPi = state.billingPi || state.quantitySheetDraft?.pi || "";
  if (!targetPi) {
    showFlashNotice("缺少项目信息", "请先选择项目负责人。", "warning");
    return;
  }
  try {
    await savePrincipalIdentity(targetPi, principalType);
    state.freeCageAllowance = freeCageAllowance;
    state.billingPrincipalType = principalType;
    pushLog(`更新 ${targetPi} 负责人类型为 ${principalTypeLabel(principalType)}，免费笼数 ${freeCageAllowance}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function updateBillingPi(value) {
  const trimmed = value.trim();
  const match = piOptions(trimmed).find((item) => normalizePersonName(item.pi) === normalizePersonName(trimmed));
  state.billingPi = match?.pi || trimmed;
  state.billingPrincipalType = principalTypeForPi(state.billingPi);
  state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
  render();
}

async function handleQuantitySheetSubmit(event) {
  event.preventDefault();
  try {
    const sheet = await saveQuantitySheetDraft();
    pushLog(`保存数量统计表：${sheet.iacuc} ${sheet.month}`);
    showFlashNotice("保存成功", `数量统计表已保存：${[sheet.month, sheet.iacuc].filter(Boolean).join(" · ")}`);
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function handleQuantitySheetSelect(event) {
  captureQuantitySheetDraft();
  const sheet = state.quantitySheets.find((item) => item.id === event.target.value);
  state.selectedQuantitySheetId = sheet?.id || "";
  state.quantitySheetDraft = hydrateQuantitySheetIacucInfo(sheet || makeQuantitySheetDraft(state.billingMonth));
  state.billingMonth = state.quantitySheetDraft.month || state.billingMonth;
  state.billingIacuc = state.quantitySheetDraft.iacuc || state.billingIacuc;
  state.billingPi = state.quantitySheetDraft.pi || state.billingPi;
  state.billingPrincipalType = principalTypeForPi(state.billingPi);
  state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
  render();
}

function newQuantitySheetDraft() {
  captureQuantitySheetDraft();
  state.selectedQuantitySheetId = "";
  state.quantitySheetDraft = makeQuantitySheetDraft(state.billingMonth || today.slice(0, 7));
  render();
}

function deleteCurrentQuantitySheet() {
  const sheetId = state.selectedQuantitySheetId || state.quantitySheetDraft?.id || "";
  const sheet = state.quantitySheets.find((item) => item.id === sheetId);
  if (!sheet) return;
  openConfirmDialog({
    type: "delete-quantity-sheet",
    id: sheet.id,
    title: "删除数量统计表",
    message: `确认删除 ${sheet.iacuc || "该伦理号"} ${sheet.month || ""} 数量统计表？相关结算流程和已导出的结算单不会自动删除。`,
    confirmLabel: "删除",
    payload: { label: [sheet.iacuc, sheet.month].filter(Boolean).join(" ") },
  });
}

async function deleteQuantitySheetConfirmed(sheetId) {
  if (!sheetId) return;
  if (!remotePersistence) {
    state.quantitySheets = state.quantitySheets.filter((item) => item.id !== sheetId);
    state.selectedQuantitySheetId = "";
    state.quantitySheetDraft = makeQuantitySheetDraft(state.billingMonth || today.slice(0, 7));
    render();
    return;
  }

  const response = await fetch(`${API_QUANTITY_SHEETS_URL}/${encodeURIComponent(sheetId)}`, {
    method: "DELETE",
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "删除数量统计表失败");
  }
  mergeServerAuditLogs(payload);
  state.quantitySheets = state.quantitySheets.filter((item) => item.id !== sheetId);
  invalidateStateIndexCache();
  const nextSheet = state.quantitySheets[0] || null;
  state.selectedQuantitySheetId = nextSheet?.id || "";
  state.quantitySheetDraft = nextSheet ? hydrateQuantitySheetIacucInfo(nextSheet) : makeQuantitySheetDraft(state.billingMonth || today.slice(0, 7));
  render();
}

function addQuantitySheetRow() {
  captureQuantitySheetDraft();
  state.quantitySheetDraft.rows.push(makeQuantitySheetRow(state.quantitySheetDraft.month));
  render();
}

function removeQuantitySheetRow(index) {
  captureQuantitySheetDraft();
  state.quantitySheetDraft.rows.splice(index, 1);
  render();
}

function captureQuantitySheetDraft() {
  const form = document.querySelector("#quantitySheetForm");
  if (!form) return;
  state.quantitySheetDraft = readQuantitySheetForm(form);
  state.billingMonth = state.quantitySheetDraft.month || state.billingMonth;
  state.billingIacuc = state.quantitySheetDraft.iacuc || state.billingIacuc;
  state.billingPi = state.quantitySheetDraft.pi || state.billingPi;
  state.billingPrincipalType = principalTypeForPi(state.billingPi);
  state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
}

async function saveQuantitySheetDraft() {
  const startedAt = performance.now();
  const form = document.querySelector("#quantitySheetForm");
  if (form) state.quantitySheetDraft = readQuantitySheetForm(form);
  const sheet = hydrateQuantitySheetIacucInfo(state.quantitySheetDraft);
  if (!remotePersistence) {
    upsertById(state.quantitySheets, sheet);
    state.selectedQuantitySheetId = sheet.id;
    state.quantitySheetDraft = sheet;
    return sheet;
  }

  const exists = state.quantitySheets.some((item) => item.id === sheet.id);
  const response = await fetch(exists ? `${API_QUANTITY_SHEETS_URL}/${encodeURIComponent(sheet.id)}` : API_QUANTITY_SHEETS_URL, {
    method: exists ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存数量统计表失败");
  }
  mergeServerAuditLogs(payload);
  const savedSheet = payload.item || sheet;
  const affectedSheets = Array.isArray(payload.affectedItems) ? payload.affectedItems : [];
  upsertById(state.quantitySheets, savedSheet);
  affectedSheets.forEach((item) => upsertById(state.quantitySheets, item));
  state.selectedQuantitySheetId = savedSheet.id;
  state.quantitySheetDraft = savedSheet;
  lazyDataState.quantitySheetsLoaded = true;
  lazyDataState.quantitySheetsLoading = false;
  logClientPerf("quantity_sheet.save", startedAt, { affected: affectedSheets.length, rows: savedSheet.rows?.length || 0 });
  Promise.all([savedSheet, ...affectedSheets].map((item) => refreshQuantitySheet(item.id))).catch((refreshError) => {
    console.error(refreshError);
  });
  return state.quantitySheetDraft;
}

function handleIntakeBatchSelect(event) {
  const batch = state.intakeBatches.find((item) => item.id === event.target.value);
  if (batch) openIntakeBatchEditor(batch.id);
  else closeIntakeBatchEditor();
  render();
}

function openIntakeBatchEditor(batchId) {
  const batch = state.intakeBatches.find((item) => item.id === batchId);
  if (!batch) return;
  state.selectedIntakeBatchId = batch.id;
  state.editingIntakeBatchId = batch.id;
  state.editingIntakeBatchDraft = normalizeIncomingBatchDraft(batch);
}

function closeIntakeBatchEditor() {
  state.editingIntakeBatchId = "";
  state.editingIntakeBatchDraft = null;
}

function captureIntakeBatchDraft() {
  const form = document.querySelector("#intakeBatchForm");
  if (!form) return;
  state.intakeBatchDraft = readIncomingBatchForm(form);
}

async function saveIntakeBatchDraft() {
  const form = document.querySelector("#intakeBatchForm");
  if (form) state.intakeBatchDraft = readIncomingBatchForm(form);
  const batch = normalizeIncomingBatchDraft(state.intakeBatchDraft);
  return saveIntakeBatch(batch);
}

async function saveIntakeBatch(batch) {
  const normalizedBatch = normalizeIncomingBatchDraft(batch);
  if (!remotePersistence) {
    upsertById(state.intakeBatches, normalizedBatch);
    state.selectedIntakeBatchId = normalizedBatch.id;
    return normalizedBatch;
  }

  const exists = state.intakeBatches.some((item) => item.id === normalizedBatch.id);
  const response = await fetch(exists ? `${ENTITY_API_URLS.intakeBatches}/${encodeURIComponent(normalizedBatch.id)}` : ENTITY_API_URLS.intakeBatches, {
    method: exists ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: normalizedBatch }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "保存待接收批次失败");
  }
  mergeServerAuditLogs(payload);
  const savedBatch = normalizeIncomingBatchDraft(payload.item || normalizedBatch);
  state.selectedIntakeBatchId = savedBatch.id;
  try {
    await loadPersistedState();
  } catch (refreshError) {
    console.error(refreshError);
    upsertById(state.intakeBatches, savedBatch);
  }
  return state.intakeBatches.find((item) => item.id === savedBatch.id) || savedBatch;
}

function readIncomingBatchForm(form) {
  const data = new FormData(form);
  return applyIncomingBatchIacucInfo({
    id: data.get("id") || state.intakeBatchDraft?.id || crypto.randomUUID(),
    rawMessage: data.get("rawMessage") || "",
    purchaseOrderNo: data.get("purchaseOrderNo") || "",
    batchNo: data.get("batchNo") || "",
    iacuc: data.get("iacuc") || extractIacucFromBatchNo(data.get("batchNo") || ""),
    supplier: data.get("supplier") || "",
    species: data.get("species") || "mouse",
    strainRaw: data.get("strainRaw") || "",
    strainStandard: data.get("strainStandard") || "",
    sex: data.get("sex") || "",
    quantity: numericOrNull(data.get("quantity")),
    roomName: data.get("roomName") || "",
    intakeDate: data.get("intakeDate") || "",
    husbandryDays: numericOrNull(data.get("husbandryDays")),
    endDate: data.get("endDate") || "",
    project: data.get("project") || "",
    pi: data.get("pi") || "",
    owner: data.get("owner") || "",
    receiverName: data.get("receiverName") || currentUser?.displayName || "",
    vetPhone: data.get("vetPhone") || "",
    notes: data.get("notes") || "",
    status: data.get("status") || "draft",
    suggestedAnimalsPerCage: numericOrNull(data.get("suggestedAnimalsPerCage")),
    suggestedCardCount: numericOrNull(data.get("suggestedCardCount")),
    finalCardCount: numericOrNull(data.get("finalCardCount")),
    updatedAt: new Date().toISOString(),
  });
}

function parseCurrentIncomingMessage() {
  const rawMessage = document.querySelector("#intakeBatchForm textarea[name='rawMessage']")?.value || "";
  const parsed = parseIncomingMessage(rawMessage);
  const selectedBatch = state.intakeBatches.find((item) => item.id === state.selectedIntakeBatchId);
  const isEditingSelectedBatch = selectedBatch && rawMessage.trim() === String(selectedBatch.rawMessage || "").trim();
  state.intakeBatchDraft = normalizeIncomingBatchDraft({
    ...(isEditingSelectedBatch ? state.intakeBatchDraft : makeIncomingBatchDraft()),
    ...parsed,
    id: isEditingSelectedBatch ? state.intakeBatchDraft.id : parsed.id,
    finalCardCount: parsed.suggestedCardCount,
    vetPhone: (isEditingSelectedBatch ? state.intakeBatchDraft?.vetPhone : "") || parsed.vetPhone || "",
    status: (isEditingSelectedBatch ? state.intakeBatchDraft?.status : "") || parsed.status || "draft",
  });
  if (!isEditingSelectedBatch) state.selectedIntakeBatchId = "";
  render();
}

function toggleSelectedIntakeBatch(batchId, checked) {
  const next = new Set(state.selectedIntakeBatchIds);
  if (checked) next.add(batchId);
  else next.delete(batchId);
  state.selectedIntakeBatchIds = [...next];
  saveState();
}

async function deleteIntakeBatch(batchId) {
  if (!remotePersistence) {
    state.intakeBatches = state.intakeBatches.filter((item) => item.id !== batchId);
    state.selectedIntakeBatchIds = state.selectedIntakeBatchIds.filter((id) => id !== batchId);
    if (state.selectedIntakeBatchId === batchId) {
      state.selectedIntakeBatchId = "";
      state.intakeBatchDraft = makeIncomingBatchDraft();
    }
    return;
  }
  await deleteEntityRequest("intakeBatches", batchId);
  state.intakeBatches = state.intakeBatches.filter((item) => item.id !== batchId);
  state.selectedIntakeBatchIds = state.selectedIntakeBatchIds.filter((id) => id !== batchId);
  if (state.selectedIntakeBatchId === batchId) {
    state.selectedIntakeBatchId = "";
    state.intakeBatchDraft = makeIncomingBatchDraft();
  }
}

function printIntakeBatches(batches) {
  const items = batches.flatMap((batch) => batch.cards.map((card) => ({ batch, card })));
  if (!items.length) {
    showFlashNotice("当前无法打印", "当前没有可打印的笼卡。", "warning");
    return;
  }
  const opened = window.open("", "_blank");
  if (!opened) {
    showFlashNotice("打开失败", "浏览器阻止了弹出窗口，请允许弹出窗口后重试。", "error");
    return;
  }
  opened.document.write(intakeCardsPrintHtml(items));
  opened.document.close();
  opened.focus();
  opened.print();
}

function intakeCardsPrintHtml(items) {
  const pages = chunkIntakePrintItems(items, 14);
  const sheets = pages
    .map(
      (page) => `
        <div class="sheet">
          ${page.map(({ batch, card }) => renderIntakeCardPrint(batch, card)).join("")}
        </div>`,
    )
    .join("");
  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <title>接收笼卡打印</title>
        <style>
          :root { color-scheme: light; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #fff;
            font-family: "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            color: #0f172a;
          }
          .sheet {
            width: 210mm;
            height: 297mm;
            padding: 3.86mm 4mm 2.7mm;
            display: grid;
            grid-template-columns: repeat(2, 100mm);
            grid-auto-rows: 40.09mm;
            gap: 1.87mm 1.86mm;
            align-content: start;
            justify-content: center;
            break-after: page;
            page-break-after: always;
          }
          .sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .card {
            position: relative;
            width: 100mm;
            height: 40.09mm;
            border: 0.36mm solid #111827;
            overflow: hidden;
            background: #fff;
          }
          .card table {
            width: 100%;
            height: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          .card td {
            border: 0.32mm solid #111827;
            padding: 0.12mm 0.55mm;
            vertical-align: middle;
            font-size: 2.45mm;
            line-height: 1;
            word-break: break-word;
            overflow: hidden;
          }
          .card .header-title {
            font-size: 4.35mm;
            font-weight: 800;
            text-align: left;
            padding-left: 7mm;
            letter-spacing: 0.12mm;
          }
          .card .header-cage {
            font-size: 4.35mm;
            font-weight: 800;
            text-align: left;
            padding-left: 4mm;
          }
          .card .label {
            font-size: 2.35mm;
            font-weight: 800;
            color: #111827;
            white-space: nowrap;
          }
          .card .label-long {
            font-size: 2.35mm;
          }
          .card .value {
            font-size: 2.32mm;
            font-weight: 500;
            text-align: center;
          }
          .card .value-compact {
            font-size: 1.98mm;
            line-height: 0.98;
          }
          .card .batch-iacuc-highlight {
            color: #b91c1c;
            font-weight: 800;
          }
          .card .row-head {
            text-align: center;
            font-weight: 800;
            font-size: 2.35mm;
          }
          .card .room {
            text-align: center;
            color: #7f0000;
            font-size: 8.8mm;
            font-weight: 800;
          }
          .card .cycle {
            font-size: 2mm;
            font-weight: 800;
            text-align: center;
            letter-spacing: -0.06mm;
            white-space: nowrap;
          }
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .sheet {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .card {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        ${sheets}
      </body>
    </html>
  `;
}

function chunkIntakePrintItems(items, pageSize) {
  const pages = [];
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }
  return pages;
}

function renderIntakeCardPrint(batch, card) {
  const supplierShortName = abbreviateSupplierName(batch.supplier);
  const batchNoHtml = renderBatchNoWithHighlightedIacuc(batch.batchNo, batch.iacuc);
  return `
    <section class="card">
      <table>
        <colgroup>
          <col style="width:16mm" />
          <col style="width:34mm" />
          <col style="width:27mm" />
          <col style="width:23mm" />
        </colgroup>
        <tr style="height:4.9mm">
          <td class="header-title" colspan="2">实验动物检疫卡</td>
          <td class="header-cage" colspan="2">笼号：</td>
        </tr>
        <tr style="height:4.25mm">
          <td class="label">批次号：</td>
          <td class="value value-compact">${batchNoHtml}</td>
          <td class="label">购买单位：</td>
          <td class="value">${escapeText(supplierShortName || batch.supplier || "")}</td>
        </tr>
        <tr style="height:4.25mm">
          <td class="label">动物品系：</td>
          <td class="value">${escapeText(batch.strainStandard || batch.strainRaw || "")}</td>
          <td class="label">项目负责人：</td>
          <td class="value">${escapeText(batch.pi || "")}</td>
        </tr>
        <tr style="height:4.25mm">
          <td class="label">接收日期：</td>
          <td class="value">${escapeText(formatPrintDate(batch.intakeDate))}</td>
          <td class="label label-long">实验责任人/助手：</td>
          <td class="value">${escapeText(batch.owner || "")}</td>
        </tr>
        <tr style="height:4.25mm">
          <td class="label">接收人员：</td>
          <td class="value">${escapeText(batch.receiverName || "")}</td>
          <td class="label">兽医电话：</td>
          <td class="value">${escapeText(batch.vetPhone || "")}</td>
        </tr>
        <tr style="height:3.3mm">
          <td class="row-head">日期</td>
          <td class="row-head">数目变化</td>
          <td class="row-head">房间</td>
          <td class="row-head">饲养周期</td>
        </tr>
        <tr style="height:4.65mm">
          <td class="value">${escapeText(formatPrintDate(batch.intakeDate))}</td>
          <td class="value">${escapeText(card.suggestedQuantity || "")}</td>
          <td class="room" rowspan="3">${escapeText(batch.roomName || "")}</td>
          <td class="cycle">${escapeText(formatPrintDateRange(batch.intakeDate, batch.endDate))}</td>
        </tr>
        <tr style="height:4.65mm">
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr style="height:4.65mm">
          <td></td>
          <td></td>
          <td></td>
        </tr>
      </table>
    </section>
  `;
}

function renderBatchNoWithHighlightedIacuc(batchNo, iacuc) {
  const full = String(batchNo || "").trim();
  const target = String(iacuc || "").trim();
  if (!full) return "";
  if (!target) return escapeText(full);
  const start = full.indexOf(target);
  if (start < 0) return escapeText(full);
  const before = escapeText(full.slice(0, start));
  const matched = escapeText(full.slice(start, start + target.length));
  const after = escapeText(full.slice(start + target.length));
  return `${before}<span class="batch-iacuc-highlight">${matched}</span>${after}`;
}

function formatPrintDate(value) {
  const normalized = normalizeFlexibleDate(value);
  if (!normalized) return "";
  return normalized;
}

function formatPrintDateRange(startDate, endDate) {
  const start = formatPrintCompactDate(startDate);
  const end = formatPrintCompactDate(endDate);
  return start && end ? `${start}至${end}` : "";
}

function formatPrintCompactDate(value) {
  const normalized = normalizeFlexibleDate(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${year.slice(2)}-${month}-${day}`;
}

function readQuantitySheetForm(form) {
  const data = new FormData(form);
  const room = state.rooms.find((item) => item.id === data.get("roomId"));
  const month = data.get("month") || state.billingMonth || today.slice(0, 7);
  const iacuc = String(data.get("iacuc") || "").trim();
  const iacucInfo = findIacucInfo(iacuc) || {};
  const rows = [...form.querySelectorAll("[data-quantity-row]")]
    .map((row) => {
      const rowIndex = Number(row.dataset.quantityRow);
      const previous = state.quantitySheetDraft?.rows?.[rowIndex] || {};
      const addedType = row.querySelector("[name='addedType']")?.value || "";
      const removedType = row.querySelector("[name='removedType']")?.value || "";
      const transferInFromIacucInput = row.querySelector("[name='transferInFromIacuc']")?.value || "";
      const transferOutToIacucInput = row.querySelector("[name='transferOutToIacuc']")?.value || "";
      return {
        id: previous.id || crypto.randomUUID(),
        date: row.querySelector("[name='rowDate']")?.value || "",
        addedCount: numericOrNull(row.querySelector("[name='addedCount']")?.value),
        addedType,
        transferInFromIacuc: addedType === "转入" ? normalizeIacucNumber(transferInFromIacucInput || previous.transferInFromIacuc || "") : "",
        removedCount: numericOrNull(row.querySelector("[name='removedCount']")?.value),
        removedType,
        transferOutToIacuc: removedType === "转出" ? normalizeIacucNumber(transferOutToIacucInput || previous.transferOutToIacuc || "") : "",
        animalCount: null,
        cageCount: null,
        notes: "",
        transferSourceSheetId: previous.transferSourceSheetId || "",
        transferSourceIacuc: previous.transferSourceIacuc || "",
        transferMirrorContrib: previous.transferMirrorContrib || null,
      };
    })
    .filter((row) => row.date || row.addedCount || row.removedCount);

  return normalizeQuantitySheetDraft({
    id: state.quantitySheetDraft?.id || crypto.randomUUID(),
    month,
    roomId: data.get("roomId") || "",
    roomName: data.get("roomName")?.trim() || room?.name || "",
    manager: data.get("manager")?.trim() || currentUser?.displayName || "",
    iacuc: iacucInfo.iacuc || iacuc,
    project: iacucInfo.project || data.get("project")?.trim() || "",
    pi: iacucInfo.pi || data.get("pi")?.trim() || "",
    owner: iacucInfo.owner || data.get("owner")?.trim() || "",
    contact: "",
    funding: iacucInfo.funding || data.get("funding")?.trim() || "",
    billingUnit: data.get("billingUnit") || billingProfileForRoom(room || {}).unit,
    initialAnimalCount: numericOrZero(data.get("initialAnimalCount")),
    initialCageCount: numericOrZero(data.get("initialCageCount")),
    rows,
  });
}

function makeQuantitySheetDraft(month = today.slice(0, 7)) {
  return normalizeQuantitySheetDraft({
    id: crypto.randomUUID(),
    month,
    roomId: "",
    roomName: "",
    manager: currentUser?.displayName || "",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    contact: "",
    funding: "",
    billingUnit: "cage_day",
    initialAnimalCount: 0,
    initialCageCount: 0,
    rows: [makeQuantitySheetRow(month)],
  });
}

function makeQuantitySheetRow(month = today.slice(0, 7)) {
  return {
    id: crypto.randomUUID(),
    date: `${month}-01`,
    addedCount: null,
    addedType: "",
    transferInFromIacuc: "",
    removedCount: null,
    removedType: "",
    transferOutToIacuc: "",
    animalCount: null,
    cageCount: null,
    notes: "",
  };
}

function normalizeQuantitySheetDraft(sheet) {
  const month = sheet?.month || today.slice(0, 7);
  return {
    id: sheet?.id || crypto.randomUUID(),
    month,
    roomId: sheet?.roomId || "",
    roomName: sheet?.roomName || "",
    manager: sheet?.manager || "",
    iacuc: String(sheet?.iacuc || "").trim(),
    project: sheet?.project || "",
    pi: sheet?.pi || "",
    owner: sheet?.owner || "",
    contact: sheet?.contact || "",
    funding: sheet?.funding || "",
    billingUnit: sheet?.billingUnit === "animal_day" ? "animal_day" : "cage_day",
    initialAnimalCount: numericOrZero(sheet?.initialAnimalCount),
    initialCageCount: numericOrZero(sheet?.initialCageCount),
    rows: Array.isArray(sheet?.rows) ? sheet.rows.map((row) => normalizeQuantitySheetDraftRow(row, month)) : [],
    updatedAt: sheet?.updatedAt || "",
  };
}

function quantitySheetRoomId(sheet) {
  if (sheet?.roomId) return sheet.roomId;
  if (!sheet?.roomName) return "";
  return state.rooms.find((room) => room.name === sheet.roomName)?.id || "";
}

function normalizeQuantitySheetDraftRow(row, month) {
  return {
    id: row?.id || crypto.randomUUID(),
    date: row?.date || `${month}-01`,
    addedCount: numericOrNull(row?.addedCount),
    addedType: row?.addedType || "",
    transferInFromIacuc: normalizeIacucNumber(row?.transferInFromIacuc || ""),
    removedCount: numericOrNull(row?.removedCount),
    removedType: row?.removedType || "",
    transferOutToIacuc: normalizeIacucNumber(row?.transferOutToIacuc || ""),
    animalCount: numericOrNull(row?.animalCount),
    cageCount: numericOrNull(row?.cageCount),
    notes: row?.notes || "",
    transferSourceSheetId: row?.transferSourceSheetId || "",
    transferSourceIacuc: normalizeIacucNumber(row?.transferSourceIacuc || ""),
    transferMirrorContrib: row?.transferMirrorContrib && typeof row.transferMirrorContrib === "object" ? row.transferMirrorContrib : null,
  };
}

function autofillQuantitySheetIacucFields(event) {
  const form = event.target.form;
  const match = findIacucInfo(event.target.value);
  if (!form || !match) return;
  if (form.elements.project) form.elements.project.value = match.project || "";
  if (form.elements.pi) form.elements.pi.value = match.pi || "";
  if (form.elements.owner) form.elements.owner.value = match.owner || "";
  if (form.elements.funding) form.elements.funding.value = match.funding || "";
  event.target.value = match.iacuc;
}

function hydrateQuantitySheetIacucInfo(sheet) {
  const normalized = normalizeQuantitySheetDraft(sheet || {});
  const match = findIacucInfo(normalized.iacuc);
  if (!match) return normalized;
  return normalizeQuantitySheetDraft({
    ...normalized,
    iacuc: match.iacuc || normalized.iacuc,
    project: match.project || normalized.project,
    pi: match.pi || normalized.pi,
    owner: match.owner || normalized.owner,
    funding: match.funding || normalized.funding,
  });
}

function syncQuantitySheetRoomName(event) {
  const form = event.target.form;
  if (form) state.quantitySheetDraft = readQuantitySheetForm(form);
  render();
}

function positionCageEditorPopover() {
  const editor = document.querySelector("#cageEditorPopover");
  const container = document.querySelector(".cage-preview");
  if (!editor || !container) return;

  const selectedSlotId = state.batchMode ? state.selectedSlotIds[0] : state.selectedSlotId;
  const anchor = selectedSlotId ? container.querySelector(`[data-slot="${cssEscape(selectedSlotId)}"]`) : null;
  const fallback = container.querySelector("#openCageEditor") || container;
  const anchorElement = anchor || fallback;
  const gap = 12;
  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchorElement.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  const maxLeft = Math.max(gap, container.clientWidth - editorRect.width - gap);

  let left = anchorRect.right - containerRect.left + gap;
  if (left > maxLeft) left = anchorRect.left - containerRect.left - editorRect.width - gap;
  left = Math.min(Math.max(gap, left), maxLeft);

  let top = anchorRect.top - containerRect.top;
  const viewportBottom = window.innerHeight - containerRect.top - gap;
  const containerBottom = container.clientHeight - gap;
  const maxTop = Math.max(gap, Math.min(containerBottom, viewportBottom) - Math.min(editorRect.height, viewportBottom - gap));
  top = Math.min(Math.max(gap, top), maxTop);

  editor.style.left = `${Math.round(left)}px`;
  editor.style.top = `${Math.round(top)}px`;
}

function showSlotHoverPreview(slotButton) {
  const preview = document.querySelector("#slotHoverPreview");
  const template = slotButton.querySelector(".slot-preview-template");
  if (!preview || !template) return;

  preview.innerHTML = template.innerHTML;
  preview.hidden = false;
  positionSlotHoverPreview(slotButton);
}

function positionSlotHoverPreview(slotButton) {
  const preview = document.querySelector("#slotHoverPreview");
  const container = slotButton.closest(".cage-preview");
  if (!preview || !container || preview.hidden) return;

  const gap = 12;
  const containerRect = container.getBoundingClientRect();
  const slotRect = slotButton.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const maxLeft = Math.max(gap, container.clientWidth - previewRect.width - gap);
  let left = slotRect.right - containerRect.left + gap;
  if (left > maxLeft) left = slotRect.left - containerRect.left - previewRect.width - gap;
  left = Math.min(Math.max(gap, left), maxLeft);

  let top = slotRect.top - containerRect.top;
  const maxTop = Math.max(gap, container.clientHeight - previewRect.height - gap);
  top = Math.min(Math.max(gap, top), maxTop);

  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
}

function hideSlotHoverPreview() {
  const preview = document.querySelector("#slotHoverPreview");
  if (!preview) return;
  preview.hidden = true;
  preview.innerHTML = "";
}

function numericOrNull(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function numericOrZero(value) {
  return Number(value || 0);
}

function syncRackFormIndex(event) {
  state.rackFormDraft = normalizeRackFormDraft({
    ...state.rackFormDraft,
    roomId: event.target.value,
  });
  const indexInput = event.target.form?.elements.index;
  if (indexInput) indexInput.value = suggestedRackIndex(event.target.value);
}

function updateRackFormDraft(event) {
  const form = event.target.form;
  state.rackFormDraft = normalizeRackFormDraft({
    roomId: form?.elements.roomId?.value || state.rackFormDraft?.roomId,
    rows: form?.elements.rows?.value || state.rackFormDraft?.rows,
    cols: form?.elements.cols?.value || state.rackFormDraft?.cols,
  });
}

function normalizeRackFormDraft(draft = {}) {
  return {
    roomId: draft.roomId || "",
    rows: Math.max(Number(draft.rows) || 5, 1),
    cols: Math.max(Number(draft.cols) || 6, 1),
  };
}

function currentRackFormDraft() {
  const draft = normalizeRackFormDraft(state.rackFormDraft);
  const rooms = visibleRooms();
  const roomExists = rooms.some((room) => room.id === draft.roomId);
  return {
    ...draft,
    roomId: roomExists ? draft.roomId : rooms.find((room) => room.id === state.selectedRoomId)?.id || rooms[0]?.id || "",
  };
}

async function handleRoomSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const name = form.get("name").trim();
  const roomId = String(form.get("roomId") || "");
  const existingRoom = roomId ? state.rooms.find((item) => item.id === roomId) : null;
  const room = {
    ...(existingRoom || {}),
    id: existingRoom?.id || `room-${slugify(name)}-${Date.now()}`,
    name,
    area: form.get("area").trim(),
    facility: normalizeFacility(form.get("facility")),
    defaultSpecies: normalizeSpecies(form.get("defaultSpecies")),
    defaultBillingItem: normalizeBillingItem(form.get("defaultBillingItem")),
    defaultCustomerType: normalizeCustomerType(form.get("defaultCustomerType")),
    defaultAnimalCount: Math.max(Number(form.get("defaultAnimalCount")) || 1, 1),
    billingProfileConfigured: Boolean(existingRoom),
    billingProfileConfirmed: Boolean(existingRoom),
    rackCount: existingRoom?.rackCount || 0,
    rows: existingRoom?.rows || 0,
    cols: existingRoom?.cols || 0,
  };

  try {
    const response = await createInfrastructure(existingRoom ? { roomUpdates: [room] } : { rooms: [room] });
    const savedRoom = normalizeRoomDefaults(existingRoom ? (response.roomUpdates || [room])[0] : (response.rooms || [room])[0]);
    if (existingRoom) Object.assign(existingRoom, savedRoom);
    else state.rooms.push(savedRoom);
    state.selectedRoomId = room.id;
    state.selectedRackId = "";
    state.selectedSlotId = "";
    state.activeView = "rooms";
    state.showRoomForm = false;
    state.editingRoomId = "";
    pushLog(`${existingRoom ? "更新" : "新增"}饲养间 ${room.name}`);
    await reloadInfrastructureOverview();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function syncRoomBillingFields(event) {
  const form = event.currentTarget;
  const speciesSelect = form.querySelector("select[name='defaultSpecies']");
  const billingItemSelect = form.querySelector("select[name='defaultBillingItem']");
  if (!speciesSelect || !billingItemSelect) return;
  if (event.target?.name === "defaultSpecies") {
    billingItemSelect.value = billingItemForSpecies(speciesSelect.value);
    return;
  }
  if (event.target?.name === "defaultBillingItem") {
    speciesSelect.value = BILLING_RULES[billingItemSelect.value]?.species || speciesSelect.value;
  }
}

async function handleRackSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  state.rackFormDraft = normalizeRackFormDraft({
    roomId: form.get("roomId"),
    rows: form.get("rows"),
    cols: form.get("cols"),
  });
  const room = state.rooms.find((item) => item.id === state.rackFormDraft.roomId);
  if (!room) {
    showFlashNotice("信息不完整", "请选择有效的饲养间。", "warning");
    return;
  }

  const roomRacks = state.racks.filter((item) => item.roomId === room.id);
  const rackIndex = Number(form.get("index"));
  if (roomRacks.some((item) => Number(item.index) === rackIndex)) {
    showFlashNotice("无法新增笼架", "同一饲养间内笼架编号不能重复。", "warning");
    return;
  }
  const rows = state.rackFormDraft.rows;
  const cols = state.rackFormDraft.cols;
  const rackId = `rack-${room.id.replace(/^room-/, "")}-${Date.now()}`;
  const generated = generateRackInfrastructure(room, rackIndex, rows, cols, rackId);
  const updatedRoom = { ...room, rackCount: roomRacks.length + 1 };

  try {
    const response = await createInfrastructure({
      roomUpdates: [updatedRoom],
      racks: [generated.rack],
      slots: generated.slots,
    });

    Object.assign(room, (response.roomUpdates || [updatedRoom])[0]);
    state.racks.push(...(response.racks || [generated.rack]));
    state.slots.push(...(response.slots || generated.slots));
    state.selectedRoomId = room.id;
    state.selectedRackId = generated.rack.id;
    state.selectedSlotId = generated.slots[0]?.id;
    state.activeView = "rooms";
    state.editingRackId = "";
    state.showRackForm = false;
    pushLog(`新增${room.name} 笼架 ${rackCode(rackIndex)}`);
    await reloadInfrastructureOverview();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function handleRackEditSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const rackId = form.get("rackId");
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) return;

  const room = state.rooms.find((item) => item.id === rack.roomId);
  if (!room) {
    showFlashNotice("无法保存笼架", "笼架关联的饲养间不存在。", "error");
    return;
  }

  const rackIndex = Number(form.get("index"));
  const duplicate = state.racks.some((item) => item.roomId === room.id && item.id !== rack.id && Number(item.index) === rackIndex);
  if (duplicate) {
    showFlashNotice("无法保存笼架", "同一饲养间内笼架编号不能重复。", "warning");
    return;
  }

  const rows = Number(form.get("rows"));
  const cols = Number(form.get("cols"));
  const generated = generateRackInfrastructure(room, rackIndex, rows, cols, rack.id);
  const existingSlots = state.slots.filter((slot) => slot.rackId === rack.id);
  const nextSlots = generated.slots;
  const nextPositions = new Set(nextSlots.map(slotPositionKey));
  const existingPositions = new Set(existingSlots.map(slotPositionKey));
  const slotCreates = nextSlots.filter((slot) => !existingPositions.has(slotPositionKey(slot)));
  const slotDeletes = existingSlots.filter((slot) => !nextPositions.has(slotPositionKey(slot)));
  const activeDeleted = slotDeletes.filter((slot) => currentOccupancy(slot.id));
  if (activeDeleted.length) {
    showFlashNotice("无法缩小笼架", `缩小行列范围会移除 ${activeDeleted.length} 个在用或预约笼位，请先处理这些笼位。`, "warning");
    return;
  }

  try {
    const response = await createInfrastructure({
      rackUpdates: [generated.rack],
      slots: slotCreates,
      slotDeletes: slotDeletes.map((slot) => slot.id),
    });

    Object.assign(rack, (response.rackUpdates || [generated.rack])[0]);
    state.slots.push(...(response.slots || slotCreates));
    const deletedIds = new Set(response.slotDeletes || slotDeletes.map((slot) => slot.id));
    state.slots = state.slots.filter((slot) => !deletedIds.has(slot.id));
    state.selectedSlotIds = state.selectedSlotIds.filter((slotId) => !deletedIds.has(slotId));
    state.editingRackId = "";
    state.selectedRackId = rack.id;
    state.selectedSlotId = state.slots.find((slot) => slot.rackId === rack.id)?.id || "";
    pushLog(`更新${room.name} 笼架 ${rackCode(rack)}`);
    await reloadInfrastructureOverview();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function deleteRoom(roomId) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;

  if (state.rooms.length <= 1) {
    showFlashNotice("无法删除饲养间", "至少需要保留一个饲养间。", "warning");
    return;
  }

  const racks = state.racks.filter((rack) => rack.roomId === roomId);
  const slotCount = numericOrZero(roomSummaryById(roomId)?.slotCount);
  const occupancyCount = numericOrZero(roomSummaryById(roomId)?.occupancyRecordCount);
  const message = occupancyCount
    ? `确定删除 ${room.name}？这会删除 ${racks.length} 个笼架和 ${slotCount} 个笼位，${occupancyCount} 条占用记录会作为历史保留。`
    : `确定删除 ${room.name}？这会同时删除 ${racks.length} 个笼架和 ${slotCount} 个笼位。`;

  openConfirmDialog({
    type: "delete-room",
    id: roomId,
    title: "删除饲养间",
    message,
    confirmLabel: "删除",
    payload: { roomName: room.name },
  });
}

async function deleteRoomConfirmed(roomId) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  const racks = state.racks.filter((rack) => rack.roomId === roomId);
  try {
    await deleteEntityRequest("rooms", roomId);
    state.rooms = state.rooms.filter((item) => item.id !== roomId);
    state.racks = state.racks.filter((rack) => rack.roomId !== roomId);
    const remainingRackIds = new Set(state.racks.map((rack) => rack.id));
    state.slots = state.slots.filter((slot) => remainingRackIds.has(slot.rackId));
    state.selectedSlotIds = state.selectedSlotIds.filter((slotId) => state.slots.some((slot) => slot.id === slotId));
    if (racks.some((rack) => rack.id === state.editingRackId)) state.editingRackId = "";
    pushLog(`删除饲养间 ${room.name}`);
    refreshInfrastructureSummaries();
    selectFirstAvailableCage();
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

async function deleteRack(rackId) {
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) return;

  const room = state.rooms.find((item) => item.id === rack.roomId);
  const roomRacks = state.racks.filter((item) => item.roomId === rack.roomId);
  const slotCount = numericOrZero(rackSummaryById(rackId)?.slotCount);
  const occupancyCount = numericOrZero(rackSummaryById(rackId)?.occupancyRecordCount);
  const rackLabel = `${room?.name ?? "饲养间"} 笼架 ${rackCode(rack)}`;
  const message = occupancyCount
    ? `确定删除 ${rackLabel}？这会删除 ${slotCount} 个笼位，${occupancyCount} 条占用记录会作为历史保留。`
    : `确定删除 ${rackLabel}？这会同时删除 ${slotCount} 个笼位。`;

  openConfirmDialog({
    type: "delete-rack",
    id: rackId,
    title: "删除笼架",
    message,
    confirmLabel: "删除",
    payload: { rackLabel },
  });
}

async function deleteRackConfirmed(rackId) {
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) return;
  const room = state.rooms.find((item) => item.id === rack.roomId);
  const roomRacks = state.racks.filter((item) => item.roomId === rack.roomId);
  const slotIds = new Set(state.slots.filter((slot) => slot.rackId === rackId).map((slot) => slot.id));
  const rackLabel = `${room?.name ?? "饲养间"} 笼架 ${rackCode(rack)}`;
  try {
    const updatedRoom = room ? { ...room, rackCount: Math.max(roomRacks.length - 1, 0) } : null;
    await createInfrastructure({
      roomUpdates: updatedRoom ? [updatedRoom] : [],
      rackDeletes: [rackId],
    });
    state.racks = state.racks.filter((item) => item.id !== rackId);
    state.slots = state.slots.filter((slot) => slot.rackId !== rackId);
    state.selectedSlotIds = state.selectedSlotIds.filter((slotId) => !slotIds.has(slotId));
    if (state.editingRackId === rackId) state.editingRackId = "";
    if (room) {
      Object.assign(room, updatedRoom);
    }
    pushLog(`删除${rackLabel}`);
    refreshInfrastructureSummaries();
    selectFirstAvailableCage();
    updateSlotStatuses();
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function suggestedRackIndex(roomId) {
  const indexes = state.racks
    .filter((item) => item.roomId === roomId)
    .map((item) => Number(item.index))
    .filter((value) => Number.isFinite(value) && value > 0);
  return indexes.length ? Math.max(...indexes) + 1 : 1;
}

function slotPositionKey(slot) {
  return `${Number(slot.row)}:${Number(slot.col)}`;
}

function selectFirstAvailableCage() {
  const rooms = visibleRooms();
  const room = rooms.find((item) => item.id === state.selectedRoomId) ?? rooms[0];
  state.selectedRoomId = room?.id;

  const rack =
    state.racks.find((item) => item.id === state.selectedRackId && item.roomId === state.selectedRoomId) ??
    state.racks.find((item) => item.roomId === state.selectedRoomId);
  state.selectedRackId = rack?.id;

  const slot =
    state.slots.find((item) => item.id === state.selectedSlotId && item.rackId === state.selectedRackId) ??
    state.slots.find((item) => item.rackId === state.selectedRackId);
  state.selectedSlotId = slot?.id;
  state.selectedSlotIds = state.selectedSlotIds.filter((id) => state.slots.some((slotItem) => slotItem.id === id));
}

function buildQuantitySheetStatement(sheet) {
  const normalizedSheet = normalizeQuantitySheetDraft(sheet);
  const month = normalizedSheet.month || state.billingMonth;
  const pi = normalizedSheet.pi || state.billingPi || "";
  const sheets = quantitySheetsForStatement(normalizedSheet, month, pi);
  const dates = datesInMonth(month);
  const sheetStates = sheets.map((item) => {
    const rowsByDate = new Map();
    for (const row of item.rows || []) {
      if (!row.date) continue;
      rowsByDate.set(row.date, [...(rowsByDate.get(row.date) || []), row]);
    }
    return {
      sheet: item,
      rowsByDate,
      animalCount: numericOrZero(item.initialAnimalCount),
      cageCount: numericOrZero(item.initialCageCount),
      profile: billingProfileForRoom(state.rooms.find((room) => room.id === quantitySheetRoomId(item)) || {}),
    };
  });
  const sheetStateByIacuc = new Map(sheetStates.map((item) => [normalizeIacucNumber(item.sheet.iacuc), item]).filter(([key]) => key));

  const freeCageAllowance = freeCageAllowanceForPi(pi);
  let cumulative = 0;
  const rows = dates.map((date) => {
    const transferDeltas = new Map();
    let animalCount = 0;
    let cageCount = 0;
    const quantitySheetRowIds = [];
    const iacucBreakdown = [];
    const chargeGroups = new Map();
    for (const item of sheetStates) {
      const dayRows = item.rowsByDate.get(date) || [];
      for (const row of dayRows) {
        const addedCount = numericOrZero(row.addedCount);
        const removedCount = numericOrZero(row.removedCount);
        if (item.profile.unit === "animal_day") {
          item.animalCount = row.animalCount !== null ? numericOrZero(row.animalCount) : Math.max(item.animalCount + addedCount - removedCount, 0);
          if (row.cageCount !== null) item.cageCount = numericOrZero(row.cageCount);
        } else {
          if (row.animalCount !== null) item.animalCount = numericOrZero(row.animalCount);
          if (row.cageCount !== null) item.cageCount = numericOrZero(row.cageCount);
          else item.cageCount = Math.max(item.cageCount + addedCount - removedCount, 0);
        }
        const transferOutToIacuc = normalizeIacucNumber(row.transferOutToIacuc);
        if (transferOutToIacuc && removedCount > 0) {
          transferDeltas.set(transferOutToIacuc, numericOrZero(transferDeltas.get(transferOutToIacuc)) + removedCount);
        }
        const transferInFromIacuc = normalizeIacucNumber(row.transferInFromIacuc);
        if (transferInFromIacuc && addedCount > 0) {
          transferDeltas.set(transferInFromIacuc, numericOrZero(transferDeltas.get(transferInFromIacuc)) - addedCount);
        }
      }
      quantitySheetRowIds.push(...dayRows.map((row) => row.id));
    }
    for (const [iacuc, delta] of transferDeltas.entries()) {
      const target = sheetStateByIacuc.get(iacuc);
      if (!target) continue;
      if (target.profile.unit === "animal_day") target.animalCount = Math.max(numericOrZero(target.animalCount) + delta, 0);
      else target.cageCount = Math.max(numericOrZero(target.cageCount) + delta, 0);
    }
    for (const item of sheetStates) {
      animalCount += item.animalCount;
      cageCount += item.cageCount;
      const billableCount = item.profile.unit === "animal_day" ? item.animalCount : item.cageCount;
      addChargeGroup(chargeGroups, item.profile, billableCount);
      if (item.cageCount || item.animalCount) {
        iacucBreakdown.push({
          iacuc: item.sheet.iacuc,
          project: item.sheet.project,
          animalCount: item.animalCount,
          cageCount: item.cageCount,
          billingItem: item.profile.billingItem,
          billingUnit: item.profile.unit,
        });
      }
    }
    const charge = combinedDailyCharge(chargeGroups, freeCageAllowance);
    const amount = charge.amount;
    cumulative += amount;
    return {
      date,
      animalCount,
      cageCount,
      ...charge,
      amount,
      cumulative,
      iacucBreakdown,
      quantitySheetRowIds,
    };
  });

  const iacucs = [...new Set(sheets.map((item) => item.iacuc).filter(Boolean))].sort();
  return {
    iacuc: iacucs.join("、") || normalizedSheet.iacuc,
    iacucs,
    month,
    project: uniqueJoined(sheets.map((item) => item.project)),
    pi,
    owner: uniqueJoined(sheets.map((item) => item.owner)),
    funding: uniqueJoined(sheets.map((item) => item.funding)),
    roomName: uniqueJoined(sheets.map((item) => item.roomName)),
    manager: uniqueJoined(sheets.map((item) => item.manager)),
    sourceType: "quantity_sheet",
    sourceId: normalizedSheet.id,
    sourceIds: sheets.map((item) => item.id),
    billingUnit: statementBillingUnitFromRows(rows),
    unitPrice: rows.find((row) => row.unitPrice)?.unitPrice ?? BILLING_TIER_BASE_PRICE,
    baseUnitPrice: BILLING_TIER_BASE_PRICE,
    overageUnitPrice: BILLING_TIER_OVER_PRICE,
    tierLimit: BILLING_TIER_LIMIT,
    freeCageAllowance,
    rows,
    totalCageDays: rows.reduce((sum, row) => sum + row.cageCount, 0),
    totalAnimalDays: rows.reduce((sum, row) => sum + row.animalCount, 0),
    totalFreeCageDays: rows.reduce((sum, row) => sum + row.freeCages, 0),
    totalBillableCageDays: rows.reduce((sum, row) => sum + row.billableCages, 0),
    totalTier1CageDays: rows.reduce((sum, row) => sum + row.tier1BillableCages, 0),
    totalTier2CageDays: rows.reduce((sum, row) => sum + row.tier2BillableCages, 0),
    totalAmount: cumulative,
  };
}

function buildStatement(pi, month) {
  const dates = datesInMonth(month);
  let cumulative = 0;
  const normalizedPi = normalizePersonName(pi);
  const freeCageAllowance = freeCageAllowanceForPi(pi);
  const piOccupancies = occupanciesForPi(pi);
  const profileByOccupancyId = new Map();
  const profileForItem = (item) => {
    if (profileByOccupancyId.has(item.id)) return profileByOccupancyId.get(item.id);
    const profile = billingProfileForOccupancy(item);
    profileByOccupancyId.set(item.id, profile);
    return profile;
  };

  const rows = dates.map((date) => {
    const activeItems = activeOccupanciesOnDate(date, piOccupancies);
    const chargeGroups = new Map();
    activeItems.forEach((item) => {
      const profile = profileForItem(item);
      const count = profile.unit === "animal_day" ? occupancyAnimalCount(item, profile) : 1;
      addChargeGroup(chargeGroups, profile, count);
    });
    const charge = combinedDailyCharge(chargeGroups, freeCageAllowance);
    const amount = charge.amount;
    cumulative += amount;

    return {
      date,
      animalCount: activeItems.reduce((sum, item) => {
        const profile = profileForItem(item);
        return sum + (profile.unit === "animal_day" ? occupancyAnimalCount(item, profile) : 0);
      }, 0),
      cageCount: activeItems.filter((item) => profileForItem(item).unit === "cage_day").length,
      ...charge,
      amount,
      cumulative,
      iacucBreakdown: occupancyBreakdown(activeItems),
    };
  });

  const iacucs = [...new Set(piOccupancies.map((item) => normalizeIacucNumber(item.iacuc)).filter(Boolean))].sort();
  const info = piInfo(pi);
  return {
    iacuc: iacucs.join("、"),
    iacucs,
    month,
    project: info.project,
    pi,
    owner: info.owner,
    funding: info.funding,
    sourceType: "cage_map",
    billingUnit: statementBillingUnitFromRows(rows),
    unitPrice: rows.find((row) => row.unitPrice)?.unitPrice ?? BILLING_TIER_BASE_PRICE,
    baseUnitPrice: BILLING_TIER_BASE_PRICE,
    overageUnitPrice: BILLING_TIER_OVER_PRICE,
    tierLimit: BILLING_TIER_LIMIT,
    freeCageAllowance,
    rows,
    totalCageDays: rows.reduce((sum, row) => sum + row.cageCount, 0),
    totalAnimalDays: rows.reduce((sum, row) => sum + row.animalCount, 0),
    totalFreeCageDays: rows.reduce((sum, row) => sum + row.freeCages, 0),
    totalBillableCageDays: rows.reduce((sum, row) => sum + row.billableCages, 0),
    totalTier1CageDays: rows.reduce((sum, row) => sum + row.tier1BillableCages, 0),
    totalTier2CageDays: rows.reduce((sum, row) => sum + row.tier2BillableCages, 0),
    totalAmount: cumulative,
  };
}

function activeOccupanciesOnDate(date, candidates = stateIndexes().billableOccupancies) {
  return candidates.filter((item) => {
    if (item.status !== "active" && item.status !== "ended") return false;
    if (!item.startDate || item.startDate > date) return false;
    if (item.endDate && item.endDate < date) return false;
    return true;
  });
}

function tieredDailyCharge(cageCount, freeCageAllowance) {
  const totalCages = Math.max(numericOrZero(cageCount), 0);
  const freeCages = Math.min(Math.max(numericOrZero(freeCageAllowance), 0), totalCages);
  const tier1Cages = Math.min(totalCages, BILLING_TIER_LIMIT);
  const tier2Cages = Math.max(totalCages - BILLING_TIER_LIMIT, 0);
  const tier1Free = Math.min(freeCages, tier1Cages);
  const tier2Free = Math.min(Math.max(freeCages - tier1Free, 0), tier2Cages);
  const tier1BillableCages = Math.max(tier1Cages - tier1Free, 0);
  const tier2BillableCages = Math.max(tier2Cages - tier2Free, 0);
  return {
    freeCages,
    billableCages: tier1BillableCages + tier2BillableCages,
    tier1Cages,
    tier2Cages,
    tier1BillableCages,
    tier2BillableCages,
    unitPrice: BILLING_TIER_BASE_PRICE,
    overageUnitPrice: BILLING_TIER_OVER_PRICE,
    discountPercent: 0,
    amount: tier1BillableCages * BILLING_TIER_BASE_PRICE + tier2BillableCages * BILLING_TIER_OVER_PRICE,
  };
}

function flatDailyCharge(count, profile) {
  const quantity = Math.max(numericOrZero(count), 0);
  const amount = quantity * numericOrZero(profile.unitPrice);
  return {
    freeCages: 0,
    billableCages: profile.unit === "cage_day" ? quantity : 0,
    billableAnimals: profile.unit === "animal_day" ? quantity : 0,
    tier1Cages: profile.unit === "cage_day" ? quantity : 0,
    tier2Cages: 0,
    tier1BillableCages: profile.unit === "cage_day" ? quantity : 0,
    tier2BillableCages: 0,
    unitPrice: profile.unitPrice,
    overageUnitPrice: 0,
    discountPercent: 0,
    amount,
  };
}

function addChargeGroup(groups, profile, count) {
  const quantity = Math.max(numericOrZero(count), 0);
  if (!quantity) return;
  const key = [profile.billingItem, profile.customerType, profile.unit, profile.unitPrice].join("|");
  const current = groups.get(key) || { profile, count: 0 };
  current.count += quantity;
  groups.set(key, current);
}

function combinedDailyCharge(groups, freeCageAllowance) {
  const totals = {
    freeCages: 0,
    billableCages: 0,
    billableAnimals: 0,
    tier1Cages: 0,
    tier2Cages: 0,
    tier1BillableCages: 0,
    tier2BillableCages: 0,
    unitPrice: 0,
    overageUnitPrice: 0,
    discountPercent: 0,
    amount: 0,
  };
  for (const { profile, count } of groups.values()) {
    const charge = profile.tiered
      ? tieredDailyCharge(count, profile.freeAllowance ? freeCageAllowance : 0)
      : flatDailyCharge(count, profile);
    Object.keys(totals).forEach((key) => {
      if (key === "unitPrice" || key === "overageUnitPrice" || key === "discountPercent") return;
      totals[key] += numericOrZero(charge[key]);
    });
    if (!totals.unitPrice && charge.unitPrice) totals.unitPrice = charge.unitPrice;
    if (!totals.overageUnitPrice && charge.overageUnitPrice) totals.overageUnitPrice = charge.overageUnitPrice;
  }
  return totals;
}

function statementBillingUnitFromRows(rows) {
  const hasAnimals = rows.some((row) => numericOrZero(row.animalCount) > 0);
  const hasCages = rows.some((row) => numericOrZero(row.cageCount) > 0);
  if (hasAnimals && hasCages) return "mixed";
  return hasAnimals ? "animal_day" : "cage_day";
}

function quantitySheetsForStatement(currentSheet, month, pi) {
  const normalizedPi = normalizePersonName(pi);
  const byId = new Map();
  [...quantitySheetsForMonth(month), currentSheet].forEach((sheet) => {
    const normalized = normalizeQuantitySheetDraft(sheet);
    if (normalized.month === month && normalizePersonName(normalized.pi) === normalizedPi) byId.set(normalized.id, normalized);
  });
  return [...byId.values()].sort((a, b) => a.iacuc.localeCompare(b.iacuc, "zh-CN"));
}

function filteredBillingWorkflows() {
  const items = [...stateIndexes().billingWorkflowsSorted];
  if (state.billingWorkflowFilter === "done") {
    return items.filter((item) => item.workflowStatus === "submitted_to_finance");
  }
  if (state.billingWorkflowFilter === "todo") {
    return items.filter((item) => workflowIsTodo(item));
  }
  return items;
}

function sortBillingWorkflows(items) {
  return [...items].sort((a, b) => {
    const byMonth = String(b.month || "").localeCompare(String(a.month || ""), "zh-CN");
    if (byMonth !== 0) return byMonth;
    return String(a.iacuc || "").localeCompare(String(b.iacuc || ""), "zh-CN");
  });
}

function workflowIsTodo(item) {
  return item.workflowStatus && item.workflowStatus !== "submitted_to_finance";
}

function workflowSourceLabel(value) {
  return {
    cage_map: "动态笼位图",
    quantity_sheet: "数量统计表",
    pi_merged_cage_map: "动态笼位图（按 PI 合表）",
    pi_merged_quantity_sheet: "数量统计表（按 PI 合表）",
  }[value] || value || "-";
}

function workflowStatusLabel(value) {
  return {
    in_feeding: "饲养中",
    statement_generated: "已生成结算单",
    statement_sent: "已发送",
    statement_signed_returned: "已签字交回",
    submitted_to_finance: "已交财务",
  }[value] || value || "-";
}

function nextWorkflowStatus(value) {
  return {
    statement_generated: "statement_sent",
    statement_sent: "statement_signed_returned",
    statement_signed_returned: "submitted_to_finance",
  }[value] || "";
}

function workflowActionLabel(nextStatus) {
  return {
    statement_sent: "标记已发送",
    statement_signed_returned: "标记已签回",
    submitted_to_finance: "标记已交财务",
  }[nextStatus] || "推进流程";
}

function workflowEventLabel(value) {
  return {
    statement_generated: "生成结算单",
    statement_revised: "生成修订版",
    statement_voided: "旧版本作废",
    statement_sent: "标记已发送",
    statement_signed_returned: "标记已签字交回",
    submitted_to_finance: "标记已交财务",
  }[value] || value || "-";
}

function workflowTimelineItems(workflow) {
  const order = [
    ["statement_generated", "已生成结算单", workflow.generatedAt],
    ["statement_sent", "已发送", workflow.sentAt],
    ["statement_signed_returned", "已签字交回", workflow.signedReturnedAt],
    ["submitted_to_finance", "已交财务", workflow.submittedToFinanceAt],
  ];
  const currentIndex = order.findIndex(([status]) => status === workflow.workflowStatus);
  return order.map(([status, label, time], index) => ({
    status,
    label,
    time: time ? formatLogTime(time) : "",
    state: index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming",
  }));
}

function occupancyBreakdown(items) {
  const byIacuc = new Map();
  items.forEach((item) => {
    const iacuc = normalizeIacucNumber(item.iacuc);
    if (!iacuc) return;
    const profile = billingProfileForOccupancy(item);
    const current = byIacuc.get(iacuc) || { iacuc, project: item.project || "", animalCount: 0, cageCount: 0 };
    if (profile.unit === "animal_day") current.animalCount += occupancyAnimalCount(item, profile);
    else current.cageCount += 1;
    byIacuc.set(iacuc, current);
  });
  return [...byIacuc.values()].sort((a, b) => a.iacuc.localeCompare(b.iacuc, "zh-CN"));
}

function freeCageAllowanceForPi(pi) {
  return freeCageAllowanceForPrincipalType(principalTypeForPi(pi));
}

function principalTypeForPi(pi) {
  const normalizedPi = normalizePersonName(pi);
  const identity = PRINCIPAL_IDENTITY_BY_NAME.get(normalizedPi);
  if (identity?.principalType) return normalizePrincipalType(identity.principalType);
  return BILLING_PRINCIPAL_INDEPENDENT;
}

function normalizePrincipalType(value) {
  return value === BILLING_PRINCIPAL_INDEPENDENT ? BILLING_PRINCIPAL_INDEPENDENT : BILLING_PRINCIPAL_PI;
}

function freeCageAllowanceForPrincipalType(value) {
  return normalizePrincipalType(value) === BILLING_PRINCIPAL_INDEPENDENT ? FREE_CAGES_INDEPENDENT : FREE_CAGES_PI;
}

function principalTypeLabel(value) {
  return normalizePrincipalType(value) === BILLING_PRINCIPAL_INDEPENDENT ? "独立科研人员" : "PI";
}

function principalIdentityRows() {
  const byPi = new Map();
  const add = (pi, iacuc = "") => {
    const name = String(pi || "").trim();
    if (!name) return;
    const key = normalizePersonName(name);
    const current = byPi.get(key) || {
      pi: name,
      iacucs: new Set(),
      principalType: principalTypeForPi(name),
    };
    if (iacuc) current.iacucs.add(normalizeIacucNumber(iacuc));
    byPi.set(key, current);
  };
  IACUC_INDEX.forEach((item) => add(item.pi, item.iacuc));
  state.occupancies.forEach((item) => add(item.pi, item.iacuc));
  state.quantitySheets.forEach((item) => add(item.pi, item.iacuc));
  PRINCIPAL_IDENTITIES.forEach((item) => add(item.pi));
  return [...byPi.values()]
    .map((item) => ({
      pi: item.pi,
      principalType: principalTypeForPi(item.pi),
      iacucCount: [...item.iacucs].filter(Boolean).length,
    }))
    .sort((a, b) => a.pi.localeCompare(b.pi, "zh-CN"));
}

function filteredPrincipalIdentityRows(items) {
  const keyword = normalizeSearchText(state.principalIdentityFilter);
  if (!keyword) return items;
  return items.filter((item) => {
    const typeLabel = principalTypeLabel(item.principalType);
    const freeCages = String(freeCageAllowanceForPrincipalType(item.principalType));
    return normalizeSearchText(`${item.pi} ${typeLabel} ${item.principalType} ${freeCages}`).includes(keyword);
  });
}

function normalizeSearchText(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function piInfo(pi) {
  const normalizedPi = normalizePersonName(pi);
  const applications = IACUC_INDEX.filter((item) => normalizePersonName(item.pi) === normalizedPi);
  const occupancies = occupanciesForPi(pi);
  return {
    project: uniqueJoined([...applications.map((item) => item.project), ...occupancies.map((item) => item.project)]),
    pi,
    owner: uniqueJoined([...applications.map((item) => item.owner), ...occupancies.map((item) => item.owner)]),
    funding: uniqueJoined([...applications.map((item) => item.funding), ...occupancies.map((item) => item.funding)]),
  };
}

function uniqueJoined(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")).join("、");
}

function unitPriceFor(date) {
  const rule = state.billingRules.find((item) => {
    const afterStart = !item.effectiveStart || item.effectiveStart <= date;
    const beforeEnd = !item.effectiveEnd || item.effectiveEnd >= date;
    return item.unit === "cage_day" && afterStart && beforeEnd;
  });
  return Number(rule?.price ?? state.baseRate ?? 4.5);
}

function discountFor(iacuc, date) {
  const adjustment = state.adjustments.find((item) => {
    const inRange = (!item.effectiveStart || item.effectiveStart <= date) && (!item.effectiveEnd || item.effectiveEnd >= date);
    return item.targetType === "iacuc" && item.targetId === iacuc && item.type === "discount" && inRange;
  });
  return Number(adjustment?.value ?? 0);
}

async function exportBillingCsv() {
  const { statement } = await statementForExport().catch((error) => {
    reportSaveError(error);
    return {};
  });
  if (!statement) return;
  const isQuantitySheet = statement.sourceType === "quantity_sheet" || statement.sourceType === "pi_merged_quantity_sheet";
  const header = isQuantitySheet
    ? ["日期", "结余动物数", "合计笼数", "免费笼数", "收费笼数", "4.5元笼数", "6.5元笼数", "当日费用", "累计费用", "伦理明细"]
    : ["日期", "合计笼数", "免费笼数", "收费笼数", "4.5元笼数", "6.5元笼数", "当日费用", "累计费用", "伦理明细"];
  const rows = statement.rows.map((row) => [
    row.date,
    ...(isQuantitySheet ? [row.animalCount, row.cageCount] : [row.cageCount]),
    row.freeCages,
    row.billableCages,
    row.tier1BillableCages,
    row.tier2BillableCages,
    row.amount.toFixed(2),
    row.cumulative.toFixed(2),
    (row.iacucBreakdown || []).map((item) => `${item.iacuc}:${item.cageCount}笼`).join("；"),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${statement.pi || state.billingPi || state.billingIacuc}-${statement.month || state.billingMonth}-饲养明细.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportSettlementPdf() {
  const opened = window.open("", "_blank");
  if (!opened) {
    showFlashNotice("打开失败", "浏览器阻止了弹出窗口，请允许弹出窗口后重试。", "error");
    return;
  }

  const exportData = await statementForExport().catch((error) => {
    opened.close();
    reportSaveError(error);
    return null;
  });
  if (!exportData) return;

  const { statement, info } = exportData;
  const rowsWithCages = statement.rows.filter((row) => row.cageCount > 0);
  const nonZeroRows = rowsWithCages.length ? rowsWithCages : statement.rows;

  opened.document.write(settlementHtml(statement, info, nonZeroRows));
  opened.document.close();
  opened.focus();
  opened.print();
}

async function persistBillingWorkflowFromCurrent() {
  const startedAt = performance.now();
  if (!remotePersistence) {
    throw new Error("本地离线模式不支持结算流程跟踪");
  }
  if (state.billingSource === "quantity_sheet") {
    const sheet = await saveQuantitySheetDraft();
    if (!sheet.pi || !sheet.month) throw new Error("请先完善数量统计表中的结算月份和项目负责人");
    const response = await fetch(API_BILLING_STATEMENT_GENERATE_BY_PI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pi: sheet.pi,
        month: sheet.month,
        sourceType: "quantity_sheet",
        status: "draft",
        persist: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      currentUser = null;
      render();
      throw new Error("请先登录");
    }
    if (!response.ok) throw new Error(payload.error || "发起结算流程失败");
    mergeServerAuditLogs(payload);
    if (payload.workflow) upsertById(state.billingWorkflows, payload.workflow);
    lazyDataState.billingWorkflowsLoaded = true;
    lazyDataState.billingWorkflowsLoading = false;
    logClientPerf("billing_workflow.create", startedAt, { source: "quantity_sheet" });
    pushLog(`发起结算流程：${sheet.pi} ${sheet.month}`);
    showFlashNotice("发起成功", `结算流程已创建，请到流程中心跟踪 ${sheet.month} ${sheet.pi} 的进度。`);
    return payload.statement;
  }
  if (!state.billingPi || !state.billingMonth) {
    throw new Error("请先选择项目负责人和结算月份");
  }
  const response = await fetch(API_BILLING_STATEMENT_GENERATE_BY_PI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pi: state.billingPi,
      month: state.billingMonth,
      sourceType: "cage_map",
      status: "draft",
      persist: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) throw new Error(payload.error || "发起结算流程失败");
  mergeServerAuditLogs(payload);
  if (payload.workflow) upsertById(state.billingWorkflows, payload.workflow);
  lazyDataState.billingWorkflowsLoaded = true;
  lazyDataState.billingWorkflowsLoading = false;
  logClientPerf("billing_workflow.create", startedAt, { source: "cage_map" });
  pushLog(`发起结算流程：${state.billingPi} ${state.billingMonth}`);
  showFlashNotice("发起成功", `结算流程已创建，请到流程中心跟踪 ${state.billingMonth} ${state.billingPi} 的进度。`);
  return payload.statement;
}

function closeBillingWorkflowDetail() {
  state.selectedBillingWorkflowId = "";
  state.selectedBillingWorkflowDetail = null;
  state.showWorkflowStatements = false;
  render();
}

async function statementForExport() {
  if (state.billingSource === "quantity_sheet") {
    return quantitySheetStatementForExport();
  }
  if (!state.billingPi || !state.billingMonth) {
    throw new Error("请先选择项目负责人和结算月份");
  }
  if (!remotePersistence) {
    const statement = buildStatement(state.billingPi, state.billingMonth);
    return { statement, info: statementInfoForExport(statement) };
  }
  if (currentUser?.role !== "admin") {
    throw new Error("共享模式下只有系统管理员可以生成和导出正式结算单");
  }

  const response = await fetch(API_BILLING_STATEMENT_GENERATE_BY_PI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pi: state.billingPi,
      month: state.billingMonth,
      sourceType: "cage_map",
      status: "draft",
      persist: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "生成结算单失败");
  }
  if (!payload.statement) {
    throw new Error("生成结算单失败：服务端未返回结算单");
  }

  mergeServerAuditLogs(payload);
  const statement = statementPayloadForExport(payload.statement, payload.lines || []);
  pushLog(`生成结算单：${statement.pi} ${statement.month}，应收 ${MONEY_FORMAT.format(statement.totalAmount)} 元`);
  render();
  return { statement, info: statementInfoForExport(statement) };
}

async function quantitySheetStatementForExport() {
  const sheet = await saveQuantitySheetDraft();
  if (!sheet.iacuc || !sheet.month) {
    throw new Error("请先填写 IACUC 编号和结算月份");
  }
  if (!sheet.pi) {
    throw new Error("请先填写项目负责人后再导出结算单");
  }
  if (!remotePersistence) {
    const statement = buildQuantitySheetStatement(sheet);
    return { statement, info: statementInfoForExport(statement) };
  }

  const response = await fetch(API_BILLING_STATEMENT_GENERATE_BY_PI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pi: sheet.pi,
      month: sheet.month,
      sourceType: "quantity_sheet",
      status: "draft",
      persist: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    currentUser = null;
    render();
    throw new Error("请先登录");
  }
  if (!response.ok) {
    throw new Error(payload.error || "根据数量统计表生成结算单失败");
  }
  if (!payload.statement) {
    throw new Error("生成结算单失败：服务端未返回结算单");
  }

  mergeServerAuditLogs(payload);
  const statement = statementPayloadForExport(payload.statement, payload.lines || []);
  pushLog(`按 PI 汇总数量统计表生成结算单：${statement.pi || statement.iacuc} ${statement.month}，应收 ${MONEY_FORMAT.format(statement.totalAmount)} 元`);
  render();
  return { statement, info: statementInfoForExport(statement) };
}

function statementPayloadForExport(statement, lines) {
  const rows = lines.map((line) => ({
    date: line.date,
    animalCount: Number(line.animalCount || 0),
    cageCount: Number(line.cageCount || 0),
    freeCages: Number(line.freeCages || 0),
    billableCages: Number(line.billableCages ?? line.billableCount ?? line.cageCount ?? 0),
    tier1BillableCages: Number(line.tier1BillableCages || 0),
    tier2BillableCages: Number(line.tier2BillableCages || 0),
    unitPrice: Number(line.unitPrice || 0),
    overageUnitPrice: Number(line.overageUnitPrice || 0),
    discountPercent: Number(line.discountPercent || 0),
    amount: Number(line.amount || 0),
    cumulative: Number(line.cumulative || 0),
    iacucBreakdown: Array.isArray(line.iacucBreakdown) ? line.iacucBreakdown : [],
  }));
  return {
    ...statement,
    unitPrice: rows.find((row) => row.unitPrice)?.unitPrice ?? unitPriceFor(`${statement.month}-01`),
    rows,
    totalCageDays: Number(statement.totalCageDays || 0),
    totalAnimalDays: Number(statement.totalAnimalDays || 0),
    totalFreeCageDays: Number(statement.totalFreeCageDays || 0),
    totalBillableCageDays: Number(statement.totalBillableCageDays || 0),
    totalTier1CageDays: Number(statement.totalTier1CageDays || 0),
    totalTier2CageDays: Number(statement.totalTier2CageDays || 0),
    totalAmount: Number(statement.totalAmount || 0),
  };
}

function statementInfoForExport(statement) {
  const indexed = findIacucInfo(statement.iacuc) || {};
  return {
    project: statement.project || indexed.project || "",
    funding: statement.funding || indexed.funding || "",
    pi: statement.pi || indexed.pi || "",
    owner: statement.owner || indexed.owner || "",
  };
}

function settlementHtml(statement, info, rows) {
  const generatedAt = statement.generatedAt
    ? formatLogTime(statement.generatedAt)
    : new Date().toLocaleString("zh-CN", { hour12: false });
  const isQuantitySheet = statement.sourceType === "quantity_sheet" || statement.sourceType === "pi_merged_quantity_sheet";
  const documentNumber = settlementDocumentNumber(statement, generatedAt);
  const statementUrl = settlementLookupUrl(documentNumber, statement);
  const qrSvg = qrCodeSvg(statementUrl);
  const periodLabel = settlementPeriodLabel(statement.month);
  const currency = "CNY";
  const dataSourceLabel = isQuantitySheet ? "数量统计表（录入）" : "动态笼位图（自动）";
  const totalAmountText = MONEY_FORMAT.format(statement.totalAmount);
  const billableTotal = statement.totalBillableCageDays ?? statement.totalCageDays;
  const tier2Total = Number(statement.totalTier2CageDays || 0);
  const project = info.project || "-";
  const funding = info.funding || "-";
  const pi = info.pi || "-";
  const owner = info.owner || "-";
  const iacucList = statement.iacucs?.length ? statement.iacucs : String(statement.iacuc || "").split("、").filter(Boolean);
  const detailMatrix = settlementDetailMatrix(rows, iacucList);
  const detailHeaderHtml = detailMatrix.iacucs.map((iacuc) => `<th>${escapeText(iacuc)}</th>`).join("");
  const detailRowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeText(row.date)}</td>
          ${detailMatrix.iacucs.map((iacuc) => `<td class="num">${formatStatementNumber(detailMatrix.byDate.get(row.date)?.get(iacuc) || 0)}</td>`).join("")}
          <td class="num">${formatStatementNumber(row.cageCount)}</td>
          <td class="num">${formatStatementNumber(row.freeCages)}</td>
          <td class="num">${formatStatementNumber(row.billableCages)}</td>
          <td class="money">¥${MONEY_FORMAT.format(row.amount)}</td>
          <td class="money">¥${MONEY_FORMAT.format(row.cumulative)}</td>
        </tr>
      `,
    )
    .join("");
  const detailTotalsHtml = detailMatrix.iacucs.map((iacuc) => `<td class="num">${formatStatementNumber(detailMatrix.totals.get(iacuc) || 0)}</td>`).join("");
  const iacucColumnGroupHtml = detailMatrix.iacucs.map(() => `<col class="col-iacuc" />`).join("");

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeText(statement.pi || state.billingPi || state.billingIacuc)}-${escapeText(statement.month || state.billingMonth)}-饲养费结算单</title>
        <style>
          @page { size: A4; margin: 12mm; }
          * { box-sizing: border-box; }
          body {
            color: #111111;
            font-family: "Arial", "Helvetica Neue", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            font-size: 9.8px;
            line-height: 1.28;
            margin: 0;
            background: #ffffff;
          }
          .document {
            max-width: 186mm;
            min-height: 272mm;
            max-height: 272mm;
            overflow: hidden;
            margin: 0 auto;
          }
          .topbar {
            border-bottom: 1.4px solid #000000;
            padding-bottom: 6px;
          }
          .topbar-grid {
            display: grid;
            grid-template-columns: 1fr 24mm;
            gap: 8px;
            align-items: start;
          }
          h1 {
            color: #000000;
            font-size: 18px;
            line-height: 1.1;
            margin: 0 0 4px;
            text-align: center;
          }
          .subtitle {
            color: #222222;
            margin: 0;
            text-align: center;
          }
          .doc-meta,
          .basic-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 2px 10px;
            margin-top: 5px;
          }
          .doc-meta span,
          .basic-grid span { color: #444444; }
          .doc-meta strong {
            color: #000000;
            font-weight: 400;
            overflow-wrap: anywhere;
          }
          .qr-box {
            display: grid;
            justify-items: center;
            gap: 2px;
            text-align: center;
          }
          .qr-box svg {
            width: 22mm;
            height: 22mm;
          }
          .qr-box span {
            font-size: 8px;
            color: #444444;
          }
          .section {
            margin-top: 6px;
          }
          .amount-strip {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 0;
            margin-top: 6px;
            border-top: 1px solid #000000;
            border-bottom: 1px solid #000000;
          }
          .metric {
            border-right: 1px solid #000000;
            padding: 3px 5px;
            break-inside: avoid;
          }
          .metric:last-child { border-right: 0; }
          .metric span {
            color: #333333;
            display: block;
            font-size: 8.5px;
          }
          .metric strong {
            color: #000000;
            display: block;
            font-size: 12px;
            line-height: 1.15;
            margin-top: 1px;
          }
          .terms-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            border-top: 1px solid #000000;
            border-bottom: 1px solid #000000;
          }
          .terms-grid div {
            border-right: 1px solid #000000;
            padding: 3px 5px;
          }
          .terms-grid div:last-child { border-right: 0; }
          .terms-grid span {
            color: #333333;
            display: block;
            font-size: 8.5px;
          }
          .section-head {
            align-items: end;
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 2px;
          }
          h2 {
            color: #000000;
            font-size: 10.5px;
            margin: 0;
          }
          .section-head span {
            color: #333333;
            font-size: 8.5px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            table-layout: fixed;
          }
          th,
          td {
            border: 0;
            padding: 2.2px 4px;
            vertical-align: top;
          }
          th {
            color: #000000;
            font-size: 8.8px;
            font-weight: 700;
            text-align: right;
          }
          th:first-child,
          td:first-child {
            text-align: left;
          }
          td {
            text-align: right;
          }
          .num,
          .money {
            font-variant-numeric: tabular-nums;
          }
          .money {
            white-space: nowrap;
          }
          .three-line {
            border-top: 1px solid #000000;
            border-bottom: 1px solid #000000;
          }
          .three-line thead tr {
            border-bottom: 1px solid #000000;
          }
          .three-line tfoot tr {
            border-top: 1px solid #000000;
          }
          .three-line tfoot td {
            color: #000000;
            font-weight: 700;
          }
          .detail-table .col-date { width: 11%; }
          .detail-table .col-iacuc { width: 7%; }
          .detail-table .col-total { width: 8%; }
          .detail-table .col-free { width: 8%; }
          .detail-table .col-billable { width: 8%; }
          .detail-table .col-amount { width: 10%; }
          .detail-table .col-cumulative { width: 10%; }
          .summary-table td:nth-child(2),
          .summary-table th:nth-child(2) {
            text-align: left;
          }
          .empty-line {
            color: #333333;
            text-align: center !important;
          }
          .note-card {
            border-top: 1px solid #000000;
            color: #333333;
            padding-top: 4px;
          }
          .note-card strong {
            color: #000000;
          }
          .sign {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-top: 14px;
            break-inside: avoid;
          }
          .sign div {
            border-top: 1px solid #000000;
            color: #222222;
            min-height: 24px;
            padding-top: 4px;
          }
          .flow-table th,
          .flow-table td {
            border: 1px solid #000000;
            text-align: left;
            padding: 4px;
          }
          .flow-table th {
            background: #ffffff;
            font-weight: 700;
          }
          .flow-table td {
            height: 16px;
          }
          .footer {
            border-top: 1px solid #000000;
            color: #333333;
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-top: 6px;
            padding-top: 4px;
          }
          @media print {
            body { font-size: 9.4px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .section { margin-top: 4px; }
            th, td { padding: 1.7px 3px; }
            .detail-table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
          }
        </style>
      </head>
      <body>
        <main class="document">
          <header class="topbar">
            <div class="topbar-grid">
              <div>
                <h1>实验动物饲养费结算单</h1>
                <p class="subtitle">${escapeText(systemInfo.department || "-")}</p>
                <div class="doc-meta">
                  <div><span>单据编号：</span><strong>${escapeText(documentNumber)}</strong></div>
                  <div><span>结算期间：</span><strong>${escapeText(periodLabel)}</strong></div>
                  <div><span>数据来源：</span><strong>${escapeText(dataSourceLabel)}</strong></div>
                </div>
              </div>
              <div class="qr-box">
                ${qrSvg}
                <span>扫码访问在线单据</span>
              </div>
            </div>
          </header>

          <section class="basic-grid">
            <div><span>出具科室：</span>${escapeText(systemInfo.department || "-")}</div>
            <div><span>计费单位：</span>笼/天</div>
            <div><span>单据状态：</span>${statement.status === "locked" ? "已锁定" : "草稿"}</div>
          </section>

          <section class="section">
            <div class="section-head">
              <h2>项目信息</h2>
              <span>IACUC ${escapeText(iacucList.length ? `${iacucList.length} 项` : "-")}</span>
            </div>
            <table class="summary-table three-line">
              <tbody>
                <tr><th>项目负责人</th><td>${escapeText(statement.pi || pi || "-")}</td></tr>
                <tr><th>实验负责人</th><td>${escapeText(owner)}</td></tr>
                <tr><th>支撑经费</th><td>${escapeText(funding)}</td></tr>
                <tr><th>项目名称</th><td>${escapeText(project)}</td></tr>
                <tr><th>IACUC 编号</th><td>${escapeText(iacucList.join("、") || "-")}</td></tr>
                ${isQuantitySheet ? `<tr><th>房间/管理员</th><td>${escapeText(statement.roomName || "-")} / ${escapeText(statement.manager || "-")}</td></tr>` : ""}
              </tbody>
            </table>
          </section>

          <section class="section">
            <div class="section-head">
              <h2>每日饲养费明细</h2>
              <span>各 IACUC 列为当日笼数；首单元 ¥${MONEY_FORMAT.format(BILLING_TIER_BASE_PRICE)}；超额单元 ¥${MONEY_FORMAT.format(BILLING_TIER_OVER_PRICE)}${tier2Total ? `，本单超额 ${formatStatementNumber(tier2Total)} 笼日` : "，本单无超额笼日"}</span>
            </div>
            <table class="detail-table three-line">
            <colgroup>
              <col class="col-date" />
              ${iacucColumnGroupHtml}
              <col class="col-total" />
              <col class="col-free" />
              <col class="col-billable" />
              <col class="col-amount" />
              <col class="col-cumulative" />
            </colgroup>
            <thead>
              <tr><th>日期</th>${detailHeaderHtml}<th>合计笼数</th><th>减免笼数</th><th>收费笼数</th><th>当日费用</th><th>累计费用</th></tr>
            </thead>
            <tbody>${detailRowsHtml}</tbody>
            <tfoot>
              <tr>
                <td>合计</td>
                ${detailTotalsHtml}
                <td class="num">${formatStatementNumber(statement.totalCageDays)}</td>
                <td class="num">${formatStatementNumber(statement.totalFreeCageDays)}</td>
                <td class="num">${formatStatementNumber(billableTotal)}</td>
                <td class="money">¥${totalAmountText}</td>
                <td class="money">¥${totalAmountText}</td>
              </tr>
            </tfoot>
            </table>
          </section>

          <section class="amount-strip">
            <div class="metric">
              <span>累计笼日</span>
              <strong>${formatStatementNumber(statement.totalCageDays)}</strong>
            </div>
            <div class="metric">
              <span>收费笼日</span>
              <strong>${formatStatementNumber(billableTotal)}</strong>
            </div>
            <div class="metric">
              <span>免费额度</span>
              <strong>${formatStatementNumber(statement.freeCageAllowance)} 笼/天</strong>
            </div>
            <div class="metric">
              <span>超额笼日</span>
              <strong>${formatStatementNumber(tier2Total)}</strong>
            </div>
            <div class="metric">
              <span>应收金额</span>
              <strong>¥${totalAmountText}</strong>
            </div>
          </section>

          <section class="section note-card">
            <strong>说明：</strong>
            <span>&nbsp;</span>
          </section>

          <section class="sign">
            <div>项目负责人确认 / Date</div>
            <div>动物房审核 / Date</div>
            <div>财务审核 / Date</div>
          </section>

          <footer class="footer">
            <span>${escapeText(systemInfo.name || "CageLedger")} · ${escapeText(systemInfo.license || "")}</span>
            <span>${escapeText(documentNumber)}</span>
          </footer>
        </main>
      </body>
    </html>
  `;
}

function settlementDocumentNumber(statement, generatedAt) {
  const source = statement.sourceType === "quantity_sheet" ? "QS" : "CM";
  const month = String(statement.month || state.billingMonth || "0000-00").replace(/\D/g, "");
  if (statement.documentNumber) return statement.documentNumber;
  if (statement.id) return `CL-${source}-${month}-${String(statement.id).replace(/[^a-z0-9-]/gi, "").toUpperCase()}`;
  const generated = String(generatedAt || "")
    .replace(/\D/g, "")
    .slice(0, 12);
  const hash = hashCompact([statement.month, statement.iacuc, statement.pi, statement.sourceType].join("|"));
  return `CL-${source}-${month}-${generated || "000000000000"}-${hash}`;
}

function settlementLookupUrl(documentNumber, statement) {
  const params = new URLSearchParams({ s: documentNumber });
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?${params.toString()}`;
}

function settlementPeriodLabel(month) {
  const dates = datesInMonth(month);
  if (!dates.length) return month || "-";
  return `${dates[0]} 至 ${dates[dates.length - 1]}`;
}

function settlementDetailMatrix(rows, statementIacucs) {
  const discovered = [];
  const byDate = new Map();
  const totals = new Map();
  const ensureIacuc = (iacuc) => {
    if (iacuc && !discovered.includes(iacuc)) discovered.push(iacuc);
  };
  (statementIacucs || []).forEach((iacuc) => ensureIacuc(normalizeIacucNumber(iacuc)));

  for (const row of rows) {
    const current = new Map();
    for (const item of row.iacucBreakdown || []) {
      const iacuc = normalizeIacucNumber(item.iacuc || "");
      if (!iacuc) continue;
      ensureIacuc(iacuc);
      const cageCount = numericOrZero(item.cageCount);
      current.set(iacuc, numericOrZero(current.get(iacuc)) + cageCount);
      totals.set(iacuc, numericOrZero(totals.get(iacuc)) + cageCount);
    }
    byDate.set(row.date, current);
  }
  discovered.sort((a, b) => a.localeCompare(b, "zh-CN"));
  return { iacucs: discovered, byDate, totals };
}

function formatStatementNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function hashCompact(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

function rmbUppercase(value) {
  const amount = Math.round(Number(value || 0) * 100);
  if (!amount) return "人民币零元整";

  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const units = ["", "拾", "佰", "仟"];
  const sections = ["", "万", "亿", "兆"];
  const integer = Math.floor(amount / 100);
  const fraction = amount % 100;

  const sectionToUpper = (section) => {
    let text = "";
    let zero = false;
    for (let index = 0; index < 4; index += 1) {
      const digit = section % 10;
      if (digit === 0) {
        if (text) zero = true;
      } else {
        text = `${digits[digit]}${units[index]}${zero ? "零" : ""}${text}`;
        zero = false;
      }
      section = Math.floor(section / 10);
    }
    return text;
  };

  let integerText = "";
  let sectionIndex = 0;
  let remaining = integer;
  let needZero = false;
  while (remaining > 0) {
    const section = remaining % 10000;
    if (section) {
      const prefix = needZero ? "零" : "";
      integerText = `${sectionToUpper(section)}${sections[sectionIndex]}${prefix}${integerText}`;
      needZero = section < 1000;
    } else if (integerText) {
      needZero = true;
    }
    remaining = Math.floor(remaining / 10000);
    sectionIndex += 1;
  }

  const jiao = Math.floor(fraction / 10);
  const fen = fraction % 10;
  const fractionText = fraction ? `${jiao ? `${digits[jiao]}角` : ""}${fen ? `${digits[fen]}分` : ""}` : "整";
  return `人民币${integerText || "零"}元${fractionText}`;
}

function qrCodeSvg(text) {
  const modules = qrCodeMatrix(text);
  const size = modules.length;
  const quiet = 4;
  const viewBoxSize = size + quiet * 2;
  const cells = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) cells.push(`<rect x="${col + quiet}" y="${row + quiet}" width="1" height="1"/>`);
    }
  }
  return `<svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" role="img" aria-label="结算单二维码" xmlns="http://www.w3.org/2000/svg"><rect width="${viewBoxSize}" height="${viewBoxSize}" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`;
}

function qrCodeMatrix(text) {
  const version = 5;
  const size = version * 4 + 17;
  const dataCodewords = 108;
  const eccCodewords = 26;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const setFunction = (row, col, dark) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    matrix[row][col] = dark;
    reserved[row][col] = true;
  };

  const drawFinder = (row, col) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const r = row + y;
        const c = col + x;
        const inFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inFinder && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setFunction(r, c, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let index = 8; index < size - 8; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }

  const drawAlignment = (centerRow, centerCol) => {
    if (reserved[centerRow][centerCol]) return;
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        setFunction(centerRow + y, centerCol + x, distance !== 1);
      }
    }
  };
  [6, 30].forEach((row) => [6, 30].forEach((col) => drawAlignment(row, col)));
  setFunction(size - 8, 8, true);

  reserveFormatAreas(reserved, size);
  const bytes = new TextEncoder().encode(text);
  const data = qrEncodeData(bytes, dataCodewords);
  const codewords = [...data, ...qrReedSolomonRemainder(data, eccCodewords)];
  placeQrData(matrix, reserved, codewords);
  applyQrMask(matrix, reserved, 0);
  drawQrFormatBits(matrix, reserved, 0);
  return matrix;
}

function reserveFormatAreas(reserved, size) {
  for (let index = 0; index <= 8; index += 1) {
    if (index !== 6) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[size - 1 - index][8] = true;
    reserved[8][size - 1 - index] = true;
  }
}

function qrEncodeData(bytes, capacity) {
  if (bytes.length > 105) throw new Error("结算单二维码内容过长");
  const bits = [];
  const append = (value, length) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  bytes.forEach((byte) => append(byte, 8));
  const totalBits = capacity * 8;
  for (let index = 0; index < Math.min(4, totalBits - bits.length); index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  for (let pad = 0; data.length < capacity; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
  return data;
}

function qrReedSolomonRemainder(data, degree) {
  const divisor = qrReedSolomonDivisor(degree);
  const result = Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= qrGfMultiply(divisor[index], factor);
    }
  }
  return result;
}

function qrReedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let term = 0; term < degree; term += 1) {
      result[term] = qrGfMultiply(result[term], root);
      if (term + 1 < degree) result[term] ^= result[term + 1];
    }
    root = qrGfMultiply(root, 2);
  }
  return result;
}

function qrGfMultiply(x, y) {
  let product = 0;
  for (let index = 7; index >= 0; index -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> index) & 1) * x;
  }
  return product & 0xff;
}

function placeQrData(matrix, reserved, codewords) {
  const size = matrix.length;
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        matrix[row][col] = bitIndex < bits.length ? Boolean(bits[bitIndex]) : false;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function applyQrMask(matrix, reserved, mask) {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (!reserved[row][col] && qrMaskApplies(mask, row, col)) matrix[row][col] = !matrix[row][col];
    }
  }
}

function qrMaskApplies(mask, row, col) {
  return mask === 0 ? (row + col) % 2 === 0 : false;
}

function drawQrFormatBits(matrix, reserved, mask) {
  const size = matrix.length;
  const bits = qrFormatBits(mask);
  const set = (row, col, index) => {
    matrix[row][col] = Boolean((bits >>> index) & 1);
    reserved[row][col] = true;
  };
  for (let index = 0; index <= 5; index += 1) set(index, 8, index);
  set(7, 8, 6);
  set(8, 8, 7);
  set(8, 7, 8);
  for (let index = 9; index < 15; index += 1) set(8, 14 - index, index);
  for (let index = 0; index < 8; index += 1) set(8, size - 1 - index, index);
  for (let index = 8; index < 15; index += 1) set(size - 15 + index, 8, index);
  matrix[size - 8][8] = true;
}

function qrFormatBits(mask) {
  const data = (1 << 3) | mask;
  let value = data << 10;
  for (let index = 14; index >= 10; index -= 1) {
    if (((value >>> index) & 1) !== 0) value ^= 0x537 << (index - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function datesInMonth(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1, 1);
  const dates = [];
  while (date.getMonth() === monthIndex - 1) {
    dates.push(formatLocalDate(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function getSelectedRoom() {
  const rooms = visibleRooms();
  return rooms.find((room) => room.id === state.selectedRoomId) ?? rooms[0];
}

function roomNameById(roomId) {
  return stateIndexes().roomById.get(roomId)?.name || roomId;
}

function visibleRooms() {
  if (!remotePersistence || !currentUser || currentUser.role === "admin") return state.rooms;
  const allowed = new Set(currentUser.roomIds || []);
  return state.rooms.filter((room) => allowed.has(room.id));
}

function racksForRoom(roomId) {
  return stateIndexes().racksByRoomId.get(roomId) || [];
}

function slotsForRack(rackId) {
  return stateIndexes().slotsByRackId.get(rackId) || [];
}

function slotsForRoom(roomId) {
  const racks = racksForRoom(roomId);
  return racks.flatMap((rack) => slotsForRack(rack.id));
}

function occupanciesForPi(pi) {
  return stateIndexes().occupanciesByPi.get(normalizePersonName(pi)) || [];
}

function occupanciesForIacuc(iacuc) {
  return stateIndexes().occupanciesByIacuc.get(normalizeIacucNumber(iacuc)) || [];
}

function quantitySheetsForMonth(month) {
  return stateIndexes().quantitySheetsByMonth.get(month) || [];
}

function quantitySheetsForIacuc(iacuc) {
  return stateIndexes().quantitySheetsByIacuc.get(normalizeIacucNumber(iacuc)) || [];
}

function billingWorkflowById(workflowId) {
  return stateIndexes().billingWorkflowById.get(workflowId) || null;
}

function billingWorkflowByBusinessKey(businessKey) {
  return stateIndexes().billingWorkflowByBusinessKey.get(businessKey) || null;
}

function getSelectedRack(racks) {
  return racks.find((rack) => rack.id === state.selectedRackId) ?? racks[0];
}

function getSelectedSlot(visibleSlots, allSlots) {
  return visibleSlots.find((slot) => slot.id === state.selectedSlotId) ?? visibleSlots[0] ?? allSlots[0];
}

function slotPositionCode(slot) {
  return `${columnLabel(Number(slot.col))}${Number(slot.row)}`;
}

function rackCode(rackOrIndex) {
  const value = typeof rackOrIndex === "object" ? rackOrIndex?.index : rackOrIndex;
  const index = Number(value);
  return Number.isFinite(index) && index > 0 ? String(index).padStart(2, "0") : String(value || "");
}

function rackDisplayName(rack, room) {
  if (!rack) return "";
  const roomName = room?.name || roomNameById(rack.roomId);
  return `${roomName} ${rackCode(rack)} 号笼架`;
}

function columnLabel(index) {
  let value = Number(index);
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label || "A";
}

function cageCodeForSlot(slotId) {
  const indexes = stateIndexes();
  const slot = indexes.slotById.get(slotId);
  if (!slot) return "";

  const rack = indexes.rackById.get(slot.rackId);
  const room = rack ? indexes.roomById.get(rack.roomId) : null;
  if (!rack || !room) return slotPositionCode(slot);

  return `${room.name}-${rackCode(rack)}-${slotPositionCode(slot)}`;
}

function currentOccupancy(slotId) {
  return stateIndexes().currentOccupancyBySlotId.get(slotId);
}

function stateIndexes() {
  if (STATE_INDEX_CACHE) return STATE_INDEX_CACHE;
  const roomById = new Map(state.rooms.map((room) => [room.id, room]));
  const rackById = new Map(state.racks.map((rack) => [rack.id, rack]));
  const slotById = new Map(state.slots.map((slot) => [slot.id, slot]));
  const racksByRoomId = new Map();
  state.racks.forEach((rack) => {
    if (!racksByRoomId.has(rack.roomId)) racksByRoomId.set(rack.roomId, []);
    racksByRoomId.get(rack.roomId).push(rack);
  });
  const slotsByRackId = new Map();
  state.slots.forEach((slot) => {
    if (!slotsByRackId.has(slot.rackId)) slotsByRackId.set(slot.rackId, []);
    slotsByRackId.get(slot.rackId).push(slot);
  });
  const currentOccupancyBySlotId = new Map();
  const occupanciesByPi = new Map();
  const occupanciesByIacuc = new Map();
  const billableOccupancies = [];
  state.occupancies.forEach((item) => {
    if ((item.status === "active" || item.status === "reserved") && item.slotId) {
      currentOccupancyBySlotId.set(item.slotId, item);
    }
    const iacucKey = normalizeIacucNumber(item.iacuc);
    if (iacucKey) {
      if (!occupanciesByIacuc.has(iacucKey)) occupanciesByIacuc.set(iacucKey, []);
      occupanciesByIacuc.get(iacucKey).push(item);
    }
    if (item.status === "active" || item.status === "ended") {
      billableOccupancies.push(item);
      const piKey = normalizePersonName(item.pi);
      if (piKey) {
        if (!occupanciesByPi.has(piKey)) occupanciesByPi.set(piKey, []);
        occupanciesByPi.get(piKey).push(item);
      }
    }
  });
  const quantitySheetsById = new Map(state.quantitySheets.map((sheet) => [sheet.id, sheet]));
  const quantitySheetsByMonth = new Map();
  const quantitySheetsByIacuc = new Map();
  state.quantitySheets.forEach((sheet) => {
    if (sheet.month) {
      if (!quantitySheetsByMonth.has(sheet.month)) quantitySheetsByMonth.set(sheet.month, []);
      quantitySheetsByMonth.get(sheet.month).push(sheet);
    }
    const iacucKey = normalizeIacucNumber(sheet.iacuc);
    if (iacucKey) {
      if (!quantitySheetsByIacuc.has(iacucKey)) quantitySheetsByIacuc.set(iacucKey, []);
      quantitySheetsByIacuc.get(iacucKey).push(sheet);
    }
  });
  const billingWorkflowById = new Map(state.billingWorkflows.map((workflow) => [workflow.id, workflow]));
  const billingWorkflowByBusinessKey = new Map();
  state.billingWorkflows.forEach((workflow) => {
    if (workflow.businessKey) billingWorkflowByBusinessKey.set(workflow.businessKey, workflow);
  });
  STATE_INDEX_CACHE = {
    roomById,
    rackById,
    slotById,
    racksByRoomId,
    slotsByRackId,
    currentOccupancyBySlotId,
    occupanciesByPi,
    occupanciesByIacuc,
    billableOccupancies,
    quantitySheets: state.quantitySheets,
    quantitySheetsById,
    quantitySheetsByMonth,
    quantitySheetsByIacuc,
    billingWorkflowById,
    billingWorkflowByBusinessKey,
    billingWorkflowsSorted: sortBillingWorkflows(state.billingWorkflows),
  };
  return STATE_INDEX_CACHE;
}

function invalidateStateIndexCache() {
  STATE_INDEX_CACHE = null;
}

function emptyOccupancy(slotId) {
  const profile = billingProfileForSlotId(slotId);
  return {
    slotId,
    cageCode: cageCodeForSlot(slotId),
    status: "active",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    startDate: today,
    endDate: "",
    animalCount: profile.unit === "animal_day" ? profile.defaultAnimalCount : null,
    animalSex: "unknown",
    birthDate: "",
    billingItem: "",
    customerType: "",
    notes: "",
  };
}

function uniqueIacucs() {
  const values = [...state.occupancies.map((item) => item.iacuc), ...IACUC_INDEX.map((item) => item.iacuc)].filter(Boolean);
  return [...new Set(values)].sort();
}

function iacucOptions(currentValue = "") {
  const typedValue = String(currentValue || "").trim();
  const keyword = normalizeSearchText(typedValue);
  const normalizedIacuc = normalizeIacucNumber(typedValue);
  const cache = iacucSearchCache();
  const exact = typedValue ? cache.byRaw.get(typedValue) || cache.byNumber.get(normalizedIacuc) : null;
  const matches = keyword
    ? cache.items.filter((item) => item.searchText.includes(keyword) || normalizeIacucNumber(item.iacuc).includes(normalizedIacuc))
    : cache.items;
  const limited = [];
  if (exact) limited.push(exact);
  matches.forEach((item) => {
    if (limited.length >= IACUC_OPTION_LIMIT) return;
    if (iacucOptionKey(item) === iacucOptionKey(exact)) return;
    limited.push(item);
  });
  if (typedValue && !exact && limited.length < IACUC_OPTION_LIMIT) {
    limited.unshift({ iacuc: typedValue, project: "", pi: "", owner: "", funding: "", searchText: keyword });
  }
  return limited.slice(0, IACUC_OPTION_LIMIT);
}

function iacucSearchCache() {
  if (IACUC_SEARCH_CACHE) return IACUC_SEARCH_CACHE;
  const byNumber = new Map();
  const byRaw = new Map();
  const items = [];
  const put = (item, source) => {
    const iacuc = normalizeIacucNumber(item.iacuc);
    if (!iacuc) return;
    const rawKey = iacucRawKey(item.iacuc);
    const hasNumber = byNumber.has(iacuc);
    const normalized = {
      iacuc: item.iacuc || iacuc,
      rawIacuc: item.rawIacuc || item.iacuc || iacuc,
      project: item.project || "",
      pi: item.pi || "",
      owner: item.owner || "",
      funding: item.funding || "",
      source,
    };
    normalized.searchText = normalizeSearchText(
      [normalized.iacuc, normalized.rawIacuc, normalized.project, normalized.pi, normalized.owner, normalized.funding].join(" "),
    );
    if (!byRaw.has(rawKey)) byRaw.set(rawKey, normalized);
    if (!hasNumber) byNumber.set(iacuc, normalized);
    if (source === "index" || !hasNumber) items.push(normalized);
  };

  IACUC_INDEX.forEach((item) => put(item, "index"));
  state.occupancies.forEach((item) => put(item, "occupancy"));
  IACUC_SEARCH_CACHE = {
    byNumber,
    byRaw,
    items: items.sort((a, b) => a.iacuc.localeCompare(b.iacuc, "zh-CN")),
  };
  return IACUC_SEARCH_CACHE;
}

function invalidateIacucSearchCache() {
  IACUC_SEARCH_CACHE = null;
}

function piOptions(currentValue = "") {
  const fromIndex = IACUC_INDEX.map((item) => ({
    pi: item.pi,
    iacuc: item.iacuc,
  }));
  const fromOccupancies = stateIndexes().billableOccupancies.map((item) => ({
    pi: item.pi,
    iacuc: item.iacuc,
  }));
  const fromSheets = stateIndexes().quantitySheets.map((item) => ({
    pi: item.pi,
    iacuc: item.iacuc,
  }));
  const typedValue = String(currentValue || "").trim();
  const fromCurrentValue = typedValue ? [{ pi: typedValue, iacuc: "" }] : [];
  const byPi = new Map();
  [...fromIndex, ...fromOccupancies, ...fromSheets, ...fromCurrentValue].forEach((item) => {
    const key = normalizePersonName(item.pi);
    if (!key) return;
    const current = byPi.get(key) || { pi: item.pi, iacucs: [] };
    if (item.iacuc) current.iacucs.push(normalizeIacucNumber(item.iacuc));
    byPi.set(key, current);
  });
  return [...byPi.values()]
    .map((item) => ({ ...item, iacucs: [...new Set(item.iacucs)].sort() }))
    .sort((a, b) => a.pi.localeCompare(b.pi, "zh-CN"));
}

function findIacucInfo(value) {
  const rawKey = iacucRawKey(value);
  const key = normalizeIacucNumber(value);
  if (!key) return null;
  const cache = iacucSearchCache();
  return cache.byRaw.get(rawKey) || cache.byNumber.get(key) || null;
}

function iacucRawKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function iacucOptionKey(item) {
  if (!item) return "";
  return `${iacucRawKey(item.iacuc)}:${item.source || ""}`;
}

function piForIacuc(value) {
  const info = findIacucInfo(value);
  return info?.pi || "";
}

function normalizeIacucNumber(value) {
  return String(value ?? "")
    .trim()
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizePersonName(value) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function statusLabel(status) {
  return {
    empty: "空",
    reserved: "已预约",
    active: "在用",
    ended: "已结束",
  }[status];
}

function historyStatusLabel(item) {
  if (item.status === "ended" && item.endReason === "sampled") return "已取材";
  if (item.status === "ended" && item.endReason === "cleared") return "已设空";
  return statusLabel(item.status);
}

function validateEndDate(occupancy, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    showFlashNotice("日期格式错误", "日期格式需要为 YYYY-MM-DD。", "warning");
    return false;
  }
  if (occupancy.startDate && endDate < occupancy.startDate) {
    showFlashNotice("日期范围错误", `取材日期不能早于入住日期 ${occupancy.startDate}。`, "warning");
    return false;
  }
  return true;
}

function bindFeedingPeriodInputs(scopeSelector) {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return;
  const startDateInput = scope.querySelector("input[name='startDate']");
  const feedingDaysInput = scope.querySelector("input[name='feedingDays']");
  const endDateInput = scope.querySelector("input[name='endDate']");
  if (!startDateInput || !feedingDaysInput || !endDateInput) return;

  const syncEndDate = () => {
    const resolved = resolveEndDateByFeedingPeriod(startDateInput.value, feedingDaysInput.value, endDateInput.value);
    endDateInput.value = resolved;
  };
  startDateInput.addEventListener("change", syncEndDate);
  feedingDaysInput.addEventListener("input", syncEndDate);
}

function normalizeFeedingDays(value) {
  const days = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(days) || days <= 0) return "";
  return String(days);
}

function resolveEndDateByFeedingPeriod(startDate, feedingDays, fallbackEndDate = "") {
  const normalized = normalizeFeedingDays(feedingDays);
  if (startDate && normalized) {
    return addDays(startDate, Number(normalized));
  }
  return String(fallbackEndDate || "");
}

function occupancyPeriodTone(occupancy) {
  if (!occupancy || occupancy.status !== "active") return "";
  if (!occupancy.endDate) return "open";
  if (today > occupancy.endDate) return "overdue";
  return "normal";
}

function formatAnimalAge(birthDate) {
  const normalized = normalizeDateInput(birthDate);
  if (!normalized) return "";
  const birth = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "";
  const current = new Date(`${today}T00:00:00`);
  if (birth > current) return "";
  let years = current.getFullYear() - birth.getFullYear();
  let months = current.getMonth() - birth.getMonth();
  let days = current.getDate() - birth.getDate();
  if (days < 0) {
    months -= 1;
    const previousMonth = new Date(current.getFullYear(), current.getMonth(), 0).getDate();
    days += previousMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years > 0) return `${years}岁${months}月`;
  if (months > 0) return `${months}月${days}天`;
  return `${Math.max(days, 0)}天`;
}

function findOverdueOccupanciesByIacuc(iacuc, excludeIds = []) {
  const normalizedIacuc = normalizeIacucNumber(iacuc);
  if (!normalizedIacuc) return [];
  const excluded = new Set(excludeIds);
  const indexes = stateIndexes();
  return occupanciesForIacuc(normalizedIacuc)
    .filter((item) => item.status === "active" && !excluded.has(item.id))
    .filter((item) => item.endDate && item.endDate < today)
    .map((item) => {
      const slot = indexes.slotById.get(item.slotId);
      const rack = slot ? indexes.rackById.get(slot.rackId) : null;
      const room = rack ? indexes.roomById.get(rack.roomId) : null;
      return {
        roomName: room?.name || "未知房间",
        cageLabel: slot ? slotPositionCode(slot) : item.slotId || "未知笼位",
      };
    });
}

function buildOverdueAlertMessage(iacuc, overdueItems) {
  const detail = overdueItems.map((item) => `${item.roomName} / ${item.cageLabel}`).join("\n");
  return `伦理号 ${iacuc || "未填写"} 存在超期饲养笼位：\n${detail}\n\n系统已继续保存当前录入。`;
}

function pushLog(message) {
  if (remotePersistence) return;
  state.auditLogs.unshift({
    id: crypto.randomUUID(),
    message,
    at: new Date().toISOString(),
  });
}

function showFlashNotice(title, message, type = "success") {
  if (flashNoticeTimer) clearTimeout(flashNoticeTimer);
  state.flashNotice = {
    type: ["success", "warning", "error"].includes(type) ? type : "success",
    title,
    message,
  };
  render();
  flashNoticeTimer = window.setTimeout(() => {
    state.flashNotice = null;
    flashNoticeTimer = null;
    render();
  }, type === "success" ? 3200 : 4200);
}

function openConfirmDialog(config) {
  state.confirmDialog = {
    type: config.type || "",
    id: config.id || "",
    title: config.title || "请确认",
    message: config.message || "",
    confirmLabel: config.confirmLabel || "确认",
    payload: config.payload || {},
  };
  render();
}

function closeConfirmDialog() {
  state.confirmDialog = null;
  render();
}

async function handleConfirmDialogAction() {
  const dialog = state.confirmDialog;
  if (!dialog) return;
  state.confirmDialog = null;
  try {
    if (dialog.type === "delete-intake-batch") {
      const batch = state.intakeBatches.find((item) => item.id === dialog.id);
      await deleteIntakeBatch(dialog.id);
      pushLog(`删除待接收批次：${batch?.batchNo || dialog.id}`);
      showFlashNotice("删除成功", `待接收批次已删除：${batch?.batchNo || dialog.id}`);
      return;
    }
    if (dialog.type === "delete-workflow") {
      await deleteBillingWorkflow(dialog.id);
      pushLog(`删除结算流程：${dialog.payload?.label || dialog.id}`);
      showFlashNotice("删除成功", `结算流程已删除：${dialog.payload?.label || dialog.id}`);
      return;
    }
    if (dialog.type === "delete-quantity-sheet") {
      await deleteQuantitySheetConfirmed(dialog.id);
      pushLog(`删除数量统计表：${dialog.payload?.label || dialog.id}`);
      showFlashNotice("删除成功", `数量统计表已删除：${dialog.payload?.label || dialog.id}`);
      return;
    }
    if (dialog.type === "delete-user") {
      await deleteUserConfirmed(dialog.id);
      showFlashNotice("删除成功", `账号已删除：${dialog.payload?.displayName || dialog.id}`);
      render();
      return;
    }
    if (dialog.type === "sample-batch-slots") {
      await sampleBatchSlotsConfirmed(dialog.payload?.sampledDate || "");
      return;
    }
    if (dialog.type === "clear-batch-slots") {
      await clearBatchSlotsConfirmed();
      return;
    }
    if (dialog.type === "delete-room") {
      await deleteRoomConfirmed(dialog.id);
      showFlashNotice("删除成功", `饲养间已删除：${dialog.payload?.roomName || dialog.id}`);
      return;
    }
    if (dialog.type === "delete-rack") {
      await deleteRackConfirmed(dialog.id);
      showFlashNotice("删除成功", `笼架已删除：${dialog.payload?.rackLabel || dialog.id}`);
      return;
    }
    if (dialog.type === "clear-client-cache") {
      await clearClientCacheAndReload();
      return;
    }
    render();
  } catch (error) {
    reportSaveError(error);
  }
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLogTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function mergeAuditLogs(incoming, existing) {
  const seen = new Set();
  const merged = [];
  [...incoming, ...existing].forEach((item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });
  return merged.slice(0, 500);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function escapeAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function iconSvg(name) {
  const icons = {
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
    receipt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zm2 5h6v2H9zm0 4h6v2H9z"/></svg>`,
    book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5zm2.5-.5A.5.5 0 0 0 7 4.5v13.1c.2-.1.3-.1.5-.1H18V4zM9 7h6v2H9zm0 4h6v2H9z"/></svg>`,
    building: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16h-6v-5h-4v5zm3-3h2v-2H7zm0-4h2v-2H7zm0-4h2V8H7zm4 4h2v-2h-2zm0-4h2V8h-2zm4 4h2v-2h-2zm0-4h2V8h-2z"/></svg>`,
    database: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zm0 2C8.2 5 6 6 6 6s2.2 1 6 1 6-1 6-1-2.2-1-6-1zM6 9v3c.8.5 2.9 1 6 1s5.2-.5 6-1V9c-1.4.6-3.5 1-6 1s-4.6-.4-6-1zm0 6v3c.8.5 2.9 1 6 1s5.2-.5 6-1v-3c-1.4.6-3.5 1-6 1s-4.6-.4-6-1z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4zm7.5-9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 8c-.7 0-1.4.1-2 .3 1.6 1 2.5 2.6 2.5 4.7v2h4v-2c0-2.8-2-5-4.5-5z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.5a7.9 7.9 0 0 0 .1-1.5 7.9 7.9 0 0 0-.1-1.5l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-2.5-1.4L14.2 3h-4.4l-.4 2.2A7.7 7.7 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5A7.9 7.9 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a7.7 7.7 0 0 0 2.5 1.4l.4 2.2h4.4l.4-2.2a7.7 7.7 0 0 0 2.5-1.4l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5zM8 5v5h8V5zm1 11h6v3H9z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V20h2.5L17.8 8.7l-2.5-2.5zM19.7 6.8a1 1 0 0 0 0-1.4l-1.1-1.1a1 1 0 0 0-1.4 0l-.8.8 2.5 2.5z"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h9v2H7v12h7v2H5zm11.6 4.6L20 12l-3.4 3.4-1.4-1.4 1-1H10v-2h6.2l-1-1z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2m-8 0 1 12h8l1-12M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 16h2V7l3 3 1.4-1.4L12 3.2 6.6 8.6 8 10l3-3zM5 18h14v2H5z"/></svg>`,
    download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v9l3-3 1.4 1.4L12 16.8l-5.4-5.4L8 10l3 3zM5 18h14v2H5z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 0 1 5.1 10.5l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z"/></svg>`,
    calculator: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 2v4h8V5zm0 7v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zM8 16v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9zm5-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 6.3-1.4-1.4L6.2 12l7.1 7.1 1.4-1.4L10 13h8v-2h-8z"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.3 17.7 1.4 1.4 7.1-7.1-7.1-7.1-1.4 1.4L14 11H6v2h8z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`,
  };
  return icons[name] ?? "";
}

function decorateRequiredFields() {
  document.querySelectorAll(".field-required input, .field-required textarea").forEach((input) => {
    const raw = input.getAttribute("placeholder") || "";
    const hint = raw.trim();
    if (!hint) {
      input.setAttribute("placeholder", "必填");
      return;
    }
    if (!hint.startsWith("必填")) {
      input.setAttribute("placeholder", `必填 · ${hint}`);
    }
  });
}

initialize();

async function initialize() {
  await loadSystemInfo();
  await loadCurrentUser();
  if (!remotePersistence || currentUser) {
    await Promise.all([loadIacucIndexStatus(), loadPersistedState()]);
    await applyStatementDeepLink();
    try {
      await ensureViewDataLoaded(state.activeView);
    } catch (loadError) {
      console.error(loadError);
      state.flashNotice = {
        type: "warning",
        title: "部分数据加载失败",
        message: loadError?.message || "当前页面的附加数据未完整加载。",
      };
    }
  }
  render();
  showPendingCacheResetNotice();
}

async function applyStatementDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const statementCode = params.get("statement") || params.get("s") || "";
  if (!statementCode) return;

  state.activeView = "billing";
  const statementId = params.get("statementId") || statementIdFromDocumentNumber(statementCode);
  if (!statementId || !remotePersistence || !currentUser) return;

  try {
    const response = await fetch("/api/billing-statements", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const statement = (payload.items || []).find((item) => item.id === statementId);
    if (!statement) return;
    state.billingSource = statement.sourceType === "quantity_sheet" ? "quantity_sheet" : "cage_map";
    state.billingMonth = statement.month || state.billingMonth;
    state.billingPi = statement.pi || state.billingPi;
  } catch {
    // Deep links are advisory; the normal billing page remains usable if lookup fails.
  }
}

function statementIdFromDocumentNumber(value) {
  const match = String(value || "").match(/-(stmt-[a-z0-9-]+)$/i);
  if (!match) return "";
  return match[1].toLowerCase();
}

async function loadSystemInfo() {
  try {
    const bundledVersion = systemInfo.version || "";
    const response = await fetch(API_SYSTEM_INFO_URL, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    systemInfo = { ...systemInfo, ...payload };
    refreshStaleClientVersion(bundledVersion, payload.version);
  } catch {
    // Keep the bundled metadata fallback for static or offline runs.
  }
}

function refreshStaleClientVersion(clientVersion, serverVersion) {
  if (!clientVersion || !serverVersion || clientVersion === serverVersion || typeof window === "undefined") return;
  const refreshToken = `${serverVersion}:${clientVersion}`;
  if (sessionStorage.getItem(VERSION_REFRESH_KEY) === refreshToken) {
    state.flashNotice = {
      type: "warning",
      title: "检测到新版本",
      message: `服务器版本为 v${serverVersion}，当前页面版本为 v${clientVersion}。请刷新页面获取最新功能。`,
    };
    return;
  }
  sessionStorage.setItem(VERSION_REFRESH_KEY, refreshToken);
  const url = new URL(window.location.href);
  url.searchParams.set("_clv", `${serverVersion}-${Date.now()}`);
  window.location.replace(url.toString());
}

function showPendingCacheResetNotice() {
  try {
    const raw = sessionStorage.getItem(CACHE_RESET_NOTICE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(CACHE_RESET_NOTICE_KEY);
    const payload = JSON.parse(raw);
    showFlashNotice("清理完成", `本地缓存已清理，页面已刷新${payload?.at ? `：${formatLogTime(payload.at)}` : ""}`);
  } catch {
    sessionStorage.removeItem(CACHE_RESET_NOTICE_KEY);
    showFlashNotice("清理完成", "本地缓存已清理，页面已刷新。");
  }
}

async function loadIacucIndexStatus() {
  if (!remotePersistence && !currentUser) {
    iacucIndexMeta = null;
    return;
  }
  try {
    const response = await fetch("/api/iacuc-index/status", { cache: "no-store" });
    if (response.status === 401) {
      currentUser = null;
      iacucIndexMeta = null;
      return;
    }
    if (!response.ok) return;
    const payload = await response.json();
    iacucIndexMeta = {
      count: payload.count || 0,
      updatedAt: payload.updatedAt,
      source: payload.source,
    };
  } catch {
    iacucIndexMeta = null;
  }
}

async function ensureIacucIndexLoaded() {
  if (!remotePersistence && !currentUser) return IACUC_INDEX;
  if (IACUC_INDEX_LOADED) return IACUC_INDEX;
  if (IACUC_INDEX_PROMISE) return IACUC_INDEX_PROMISE;
  IACUC_INDEX_LOADING = true;
  IACUC_INDEX_PROMISE = (async () => {
    try {
      const response = await fetch(API_IACUC_INDEX_URL, { cache: "no-store" });
      if (response.status === 401) {
        currentUser = null;
        render();
        throw new Error("请先登录");
      }
      if (!response.ok) throw new Error("加载 IACUC 索引失败");
      const payload = await response.json();
      IACUC_INDEX = payload.items || [];
      iacucIndexMeta = {
        count: payload.count || IACUC_INDEX.length,
        updatedAt: payload.updatedAt,
        source: payload.source,
      };
      IACUC_BY_NUMBER = new Map(IACUC_INDEX.map((item) => [iacucRawKey(item.iacuc), item]));
      invalidateIacucSearchCache();
      IACUC_INDEX_LOADED = true;
      return IACUC_INDEX;
    } catch (error) {
      IACUC_INDEX = [];
      IACUC_BY_NUMBER = new Map();
      invalidateIacucSearchCache();
      IACUC_INDEX_LOADED = false;
      throw error;
    } finally {
      IACUC_INDEX_LOADING = false;
      IACUC_INDEX_PROMISE = null;
    }
  })();
  return IACUC_INDEX_PROMISE;
}

async function loadPrincipalIdentities() {
  if (!remotePersistence && !currentUser) {
    PRINCIPAL_IDENTITIES = [];
    PRINCIPAL_IDENTITY_BY_NAME = new Map();
    lazyDataState.principalIdentitiesLoaded = true;
    lazyDataState.principalIdentitiesLoading = false;
    return PRINCIPAL_IDENTITIES;
  }
  if (lazyDataState.principalIdentitiesLoading) return PRINCIPAL_IDENTITIES;
  lazyDataState.principalIdentitiesLoading = true;
  try {
    const response = await fetch(API_PRINCIPAL_IDENTITIES_URL, { cache: "no-store" });
    if (response.status === 401) {
      currentUser = null;
      render();
      throw new Error("请先登录");
    }
    if (!response.ok) throw new Error("加载项目负责人身份失败");
    const payload = await response.json();
    PRINCIPAL_IDENTITIES = (payload.items || []).map((item) => ({
      ...item,
      principalType: normalizePrincipalType(item.principalType),
      freeCageAllowance: freeCageAllowanceForPrincipalType(item.principalType),
    }));
    PRINCIPAL_IDENTITY_BY_NAME = new Map(PRINCIPAL_IDENTITIES.map((item) => [normalizePersonName(item.pi), item]));
    lazyDataState.principalIdentitiesLoaded = true;
    state.billingPrincipalType = principalTypeForPi(state.billingPi);
    state.freeCageAllowance = freeCageAllowanceForPi(state.billingPi);
    return PRINCIPAL_IDENTITIES;
  } catch (error) {
    PRINCIPAL_IDENTITIES = [];
    PRINCIPAL_IDENTITY_BY_NAME = new Map();
    lazyDataState.principalIdentitiesLoaded = false;
    throw error;
  } finally {
    lazyDataState.principalIdentitiesLoading = false;
  }
}
