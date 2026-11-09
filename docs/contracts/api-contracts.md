# CageLedger API 契约

接口总清单见仓库 `docs/contracts/api-inventory.json`，开发参考由 `scripts/api_inventory.py` 生成到 `wiki/API接口清单.md`。清单记录方法、路径、用途、鉴权、请求／响应摘要、前端调用模块线索、兼容状态，以及版本、幂等、事务、审计与GET副作用；当前HTTP路由及业务规则保持不变。使用 `npm run check:api` 检查，`npm run api:inventory` 重新生成参考页。写入版本的可选兼容、必填精确版本及现有事务限制以 [write-safety.md](write-safety.md) 为准。

JSON、multipart上传及失败的下载请求共用前端 `ApiError`，保留原 `status`、`message`、`payload`，增加 `code`、`requestId` 和可选 `details`。优先使用服务端错误码，无错误码时使用 `HTTP_<status>`；请求编号从响应头 `X-Request-ID` 或兼容响应体读取，只接受现有16位十六进制格式。服务端原 `error` 文案及返回结构不作全量改写。合法204明确表示无内容；其他成功JSON响应解析失败抛出 `INVALID_JSON_RESPONSE`，不当作成功空对象，网络中断与取消继续向上传播。所有写请求仍默认零自动重试。

上传使用 `requestMultipart`，文件字段和业务参数保持原状，由浏览器填写multipart边界，不手工设置JSON Content-Type。上传与JSON请求共用会话、诊断脱敏和错误处理；文件下载继续保留二进制响应，不包裹为统一JSON成功格式。

## 列表、目录与按需详情

`GET /api/rooms` 返回 `{items}`，直接读取房间目录并按当前账号过滤。它不包含笼位、占用或全系统汇总；`/api/quantity-sheet-rooms` 继续提供数量统计表跨房间业务所需目录，不能替换为授权房间范围。

新增三个只读接口，均先校验当前账号范围，不组装全量 state、不新增审计或修改业务记录：

| 路径                                   | 响应与用途                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/api/infrastructure/structure`        | `{rooms,racks,roomSummaries,rackSummaries}`；房间、笼架和真实笼位数量，不返回完整笼位或占用    |
| `/api/infrastructure/rooms/{id}`       | `{rooms,racks,slots,occupancies,placementTasks}`；仅指定房间的工作数据，包括该房间原有占用历史 |
| `/api/infrastructure/racks/{id}/slots` | `{items}`；指定笼架编辑所需的真实笼位                                                          |

无权限返回403，不存在返回404。原 `/api/bootstrap` 的参数和响应继续兼容；summary 缓存检查在读取共享 state 之前执行。

笼位图使用 `/api/infrastructure/rooms/{id}?view=cages`，响应结构和记录字段不变，只返回 `active`／`reserved` 占用和状态不为 `active`／`cancelled` 的进驻任务，保持原排序。省略 `view` 仍返回该房间完整占用历史；筛选不修改历史记录。当前视图使用独立查询键，单项操作只失效目标房间及关联笼架，批量操作在本轮结束时统一刷新一次。

数量表和技术服务列表支持 `view=summary`。数量表原默认列表本来就采用 SQL 投影，显式 summary 与该投影一致；技术服务 summary 保留月份、伦理号、服务项目、服务日数、数量、金额、保护状态和 `updatedAt`，省略 `rows`、价格快照等详情。不传 view 的原列表响应保持原状。预览和编辑通过原单条详情接口读取完整数据；技术服务普通编辑仍使用原价格快照，删除继续提交列表所见版本，不能通过读详情静默替换该版本。

`GET /api/intake-batches` 未指定 `sortKey` 时，接收日期待定（空字符串或 null）的批次优先置顶，已确定日期继续倒序；同组按更新时间、行号倒序稳定排列。排序在筛选后、分页前完成；显式 `sortKey`/`sortDir` 保留所选列原有升降序语义。

`GET /api/intake-batches?view=summary` 返回 `IntakeBatchListItem` 列表，保留列表、统计、批量操作和版本校验所需字段，不返回笼卡、预约原文或识别依据。省略 `view` 的列表保留完整旧响应。编辑时通过 `GET /api/intake-batches/{id}` 读取单个完整批次，读取范围与原有到货记录一致。`POST /api/intake-batches/print-data` 接收 1 至 200 个不重复的 `ids`，可选 `expectedVersions`；指定时须覆盖全部 ID，版本不匹配返回409，批次缺失返回404。响应按请求顺序返回只读打印投影 `{items}`，保留版本、版面字段和卡片的原ID、短码及建议数量，不返回预约原文、识别依据或接收历史，不产生审计；前端冻结所选版本并按每批不超过200条请求，全部成功后打印。普通详情与写入响应继续完整。

`POST /api/iacuc-index/lookup` 与伦理目录读取使用相同登录权限，只读、不推进业务状态或产生审计。请求 `{codes}` 包含1至200个非空伦理号，按去首尾空白、转大写精确匹配，重复号去重。响应 `{items,counts,updatedAt}` 中 items 仅含伦理号与负责人，每号最多80项；counts 保留各号的完整匹配总数（未找到为0），以便前端维持缺失、空负责人及歧义提示。统计每批不超过200号、最多3路请求，关闭时取消只读查询；不将负责人结果长期缓存为业务快照。

`GET /api/animal-inspections` 与 `GET /api/animal-inspection-findings` 可选 `view=summary`，分别返回巡检和异常列表所需状态、定位、操作字段及版本；前者保留异常计数，后者包含关联房间和创建人。摘要不返回巡检快照、答案、异常附件或事件，未指定 `view` 继续返回原完整列表。巡检计数批量读取，零异常巡检不再逐条回退；异常摘要以关联查询获取房间信息。

`GET /api/animal-inspections/{id}?view=edit` 只返回 `{item,answers}`；`view=display` 另附目录项目名称与异常状态、处置、定位、复查日期及 `attachmentCount`，不读取事件、附件元数据或完整目录配置。省略 view 保留原完整详情；所有视图使用相同的房间可见性校验。目录仍使用当前已发布版本，不改变历史目录的既有读取口径。`GET /api/animal-inspection-catalog?view=summary` 返回 `{version,modules,reviewNotice,moduleItemCounts}`，异常动物模块计数沿用表单的身体部位分组规则，省略 view 保留原完整目录。

巡检保存与提交可携带 `expectedUpdatedAt`：存在该键时精确核对版本，过期、空值或无效版本返回409；旧客户端省略时保持兼容。校验、写入、审计在同一写事务。仅自动提交前可跳过未改变的草稿保存，显式保存继续记录原审计。携带版本的提交在原写事务内重新固化当前房间及有效占用快照，同步更新投影列，不重插答案或增加草稿保存审计；省略版本的旧调用继续使用原草稿快照。提交及照片上传整链最终统一失效列表与详情；原图最多3路上传，失败项可单独重试，不重新保存或提交巡检。PDF 每次重新鉴权和读取当前报告输入，复用实际 HTML 内容哈希对应的受限缓存；处置、状态、复查或目录名称改变后自动使用新内容。

检疫批次页对当前页检测记录只读取方法与状态计算记录数、已出具数及方法；检测与报告列表先确定当前页，再投影字段和计算异常数，不返回完整检测、批次或报告快照。分页、筛选、复检、更正、历史报告版本和默认响应结构保持原规则。

`GET /api/quarantine/suppliers/summary` 接受原历史筛选以及 `limit/offset`，返回 `{items,page}`，按原统计口径聚合后分页，不包含明细和来源ID集合。`GET /api/quarantine/suppliers/details` 另需 `groupSupplier/groupMethod/groupRetest`（true或false），返回该精确分组的分页明细。两者默认10条、最大100条；旧 `/suppliers` 保留原完整结构、顺序和统计口径。关联检测批量读取，分组详情提前过滤，但纠正、复检计算仍保留匹配批次的完整检测上下文。

管理员 `GET /api/animal-inspection-catalog/draft/status` 返回 `{hasDraft,updatedAt}`，未有草稿时为 false和空字符串，读取不创建草稿。完整草稿仍在进入编辑时读取，原克隆、保存、发布与恢复规则不变。状态保留原精确差异比较，响应轻量不等于常数时间查询。

IACUC 状态在数据库有索引记录时只查询数量和最近导入时间，不读取应用 payload；文件方式的旧安装保留原回退与缓存。运行日志通过固定阶段标签关联连接、查询、解码、权限过滤、设施汇总和检疫关联耗时，不记录SQL、筛选值或业务内容。

## 当前界面与兼容接口

当前入口按 [current-baseline.md](current-baseline.md) 核对。单据跟踪由 `WorkflowCenterView` 挂载 `BillingWorkflowPanel`，通过 `/api/billing-workflows/*` 完成交回登记及补录；旧应收、报销单、核销中心和历史台账四页签不再挂载。`/api/reimbursement-ledger/*` 及原台账读写继续兼容，历史 Excel 导入仍由数据管理使用，领域服务及资金保护继续保留。支持状态、静态调用模块和组件测试均不等同于当前菜单入口；不能据前端不可达删除 API、payload 或迁移。

内部 `statement_archived` 表示已登记且未归档，`statement_locked` 才表示已锁定且已归档；历史状态继续只按原兼容规则读取。当前阶段和授权以 workflow service、权限投影及实际 UI 为准，不按英文常量名称推断产品文案。

## 多人负责人展示与筛选

`pi`（项目负责人）和 `owner`（实验负责人）的原始文本继续保存在原字段中。界面按 `、 / \ ; ； , ， | ｜ ／ ＼` 及换行、制表符拆分、去两侧空白和重复项，使用顿号展示；普通空格、中点和连字符不拆分姓名，不按相近文字合并人员。输入控件失焦显示顿号，聚焦可核对原文；仅聚焦、失焦或编辑其他字段不改写原始负责人。

待接收批次、数量表、技术服务、共用结算候选和单据跟踪列表及对应筛选项支持可选 `personFilterMode=individual`。启用后，已有 `columnFilters.pi`／`columnFilters.owner`（以该列表原有列白名单为准）接收单个人名，精确匹配任一成员，多选为 OR、列间为 AND；共同负责人记录只计一行。候选项拆成单个人并按记录去重计数，排除本列筛选、保留其他条件；不在拆分前截断原始组合。未传该参数时仍按完整原值精确匹配，旧参数 `pi` 也继续按原值匹配，响应字段不新增或替换。

检索只读取不同的原始姓名文本，解析为精确存储键后沿用 SQL 分页与筛选；不下载逐日详情、不逐行请求、不创建持久派生表或改写历史数据。客户端 Query 键区分个人筛选模式，保留列表逻辑使用同一查询键；写入后同步失效相关姓名筛选候选。

人工补充保存在业务记录及原有写入审计中，不反写 IACUC 汇总表、索引或负责人配置。预约再次识别同一项目、数量表同一伦理号再次匹配时保留人工负责人；切换伦理号重新匹配。IACUC 导入更新时，业务记录的姓名集合严格包含旧索引姓名，视为人工追加，保留完整原值；未追加的记录继续按原规则同步，已保护数量表继续跳过并沿用原同步留档。

完整原始 `pi` 仍是负责人身份、减免与结算分组的业务键；个人检索不拆账、不合并原分组、不重复累计金额或减免。账单快照、财务打印／PDF、旧接口字段及审计原文保持原有含义。

## 运营总览金额

总览GET在原有鉴权后附加弱ETag。携带匹配的`If-None-Match`时返回304及ETag，无JSON响应体；无条件请求和内容变化仍返回原200 JSON结构，旧客户端无需改动。条件读取不延长原缓存时间，客户端继续每15秒过期并按需重新验证。验证标识只与Query中的该统计范围响应一起保存，错误和取消不能降级成旧数据成功。

`GET /api/dashboard/overview` 继续返回原有接收、房间和负责人统计结构。负责人饲养费覆盖数量统计表来源的全部记录，包括已登记和已锁定的流程；复用共用结算候选的版本识别与批量计算：已发起的有效账单快照优先，明细按原存储校验完整读取；未出单按现行减免、阶梯和单价计算。读取可刷新派生候选缓存，不生成业务账单、推进流程或新增审计。

总览缓存按数据库文件、月份和房间范围隔离。同键冷读取复用现有构建锁，取得锁后重新检查缓存及失效代次；已进入写事务的连接不等待构建锁、不读共享结果、不发布未提交结果。临时或内存数据库不共享缓存，月度及全部历史的原有 TTL、金额状态和排序规则保持一致。

未出账的总览金额按本次月份/负责人批量准备数量表及关联配置，复用完整账单的逐日计算核心，仅省去总览不用的展示结果。首次候选目录同步前先准备金额，取得写锁后核对数据库版本；来源变化时丢弃准备结果，在原事务内重新读取，保留全批回滚及调用者已有事务。有效冻结账单仍先校验完整明细，不回退当前单价。接收统计从原payload流式投影必需字段，保留旧JSON重复键的最后值及类型；房间趋势按实际变化区间合并，保留初始结余、同日最后记录及原历史分组口径。

`quantitySheetIacucCount` 表示当前统计月份有已保存数量统计表的去重伦理号数量，沿用伦理号规范化，忽略空编号。同一伦理号的多张表、不同房间或设施只计一次；`month=all` 按完整历史范围去重。该数字用于“动物实验项目”入口，继续跳转已保存数量统计表；未返回该字段的旧响应显示未提供统计，不用房间数或表数代替。

`feedingFeeTotal` 为同一统计范围全部负责人饲养费的合计，结构为 `{amount,amountState}`，金额使用同一精确金额工具汇总，不含技术服务费，不受前端分页或搜索影响。任一负责人金额为待核算／错误时，合计 `amount=null`，状态分别为 `pending/error`（错误优先），避免把部分已知金额显示为完整总额；真实零和空统计范围返回 `ready` 的零金额。卡片显示完整的两位金额，不采用数量徽标的溢出截断。

`pi[].amount` 保持旧数值字段，新增 `amountState=ready|pending|error` 与出错时的 `amountError`。金额按既有精确金额工具汇总，不截掉小数。只有 `ready` 表示完整可用金额；真正零元仍显示 `0.00`，`pending/error` 在新页面显示待核算／待核查，不把兼容数值占位当作费用。历史合计中任一月份不可用时，不将已知部分误作完整合计。负责人及伦理号数量照常显示，分页、搜索只作用于已返回的完整统计，不只汇总当前页。

候选重算按有界批次读取数量表来源并写入派生候选及伦理关联，不改变旧单项接口。账单头读取仍每次读取完整有序摘要和压缩块，对版本ID、全部行值与顺序、编码、长度、校验字段和实际压缩字节生成完整输入指纹；仅完全相同且此前完整校验成功的输入复用校验结论。缓存独立限512个指纹，不保留业务明细或金额；内容改变、损坏、缺失及新进程均重新完整校验，错误不缓存。账单头每次重新读取，完整明细消费者继续走原完整解析路径。

候选批量重算在首次发布前取得写锁并核对准备阶段的SQLite `data_version`。期间若有其他连接提交，丢弃旧来源及已预取账单头，在锁内重新准备并计算一次，防止旧结果覆盖同事操作后的失效标记。正常准备阶段不提前占用写锁，已存在的调用方事务和回滚语义保持不变；该保护只更新派生候选缓存，不修改业务来源和审计。

审计列表每次读取当前页的原始摘要和压缩块，按事件 ID、完整摘要、编码、原始长度、校验值及全部压缩字节计算输入指纹；仅完全相同且此前完整校验成功的输入复用裁剪摘要。缓存限512项并受线程锁保护，返回对象互不共享；缺块、损坏或输入变化重新验证，错误不缓存，存储标记不进入响应。完整详情和导出仍读取并验证原始完整数据。

## 系统功能入口显示

`GET /api/system/features` 供已登录账号读取全局入口显示配置，响应 `{item:{enabled,updatedAt}}`。`enabled` 包含 `intake`、`reception`、`quarantine`、`cages`、`animal`、`billing`、`technical-services`、`settlement` 八项布尔值，未保存时全部为true且 `updatedAt=null`，读取不写默认记录或新增审计。

`PUT /api/system/features` 仅系统管理员可调用，提交完整八项 `enabled` 及必填 `expectedUpdatedAt`；兼容旧客户端七项提交并保留接收管理开关。首次版本为null，之后精确匹配当前版本；过期返回409，非法开关返回400，房间管理员返回403。写锁内完成重读、版本比对、配置保存和审计；同内容保存不重复写入或审计。`system_features.updated` 记录账号、时间、各入口显示变化及完整前后配置，前端失效操作日志查询。

`GET /api/auth/me?include=features` 在认证后同连接附加 `features`；登录 POST 显式提供 `includeFeatures:true` 时也附带该配置。未选择时两者继续仅返回 `{user}`。配置读取异常时保留会话响应但不附 `features`，客户端再请求独立配置接口并按原错误处理，不用全开配置掩盖失败。读取不创建默认记录或新增配置审计。

配置保存在独立 `system_feature_settings` 单行表，启动幂等建表，不回填或改写原业务数据，旧全量状态写入不会清除配置，也不改变原 `/api/state` 的更新时间来源。开关只控制桌面、手机及跨页面快捷入口；原业务接口、权限、总览统计和历史单据读取不受开关限制。读取失败显示错误，不默认为全部开启。

## 共用结算调用与路由登记

通知邮件准备可向原饲养费预览或技术服务预览显式传`view:"notice"`，响应仅含`statement:{pi,month,totalAmount}`与`sourceVersions`。仍按最新来源完成原计算、冻结账单及权限校验，不复用旧列表金额；原候选更新和缓存失效时机不变。饲养费只有`persist`和`initiate`均未启用时采用摘要；正式写入、默认预览及PDF/Excel继续完整。通知确认使用本次摘要的技术服务来源版本，409不补查或重试；取消邮件返回账单时重新读取完整预览，摘要不覆盖完整账单状态。

共用候选明确筛选为技术服务时不准备或重算无关饲养费候选；费用类型筛选项去掉自身条件，仍包括全部适用来源。混合费用的金额排序和金额过滤仍先刷新全部匹配过期候选，再计数与分页。技术服务保护集合投影必要来源ID，保留缺失/非活动版本及异常历史JSON的原校验路径，不跳过冻结账单完整核验。Excel只生成最终交付所需的单工作簿或ZIP内各工作簿，公式、格式与文件名不变。经费本目录仅在实际填写报销字段时启用，启用仍读取最新资料，手填与其他项目经费确认保留。

`src/react/api/settlements.ts` 集中结算候选查询、筛选、预览、发起和导出；请求类型在 `src/contracts/settlements.ts`。页面使用 `usePreviewSettlement`、`useInitiateSettlement`，批量发起复用 `initiateSettlement`，沿用现有查询失效范围与零自动重试。`billing.ts`、`quantitySheets.ts` 和 `technicalServices.ts` 中原有结算导出函数继续兼容。

饲养费仍调用 `/api/billing-statements/generate-by-pi`，保留 `status=draft`、`persist` 和 `initiate` 参数；技术服务仍使用 `/api/technical-services/settlements/preview` 与 `/api/technical-services/settlements`。共用发起动作优先提交已预览的 `sourceVersions`；仅调用方未提供版本时先获取预览，409后不重新预览、不自动重试。原技术服务mutation仍要求调用方提供版本，缺失时交由旧接口校验，不新增预览补齐。同月同负责人两种费用继续生成独立账单与业务键。Excel、PDF及异步导出任务的原URL、参数和账单快照读取规则不变。

后端入口统一由 `server_app/web/router_registry.py` 装配。`route_definitions/` 按领域登记方法、路径、动作及旧匹配器，`route_registration.py` 绑定原处理函数；`read_actions.py`、`write_actions.py` 保留原HTTP动作。`read_routes.py` 管理API与静态资源的分流，`write_routes.py` 在所有写请求分发前执行来源检查。命名空间代理保留原来的登录、未知路径响应和路径解析；已有匹配器继续控制ID解码和路径分隔符，不全局二次解码。

`npm run check:api` 要求清单与全部路由登记双向对应，检查动作入口和路由条件指纹；运行时回归另外核对实际装配表、固定路径优先级、下载只响应一次及来源检查。新增接口须同时登记路由、更新清单与调用类型，不能仅刷新指纹绕过登记。

## 预约原图暂存与识别

新页面先通过 `POST /api/intake/recognition-uploads` 一次 multipart 上传1至4个同名 `file` 原件，响应 `{items:[{uploadId,name,mime,size,sha256,expiresAt}]}` 按输入顺序返回。沿用静态 PNG/JPEG/WebP、单图5MiB、合计15MiB及像素限制；鉴权后才读取上传。引用绑定当前账号，进程私有临时目录保存原字节，内存仅留元数据；30分钟TTL、总128MiB/64文件、每账号60MiB/16文件，上限返回503。过期在后续访问回收，进程正常退出清理临时目录；成功保存的暂存副本可在下一次上传回收，不进入备份或业务原件目录。

`POST /api/intake/ai-parse` 接收 `imageRefs:[{uploadId}]`，批次POST/PUT接收 `recognitionImageRefs:[{uploadId}]`；继续兼容旧 `images`／`recognitionImages` base64格式，不同时提交。每次引用复核账号、期限、大小及完整SHA；不重复解码已验证的同一原图。暂存丢失或重启失效在模型调用和业务写入前返回410及 `INTAKE_UPLOAD_EXPIRED`，页面保留原File并最多重新上传重试一次。版本冲突、权限或其他错误不自动重试。暂存引用和图片字节均不进入批次JSON或审计，持久原件与原有来源、重复确认及版本规则不变。

原件的排他创建、写入与fsync先于SQLite写锁；事务内仍重新核对权限、版本、重复项并保存引用和审计。失败清理仅本次拥有的文件，已存在原件不覆盖；成功也清理未采用的重复副本。识别与保存共用同一上传，不因重复确认再次传原图。

预约AI最多2个活动请求，同账号相同完整输入只合并仍在运行的任务，最多2个合并等待者；超额503并保留草稿。完成/失败后不缓存识别结果，显式重识别仍调用模型。AI副本仅对不超过1200万像素的RGB或不透明RGBA PNG保守裁纯白边，所有非纯白像素及安全留白保留；没有至少15%面积和字节收益、背景不确定、透明图、JPEG/WebP或超大图时保持原字节。不缩放、不做有损转码。原件、人工预览及 `inputImages` SHA不变，新增可选 `recognition.imageProcessing` 留存版本、图片序号、尺寸、裁剪框及前后SHA，历史依据不回写。

## 接收管理

接收列表直接投影现有 `status=received` 批次，不创建重复预约。权限沿用接收批次的登录读取权限；独立 `reception` 开关只控制入口显示。`GET /api/receptions` 提供分页、排序、列筛选与申请资料版本，`GET /api/receptions/filter-options` 按需读取漏斗选项并保留其他列筛选；负责人按单人匹配，项目字段采用当前实验申请汇总表唯一精确匹配的伦理号，匹配失败或歧义时留空，不回退预约人员或项目字段。合格证数量、登记状态、`registrationUpdatedAt`和`registeredQuantity`通过当前页批量摘要补齐，不返回证件明细或识别原文。原数量、性别、规格列明确标为预约值，筛选排序口径不变；登记合计独立展示。

`POST /api/receptions/preview` 和 `/api/receptions/export` 均接收 `{ids,expectedVersions,expectedApplicationVersion}`，限制1至200个不重复批次；版本变化、状态回退或申请数据变化返回409。预览返回独立接收登记结构、预填行和待核对信息；读取在同一数据库快照内完成。列表不传输原始预约、AI原图或笼卡。Excel兼容原表B至U列，保留空M列；编号写文本、有效日期写Excel日期，所有文本禁止解释为公式。匹配项目来自申请汇总表，动物数量／性别／规格仍是预约预填。只有唯一、非负整数、合计吻合的雌雄来源数量才拆行；不猜测分摊。合格证等缺失字段导出为红底深红字“待补充”；空白M列、可空备注不标记，数值0保留。无实际接收日期或多次接收缺少各次只数时，导出接收时间标记待补充并提示，不使用预约时间替代或重复计数量。

登记结构保留批次关联、实际接收记录关联、申请来源与版本、接收明细和证件字段。等级按已登记物种预填：小鼠、大鼠为`SPF`，其他实验动物为`普通级`；合格证确认后采用人工核对的证载等级。新增幂等建表`reception_certificate_attachments`、`reception_certificate_runs`、`reception_registrations`、`reception_registration_requests`，只保存新附件、识别记录、独立登记及写入回执，不回填或修改原业务记录。项目字段仍在读取时按当前申请汇总表匹配。导出已确认登记的证载品系、等级、性别数量、规格、出售单位和证号；未确认批次继续旧预填规则；不导出V列后采购入库报销内容。导出成功提交`reception.exported`审计并记录实际登记版本，不改变接收、打印、进驻、结算及检疫状态。

预览可显式传`view:"summary"`，返回`items,rowCount,applicationVersion,warnings,registrationVersions`，不传输完整`rows`；省略该参数保留原完整结构。摘要仍计算相同校验、行数和提示。页面关闭或重试取消只读预览，正式导出继续提交预览所核对的登记版本并在新快照内复核，不复用旧预览作为最终数据；`/export`即使带`view:"summary"`也生成完整Excel并记录原审计。

详情和指定批次读取不计算全库接收日期；计数、筛选及排序按实际依赖选择日期与项目关联，日期相关操作仍先全局筛选排序再分页。项目投影每次读取当前事务可见的全部相关字段，只以完整字段值复用人员拆分、序列化和指纹纯计算，保持全索引版本及最新来源时间；缓存限制条数和输入大小，超限正常计算不留存。登记保存按本次调用复用原始识别结果，保留稀疏来源行号、首次匹配、逐行归属、历史版本提示和字段来源。上传与识别串联后合并当前批次详情刷新，识别不再失效列表及筛选选项，登记保存仍更新列表摘要。

### 合格证与人工确认

| 方法      | 路径（均位于`/api/receptions/{batchId}`）  | 用途                                                                                                     |
| --------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| GET / PUT | `/registration`                            | 按需读取详情／人工确认独立登记                                                                           |
| POST      | `/certificates?expectedBatchUpdatedAt=...` | multipart `file`上传PDF，最多30MiB、100页，每批次20份；重复SHA返回已有原件                               |
| POST      | `/certificates/{attachmentId}/recognize`   | `{requestId,expectedBatchUpdatedAt,includeAllPages?}`显式识别，返回`{run}`及running/completed/failed状态 |
| GET       | `/certificates/{attachmentId}/file`        | 受控下载完整PDF原件                                                                                      |
| GET       | `/certificates/{attachmentId}/preview`     | 受控读取已生成首页PNG，不触发AI                                                                          |

上传、识别、登记确认沿用现有接收账号角色（管理员／房间管理员），服务端复核账号、已接收状态、批次版本和附件归属。PDF原件完整留档，通过有超时和并发上限的Poppler校验并生成首页人工预览。UUID存储名禁止目录穿越、覆盖和跨批次读取；原件及预览保存SHA256，下载和识别前校验。文件写入与AI网络调用在数据库写事务外，失败清理当前尝试尚未提交的文件；原件元数据、任务状态和审计使用短事务。最多2个并行识别，AI网络超时沿用现有配置；中断的任务在超时后允许新请求重识别并保留中断审计。

识别默认自动遍历全部页面，在高清转图前仅排除明确手机画幅的疑似照片；纸张画幅、首张和未知页继续保留，不以颜色、近白覆盖或放宽比例匹配激进排除页面。`includeAllPages:true` 保留全部页面作为人工选择的兜底。画幅只决定候选范围，不能证明页面内容；送货单、情况说明和现场照片交由识别阶段判断，人工仍须下载完整原件核对。每次最多20页候选，识别图片合计最多30MiB，超限明确失败，不静默截断或提交部分页面。

转图保持最长边3000像素及彩色像素：Poppler输出有界无损PPM，现有Pillow再无损编码为PNG，避免Poppler直接压缩PNG的耗时；不降低分辨率或改用有损压缩。`CAGELEDGER_CERTIFICATE_PAGE_TIMEOUT_SECONDS` 默认90秒、范围15至180秒，单页转图和编码共用预算；`CAGELEDGER_CERTIFICATE_RENDER_TIMEOUT_SECONDS` 默认300秒、范围90至600秒，有效值不小于单页预算，约束整份PDF的转图处理。任一页面失败或预算耗尽时，不向AI提交不完整页面，原件、已有草稿与全页重试入口保持保留。逐页转图日志只记录页码、耗时和预算，不记录图片、原文或业务字段；AI网络调用仍使用既有独立超时配置。

AI仅产生待核对草稿，不确认登记；逐证逐行保留证号、品系、等级、性别和数量。前端选择PDF后顺序调用上传和识别，将结果直接预填至普通编辑弹窗；已有登记只读入保存值，重新上传或显式重试才调用AI。点击“核对并保存”作为人工确认，仍提交`acknowledged:true`及原有版本和幂等字段，不改变接口协议。AI提取可选`quantityRaw`数量原文；数量栏独立的`/`（含全角`／`）按0处理，与明确0行一并过滤，不为该符号提示核对。原符号和规范化的0继续保存在识别证据，其他遮挡或模糊提示保留；真正空白、无法辨识或非独立斜杠的数量仍保持null，不按0推算。旧识别接口无需提供新增原文字段，已留档结果及历史登记不重写。读取旧草稿时，仅对提示中明确记载独立斜杠且可唯一对应的未知数量行应用当前展示规则，同时移除对应的核对提示；真正未知和不能唯一对应的行仍保留。该读取不调用AI，不写识别结果、登记或审计。规格使用现有本地规则规范化，原文保留在识别证据。生产许可证、使用许可证和开证日期分别留档，不自动当成质量合格证号、动物实验证明编号或实际接收日期。

首页识别副本可保守裁去明显近白边缘，包含安全留白、最小内容尺寸和收益阈值；底纹或边界不确定时保持原图字节。保留彩色，不默认灰度、二值化、重绘、去章或强对比度处理。原PDF和人工预览不变；识别原始证据的`imageProcessing`记录处理版本、是否应用、来源/结果尺寸、裁剪范围和SHA256，不保存额外base64副本。

确认请求为`{requestId,expectedBatchUpdatedAt,expectedRegistrationUpdatedAt,expectedApplicationVersion,acknowledged:true,lines}`，首次登记版本为null；缺少/过期版本409。每行必须关联本批次附件，识别来源若存在须为同附件已完成任务，来源索引从1开始；证号、证载品系、等级、出售单位须补全，数量为1至1000000的整数，最多200行。手工补充使用`runId:null`。在当前批次版本下可人工复核旧识别结果，其原版本留档并提示；未保存草稿不因后台刷新覆盖。确认事务保存完整前后审计、字段来源及账号，按账号/requestId/内容签名幂等。

导出新增可选`expectedRegistrationVersions`完整映射（未登记为null），新页面始终携带，变化409；旧客户端省略时继续兼容读取。登记对应的预约版本变化时标记需复核，禁止静默导出旧确认值；复核确认后恢复。多次接收的证件明细可显式选择各自receiptId，日期由接收记录读取；未选择时留待补充，不根据开证日期推算或重复分配总数。恢复演练同时核对原PDF、首页预览、大小、SHA和受控下载。

登记行 `strain` 采用批次 `strainStandard`，缺失时只使用已有确定性本地规则匹配原品系，未知值留空并提示，Excel标记待补充。登记行 `supplier` 使用共享供应商目录的全称，已知分公司全称保持对应分公司，简称使用目录首选全称；未知名称保留原文并提示，歧义值不猜测。列表摘要和原批次不因此改写，导出J／Q列读取独立登记行。

系统功能配置新增 `reception` 默认开启；旧库七项配置只读补默认值，旧客户端提交完整七项时保留已有接收开关，继续执行原版本控制与管理员审计，不自动写回默认配置。

## 数据核查只读页面

系统管理员通过“系统设置 → 数据核查”读取既有留档，桌面和手机共用入口；房间管理员不可见，所有接口均在读取数据库前校验管理员权限。`GET /api/data-quality/latest/issues` 在同一次只读查询中选择最新留档并返回与指定留档问题列表相同的结构，未有留档时返回 `scan:null`、空列表和空筛选项；`GET /api/data-quality/scans` 分页返回留档摘要；`GET /api/data-quality/scans/{scanId}/issues` 提供当次留档的问题分页、`code`／`reviewStatus` 列筛选与排序；`GET /api/data-quality/scans/{scanId}/issues/{issueId}` 按需读取关联快照及校验后的证据。证据缺失或SHA-256不匹配返回409，不展示为正常或空证据。

列表、计数和分类按所选扫描的清单计算，不使用全局问题登记的最新分类替代历史结果。详情只能读取该次留档包含的问题，历史证据不被后续留档覆盖。没有核查留档与一次核查零问题分别展示。扫描时间、当时最新业务写入、核查范围和输入／备份指纹保留原含义，零问题不表示所有业务数据已经通过完整检查。

这些接口只执行查询，连接启用 `query_only`；不调用检测器、不创建扫描、不更新问题或证据、不修复业务记录、不新增业务审计，也不改变启动升级核查的版本、去重或失败重试规则。页面“刷新”只重新读取已有留档，不提供修改、重扫、销项和导入操作。目录和最新问题并行读取，首次成功后固定返回的留档 ID，后续翻页、筛选、排序和重试继续按该 ID 读取；显式切换留档才重置页码与选择。各请求通过独立 typed hooks 与 `data-quality` Query keys 读取，切换留档不沿用上一留档的问题占位数据，关闭详情取消不再使用的请求。

留档读取每次先鉴权并读取当前行，再按完整payload及清单元数据的内容指纹复用已校验纯投影，不仅以scanId命中；不同库同编号但内容不同不会串用。目录摘要最多128项/2MiB序列化正文，问题投影最多4份/估算32MiB（含有界排序/筛选引用），超大输入继续读取但不缓存。返回值独立复制，详情证据每次从当前库读取并完整校验SHA；旧留档状态不由最新问题标记替代，损坏或删除不能返回旧正常内容。目录增加时间/ID排序索引，不回写原留档或业务数据。证据折叠内容展开后才解析，并保留完整原文及坏JSON回退。

实验人员导入预览与确认按文件中规范化账号分批读取现有人员，保持完整文件校验、原预览差异及token、确认时最新版本复核、稳定requestId重放和整批审计/回滚。单条资料PUT的完整返回值更新目标Query，取消该详情旧读取，只刷新人员列表/部门目录与审计；导入仍失效原范围。退出、切换账号或同账号重新登录后的旧完成不回填新会话缓存，列表刷新失败不将已提交写入报为失败。

## 技术服务计费

桌面与手机导航统一分为“饲养费管理、技术服务费管理、结算管理”。录入页采用“录入数量统计表／录入技术服务明细”；结算入口统一为“结算列表”。原技术服务结算视图标识兼容渲染共用列表，业务接口保留。

`GET /api/settlement-candidates` 返回共用分页列表；`GET /api/settlement-candidates/filter-options?column=...` 返回列头筛选选项。列支持 `month/pi/iacuc/manager/amount/workflow/feeType`，筛选与排序在两类记录合并后执行、再分页。`feeType=feeding|technical_service`，每条记录另带 `sourceType=quantity_sheet|pi_merged_technical_service`；ID包含费用类型，同月同负责人两类费用不会覆盖。已登记和已归档记录沿用饲养费候选规则，仅在单据跟踪继续处理。技术服务读取沿用管理员／房间管理员授权。

预览、发起、邮件及导出按行内来源分派。技术服务发起仍使用技术服务接口和预览返回的 `sourceVersions`，确认时校验版本；批量发起逐项预览并提交。共用PDF任务及Excel导出接受技术服务来源，按技术服务版式输出单位、数量和金额，已发起单据读取有效账单快照。`POST /api/billing-statements/generate-by-pi` 对技术服务仅支持只读预览，发起需使用技术服务版本校验接口。

`/api/technical-services/*` 要求管理员或房间管理员登录，沿用数量统计表业务录入授权；写入保留来源校验、事务及审计。

| 方法               | 路径                                                                     | 输入与响应                                                 |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| GET                | `/api/technical-services/catalog`                                        | `{items}`，21项版本化收费标准                              |
| GET / POST         | `/api/technical-services/sheets`                                         | 分页筛选 / `{sheet}` → `{item}`                            |
| GET / PUT / DELETE | `/api/technical-services/sheets/{id}`                                    | 详情 / `{sheet,expectedUpdatedAt}` / `{expectedUpdatedAt}` |
| GET                | `/api/technical-services/settlement-candidates`                          | 按月按负责人分页，含金额与流程状态                         |
| GET                | `/api/technical-services/{sheets\|settlement-candidates}/filter-options` | 列头筛选选项 `{items:[{value,label,count}]}`               |
| POST               | `/api/technical-services/settlements/preview`                            | `{month,pi}` → `{statement,lines,sourceVersions}`          |
| POST               | `/api/technical-services/settlements`                                    | `{month,pi,sourceVersions}` → 有效账单与共用workflow       |
| POST               | `/api/technical-services/settlements/pdf`                                | `{month,pi}` → 技术服务PDF，已发起时使用账单快照           |

明细固定为月份、IACUC、设施、服务项目及院内／院外类别组合，相同组合返回409并提示编辑已有记录。IACUC必须匹配现有数据，项目负责人和项目来源由服务端校验。服务数量和金额不使用笼位减免算法。

列表支持 `columnFilters` JSON对象（列名对应多选字符串数组）、`sortKey`、`sortDir=asc|desc`、`limit`及`offset`。明细列为 `month/iacuc/pi/facility/serviceName/serviceDayCount/quantity/amount/status`；结算列为 `month/pi/iacuc/amount/workflow`。筛选选项传 `column`，统计全部匹配记录，并排除本列当前筛选、保留其他列筛选；筛选在分页前执行。结算伦理号按任一选中伦理匹配整张负责人结算单，金额筛选与排序沿用有效账单快照，未发起时按完整负责人来源汇总。旧 `month/keyword` 参数仍可用；未知字段及无效筛选返回400。

日期必须属于月份且不可重复。数量须为有限非负数；整数单位拒绝小数，小时类由用户填写已确认计费数量，正值至少1，不自动取整或按日截为12小时。零数量不计服务日。每张表1至31行。

创建使用稳定草稿ID；同一账号同ID同输入重试复用记录，不重复审计。编辑和删除必须提供正确的`expectedUpdatedAt`，缺失或过期返回409。删除保留去重标记，旧创建请求不能恢复记录。

单价与项目信息保存快照，普通编辑保留原价格，更换服务项目或类别重新匹配目录。发起前完整核对`sourceVersions`，变化返回409。来源`pi_merged_technical_service`按月按负责人使用独立业务键，编号前缀`CL-PTS`，复用既有流程状态、经手权限、账单快照及来源保护。

共用流程列表支持`sourceType=pi_merged_technical_service`与`sourceType=feeding`筛选；结算应收返回`feeType=technical_service|feeding`。旧记录默认饲养费。共用月度汇总保持原饲养费列语义，新增技术服务费列，零值按0.00显示，支持技术服务独有月份。

## 帮助与反馈

`/api/feedback` 全部要求登录。所有登录角色可分页查看、创建反馈、追加补充、上传本人原始反馈或本人补充的截图、设置本人遇到状态。`integration`、`retry` 和历史导入仅管理员可用。原始反馈及补充没有修改或删除接口，修正追加说明；`version` 是只读版本，追加写入通过事务和唯一请求标识并发保护，不覆盖原文。

| 方法       | 路径                                                         | 返回                                         |
| ---------- | ------------------------------------------------------------ | -------------------------------------------- |
| GET / POST | `/api/feedback`                                              | 分页 `{items,total,limit,offset}` / `{item}` |
| GET        | `/api/feedback/filter-options?column=...`                    | `{items:[{value,label,count}]}`              |
| GET        | `/api/feedback/{id}`                                         | `{item,attachments,comments}`                |
| POST       | `/api/feedback/{id}/comments`                                | `{item}`                                     |
| POST       | `/api/feedback/{id}/attachments?requestId=...&commentId=...` | multipart `file`，`{item}`                   |
| GET        | `/api/feedback/attachments/{id}`                             | 鉴权截图下载                                 |
| PUT        | `/api/feedback/{id}/encounter`                               | `{encountered:boolean}` → `{item}`           |
| POST       | `/api/feedback/{id}/sync`                                    | 缓存过期后排队检查，`{queued}`               |
| GET / POST | `/api/feedback/integration` / `/api/feedback/{id}/retry`     | 管理员集成状态 / `{queued}`                  |

反馈列表默认保持完整响应；可选 `view=summary` 使用同一筛选、排序、分页和可见性，仅省略各项的 `description`、`environment`、`importMetadata`。前端摘要与完整列表使用不同 Query 键，不能把摘要填入详情缓存。列表和详情支持基于最终账号响应的弱 ETag；鉴权、逻辑删除、可见性及原详情刷新排队先执行，匹配时返回私有 `no-store` 的 304。客户端的验证器和数据由同一 Query 持有，注销时一并清理，404 不复用旧详情。

创建／补充及其截图串行写链在结束后统一刷新受影响列表、详情、筛选与集成状态，部分附件失败也刷新已落库内容；保留原请求标识、未知结果重放及仅重传失败截图。普通操作不重新读取无关导入预览，导入完成仅协调一次预览刷新。原前台 5／15／30 秒轮询节奏保留，后台页停止轮询。

集成状态返回 `configured`、`repository`、`pending`、`errors`、`lastError`，另含 `workerState`（`running/recovering/blocked/stopped/unconfigured`）和脱敏的 `workerError`。任务失败数和服务健康独立统计；仅管理员可读取。管理员 `retry` 保留任务的不确定标记，唤醒或重新启动串行同步线程，并按现有一分钟缓存规则排队核对已关联的工单。页面在前台每 15 秒刷新集成状态。

Gitea 读取请求遇到短暂连接或响应错误时最多尝试三次；HTTPS 写入仅在连接建立阶段明确失败、尚未发送 API 请求时允许有限重试。连接阶段错误不会标记为发送结果不确定，证书校验不会关闭或降级；发送后的响应超时仍保留不确定标记并核对远端，不自动重复写入。

Gitea 条件读取缓存仅属于单个串行 Client 的仓库／凭据实例，最多 128 项及 8MiB，始终真实请求，只有服务器返回 304 才复用已收到的完整 JSON；服务器未提供验证器时继续完整读取。写入或认证失败清除该缓存，重试从原始 URL、方法、正文和头重建请求，避免代理处理改写下一次的目的地。远端同步按差异更新评论和附件，保留原文、公开性、删除、任务 generation 和审计规则；每次成功刷新仍更新最近同步时间及原只读版本。过期扫描按批排队，沿用调用者事务和整轮回滚。

远端截图每次仍读取父工单／评论和附件元数据，核对当前内部标记及下载地址；本地缓存以仓库、反馈、父资源、远端附件 ID 和 URL 绑定，并完整校验文件 SHA、大小和类型。可靠 ETag 允许条件下载；缺少有效验证器或本地凭据时重新下载。相同完整字节可复用已验证结果，省去重复解码与落盘；损坏／缺失缓存不会发送旧验证器。返回前继续复核可访问性，附件仍为 `no-store`。新增 `feedback_attachments.cache_sha256/cache_etag/cache_identity` 仅保存非凭据缓存证据，旧库空值自动回填，备份恢复时随数据库和既有附件文件一起保留；校验不匹配会退化为重新获取。

历史工单导入：`GET /api/feedback/import/preview?state=all&page=1` 返回 `{repository,items,page,hasMore}`，每页 20 条，可选 `all/open/closed`。`POST /api/feedback/import` 接受 `{requestId,repository,numbers}`，每次 1 至 10 个唯一正整数编号，返回 `{items:[{number,outcome,feedbackId?,message}]}`；结果为 `imported/skipped/failed`。仓库必须与当前预览一致；请求 ID 绑定操作人和导入范围，重放同请求复用逐项结果，失败项通过新请求重试。并发导入按仓库身份和工单编号核对，逻辑删除的关联不重新导入。PR、内部正文和带系统建单标识的工单跳过。

导入仅远端读取，网络调用不占用写事务；每个工单独立落库及审计，部分失败不丢失成功记录，也不创建新工单。`source=gitea` 和 `importMetadata` 区分原提出人、远端登记账号及导入操作人；原正文、原创建时间保留快照，进展和公开评论沿用现有同步。原工单截图关联到无评论的远端附件，鉴权下载时重新验证工单及附件权限、内部标记和实际图片内容。

列表筛选 `keyword,kind,module,status,mine=1,limit,offset`，每页最多 100。创建和补充必须提供稳定 `requestId`，相同用户和标识重复返回同一记录，不同内容拒绝；附件同样以请求标识去重。遇到状态幂等，追加内容不覆盖其他人的记录。截图校验实际像素内容，只接受单帧 PNG/JPEG/WebP，每张 10MiB、每条原始提交或补充最多五张。

列表支持 `columnFilters` JSON 对象、`sortKey`、`sortDir=asc|desc` 及原有分页。列白名单为 `number`、`title`、`kind`、`module`、`status`、`author`、`syncStatus`、`encounterCount`、`createdAt`；列内多选、列间 AND，提出人值为用户 ID。候选项接口遵循同一筛选条件，但忽略自身列的选择，不受分页限制；值、显示名、计数由服务端汇总，删除记录不可见。筛选值仅作 SQL 绑定参数，排序和列名按白名单校验。旧 `keyword`、`kind`、`module`、`status`、`mine` 参数继续兼容。

确认远端工单已删除后，在事务中标记逻辑删除、隐藏全部补充和附件、结束同步任务并记录 `feedback.deleted` 审计。所有列表及总数排除删除记录；详情、附件下载、新增／重放补充和附件、遇到状态、同步及管理员重试返回 `404`，原创建请求重放也返回 `404`，不恢复内容或重建工单。数据库保留原记录和请求去重标记，已有 `deleted` 记录同样从公开接口移除。`deleted`／`removed` 类型保留兼容旧缓存，前端收到旧缓存或详情 `404` 时隐藏旧内容、刷新列表及统计；普通网络故障保留重试。仓库或工单列表不可访问不会推断删除。

共享仓库身份随原始反馈保存；后台持久任务串行同步，不在数据库写事务内访问网络。Gitea 状态、负责人、里程碑单向投影到系统，系统提交与补充同步到工单，不提供本地状态编辑。仅关联工单入库，内部评论及其附件在所有用户响应中隐藏。正文和公开回复保留原始文本，前端通过白名单 React 节点渲染 Markdown；原始 HTML 仅作为文字显示，不加载正文外部图片，仅允许无凭据的 HTTP、HTTPS 和邮件链接。截图仍经附件区的服务端校验与鉴权下载，禁止任意外部附件地址及重定向。

`feedback`、`feedback_comments`、`feedback_encounters`、`feedback_attachments`、`feedback_tasks`、`feedback_import_requests` 与 `files/feedback/` 一同备份恢复。共享 Token 仅来自进程配置，不进入这些表或日志。测试模式必须隔离运行时根目录，清除真实 Token，仅通过显式 `CAGELEDGER_E2E_GITEA_TOKEN`、`CAGELEDGER_E2E_REPOSITORY_URL` 连接模拟 Gitea。

本契约描述 React 前端与 Python 服务之间的稳定边界。后端入口位于 `server.py` 和 `server_app/web/`，前端类型位于 `src/contracts/`，请求 hooks 位于 `src/react/api/`。

## 通用约定

创建反馈可选携带 `diagnostics`，格式为 `{schemaVersion:1,capturedAt:毫秒时间戳,windowSeconds:300,events:[]}`。最多 50 条、16KiB；事件仅包含固定页面分类与 `navigation/action/error/request` 白名单字段，时间须位于摘要采集时刻之前五分钟内。原始消息、堆栈、正文、身份数据、完整网址、未知字段和未脱敏的接口路径均拒绝；服务端独立检查请求编号、枚举和数值边界。摘要作为可选内部字段保存在既有 `feedback.environment` JSON，公开环境信息及列表不包含它，详情顶层返回 `diagnostics`，旧记录返回 `null`，无 schema 迁移。未提供或为 `null` 时保持旧请求去重签名和远端正文兼容；选中时摘要参与原请求去重签名并随原工单正文同步。

客户端只在原反馈提交时发送摘要，不持续上报。缓存使用当前标签页的 `sessionStorage`，五分钟过期、最多 50 条；存储不可用时退化为内存。缓存恢复和提交均经过字段白名单，登录与退出清空。预览与提交使用同一快照，用户可取消附带或在提交前更新快照；不确定提交保持整个原请求不变，避免重试时新诊断事件改变请求签名。

| 项目      | 契约                                                           |
| --------- | -------------------------------------------------------------- |
| 基础路径  | `/api`                                                         |
| 认证      | HttpOnly Cookie Session，`SameSite=Lax`                        |
| JSON 请求 | `Content-Type: application/json`                               |
| 错误      | `{ "error": "可展示消息" }`                                    |
| 分页      | `{ items, page: { limit, offset, total, hasMore } }`           |
| 单对象    | 优先 `{ item }`，专用流程接口使用命名字段                      |
| 缓存      | API 响应 `Cache-Control: no-store`；服务端内部使用 15 秒短缓存 |
| 压缩      | 大响应和静态资源按客户端能力使用 gzip                          |
| 计时      | 响应可包含 `Server-Timing`，关键写入可包含 `perf`              |
| 权限      | `admin` 全局；`room_admin` 按授权和业务入口校验                |
| 字段命名  | 前端 JSON 使用 camelCase，SQLite 列使用 snake_case             |

`requestJson<T>()` 统一发送 Cookie、禁用浏览器缓存并将错误转换为 `ApiError`。文件上传使用 `FormData`，由专用上传函数处理。

## 会话和公开接口

| 方法   | 路径                                     | 响应                         | 权限     |
| ------ | ---------------------------------------- | ---------------------------- | -------- |
| `GET`  | `/api/health`                            | `{ ok, database, system }`   | 公开     |
| `GET`  | `/api/system/info`                       | 系统版本和构建信息           | 公开     |
| `GET`  | `/api/public/cage-card/{animalRecordId}` | `{ item: CageCardDetails }`  | 公开只读 |
| `POST` | `/api/auth/login`                        | `{ user }` + Cookie          | 公开     |
| `POST` | `/api/auth/logout`                       | `{ ok: true }` + 清除 Cookie | 公开     |
| `GET`  | `/api/auth/me`                           | `{ user }`；未登录返回 401   | 会话     |

公开笼卡响应只提供查询所需信息。经费、账号、审计和报销字段不进入公开响应。

`item` 是笼卡、到货批次、待进驻任务与占用信息的只读投影，前端通过 `usePublicCageCard` 解包后呈现。状态以返回的 `statusLabel` 为准；缺少状态不能自行推断为“待接收”。同一码再次查询或扫描时重新读取，确保接收、预留与入驻后的状态及时更新。扫码回归至少包含真实 API 创建、打印、接收、预留与入驻链路，不能只用模拟响应验证。

## Bootstrap 和设施

| 方法           | 路径                              | 关键参数                     | 响应                                 |
| -------------- | --------------------------------- | ---------------------------- | ------------------------------------ |
| `GET`          | `/api/bootstrap`                  | `scope=summary`              | 首页摘要和设施摘要                   |
| `GET`          | `/api/bootstrap`                  | `scope=room&roomId=...`      | 当前房间笼架、笼位、占用和待进驻任务 |
| `GET`          | `/api/bootstrap`                  | `scope=full`                 | 兼容全量状态                         |
| `POST`         | `/api/infrastructure`             | rooms/racks/slots 的增量集合 | 受影响基础设施对象                   |
| `GET`          | `/api/infrastructure/occupancies` | `month`、`iacuc`、`pi`       | 结算定向占用数据                     |
| `POST` / `PUT` | `/api/occupancies[/{id}]`         | `{ item }`                   | `{ item, affectedSlots? }`           |
| `DELETE`       | `/api/rooms/{id}`                 | 空                           | `{ ok: true }`                       |

`scope=room` 受房间授权过滤。结构写入后同时失效服务端 bootstrap 缓存和前端 bootstrap 查询。

## 笼卡与待进驻

批次详情及写入可选 `identifiers:{purchaseOrderNos:string[],orderNos:string[],batchNos:string[]}`，表示同一预约的编号集合，不声明任意两两对应关系或数量分摊。兼容 `purchaseOrderNo`、`orderNo`、`batchNo` 字符串以顿号投影；显式提供字符串（含空值）优先于旧集合，省略时可从集合读取。每类最多50个、每个最多200字符；跨IACUC需求分开保存。标准DC保留后缀并推导对应C，多编号不再视为冲突。列表编号候选及筛选支持单个成员，旧完整字符串筛选仍兼容；重复提醒按任意成员命中，确认后仍可保存。独立接收列表及Excel不按成员展开或重复合计动物数量。统一预约核对区分完整明确命中与仅共享编号的相关记录，不据成员交集覆盖另一预约。

`POST /api/intake-batches/recognition-preview` 的 `reviewVersion:2` 接收任意图文顺序的 `item`、可选自身 `excludeId` 和本轮 `recognitionImageRefs`，无需文字或旧原图。响应保留 `{items,total}`，增加 `outcome`（unmatched／registered／supplement／conflict／related／insufficient）、`sourceIssues` 和规范后的 `incoming`；候选提供原记录、逐字段 `comparisons`（same／different／missing／supplement／unknown）、`canAcknowledge`、`canMerge`、`mergedItem` 和确认令牌。编号索引只召回相关记录，明确需求号或完整订单号的唯一相容命中才可补充；同C不同DC不能当作同单。数量、标准品系和保守规范化规格参与比较，缺失或无法解析不是一致；本轮来源差异不会被采购优先的最终表单掩盖。原图引用须属于当前账号并通过SHA校验；未参与本轮识别的图片提示核对，暂存过期返回410及原错误码。省略 `reviewVersion` 保留旧文字补充响应和规则。

原预约已有留档图片且本轮仅有文字时，唯一相容命中的候选可返回 `mergeStrategy:"saved_image_first"`。编号、IACUC、接收用途、本轮来源或无法规范化信息仍按原规则校验；其他差异保留在 `comparisons` 中，不阻止按原预约已有值保留、文字仅补空缺和留档。此类差异返回 `outcome:supplement`、`canMerge:true`，不提供一致性确认；前端以服务端 `mergedItem` 展示合并后值。仅共享采购号、不同完整订单/需求、多候选、已接收及本轮新图的限制保持；不把图片追加到文字预约的覆盖策略扩展到此分支。

一致记录默认只读确认结束，不发写入。显式补充使用批次PUT的 `recognitionMerge:{reviewVersion:2,incoming,confirmationToken}`，携带本轮原图引用及原 `expectedUpdatedAt`；服务端在原写事务重新核对全部候选、版本和输入，仅补空缺、追加新材料，不信任客户端 `mergedItem`。原ID、笼卡及二维码、状态、接收和旧图片来源映射保留；已接收或有接收记录仅供查看，不能补充。新轮依据保存到 `recognition.recognitionRounds`，每轮独立保留 `at/rawMessage/appliedFields/imageIds/evidence`，不重绑旧顶层 `imageIds`；原件按SHA复用，改名不重复留档。普通新界面保存携带 `reviewVersion:2`，发现重复时409的原details增加完整 `review`，回到同一核对区；明确另建仍按原重复确认及审计处理。

日期列筛选保持 `filter-options` 的 `{items:[{value,label,count}]}` 与 `columnFilters` 原始值数组契约。前端年/月/日仅为显示分组，时间列的一日节点保留并提交该日所有原始时间戳，不能以截断后的日期代替精确值。日期/月候选查询返回当前范围完整候选，不使用普通文本列的500项上限；原权限、其他列筛选及排除本列条件的聚合口径不变。候选包含空白时，`intakeDate`、`month`、`updatedAt` 的数组筛选允许显式 `""`，非日期列的空值清洗规则不变。

待接收批次 POST/PUT 允许 `item.intakeDate` 为空字符串，表示日期待定；沿用原字段，不增加状态或数据库迁移。后续完整 PUT 补填日期时保留批次 ID、笼卡 ID 与二维码，自然月周期按原 `husbandryMonths` 计算，创建及编辑均写入原审计链路。列表日期筛选继续使用空字符串值，前端展示为“待定”。兼容单条分次接收接口仍要求 `actualReceiptDate`，现有批量状态标记规则不变。

`POST /api/intake/ai-parse` 保留原 `{rawMessage,roomNames}` 及 `{item,usage}` 响应。可选 `images:[{name,dataUrl}]` 支持同一预约的文字加图片或纯图片；最多4张 PNG/JPEG/WebP，单张5 MiB、合计15 MiB，校验真实格式、完整性、尺寸与静态图片后才请求 AI。图片使用独立 `DEEPSEEK_VISION_MODEL`（默认 `deepseek-flash`），共用原key与地址；原文字模型、响应和本地识别保持兼容。

图片响应另含 `recognition:{extractedText,warnings,fieldSources,sources,model}`。`sources` 按1起点 `imageIndex` 标识截图，`kind` 为 `husbandry`（饲养需求）、`purchase`（采购信息）或 `unknown`。饲养需求分离许可总量/剩余量、本批数量/雌雄及审核备注字段；采购信息单列单号、批次、商品、规格、数量及供应商。服务端先核对编号，再按来源合并，许可数量永不映射到本批数量；品系（对应商品名称）、体重/日龄（对应规格）、本批数量有差异时采用采购信息的非空值，保留双方原值并提示；采购内部多图矛盾仍需人工核对，编号冲突拒绝合并。明确笼数保留；缺少明确接收日期依据时留空，不用采购申请日期代替；项目和负责人仍由现有 IACUC 匹配回填。

图片 AI 只提取原始事实。采购来源可选 `quantityFacts:{lineQuantity,lineQuantityEvidence,giftQuantity,giftEvidence,giftInclusion,giftScope,currentDeliveryQuantity,currentDeliveryEvidence,deferredQuantity,deferredEvidence,purchaseNotes}`；缺失数字为null。`lineQuantity` 取商品行供应商、单价后的数量列，原 `source.quantity` 继续保存该列原数。`giftInclusion=extra|included|unknown|none` 分别表示额外、已含、不确定、无赠送，`giftScope=current_item|other|unknown` 标识本次商品归属。服务端仅在原文与事实支持明确额外赠送时做加法；已含或后续赠送不重复计入。本次备注合计只交叉校验，后续数量不进入本次；相同采购图片重复出现不累加。包含关系、数量或范围矛盾时主数量留空并提示核对，不能退回申请额度或AI猜测合计。已有无quantityFacts的识别记录保持原采购数量兼容。

识别依据另含可选 `quantityCalculation:{baseQuantity,giftQuantity,addedGiftQuantity,actualQuantity,formula,status,reason}`，`status=calculated|review_required`。例如27只加额外赠送3只得到30只，备注本次30只不重复加、后续47只不计入。保存时作为识别依据留档，不覆盖用户核对后编辑的主数量。动物规格由服务端本地提取年龄/体重并规范为 `6-8w`、`1-2m`、`1-2y`、`18-22g` 等；等级、赠送及饲养周期排除，来源规格原文仍保留。缺失标记“-”不参与差异比较。原文字识别响应和旧保存请求不变，不增加数据库迁移。

自然月饲养周期使用可选 `item.husbandryMonths`（1至1200的整数），来源同时保留 `husbandryMonths` 与 `husbandryPeriodRaw`；月数必须有明确饲养/周期原文，不能来自动物月龄。AI只提取事实，本地将接收日期加月数（目标日不存在时取目标月末）并计算 `endDate` 与 `husbandryDays`；缺接收日期时保留月数，其余两项留空。明确的两日期不符合该自然月结果时，保留原日期差且清除月数意图。保存接口同样计算可选月数并在原事务中审计，`husbandryMonths:null` 表示手动覆盖或清除联动；旧记录无该字段时不回填，旧客户端省略字段且日期天数未改时保留已存月数，显式改变日期/天数时尊重其输入。直接取材不使用自然月周期，无数据库迁移。 纯文字识别直接从完整 `rawMessage` 确认月数；带自然月意图时，只有原文中实际出现的接收/结束日期才参与日期核对，忽略模型自行推算的日期和固定天数。

批次 POST/PUT 可选携带 `recognitionImages:[{name,dataUrl}]`，提取依据在 `item.recognition`。图片字节不进入业务 payload 或审计，只在权限、版本、重复确认均通过后写入新文件，并随批次与来源图片审计一起提交元数据；失败清理本次新文件，不覆盖旧文件。省略识别依据的旧编辑请求保留原留档，客户端不能指定或替换存储路径，已有图片不会因普通编辑删除。相同内容和名称不重复留档。 `recognition.imageIds` 按本次图片输入顺序绑定原图 ID，`images` 同时保留历史原图；多次编辑后仍能核对每个来源的对应图片。图片识别返回 `inputImages`（名称与SHA-256）；保存按该签名绑定原图，变更后的图片不能冒充旧识别来源，缺少对应原图时明确提示。`GET /api/intake-batches/{batchId}/recognition-images/{imageId}` 要求登录、确认图片归属于该批次后返回原图，沿用批次可见范围，响应 `no-store`；批次不存在、图片不属于批次或文件暂缺返回404。新功能不增加数据库结构迁移。

| 方法     | 路径                                       | 请求或参数                                               | 响应                                    |
| -------- | ------------------------------------------ | -------------------------------------------------------- | --------------------------------------- |
| `GET`    | `/api/intake-batches`                      | `limit`、`offset`、`sortKey`、`sortDir`、`columnFilters` | 分页批次                                |
| `GET`    | `/api/intake-batches/{id}`                 | 批次 ID                                                  | 单个完整批次                            |
| `POST`   | `/api/intake-batches/print-data`           | `{ ids, expectedVersions? }`                             | 按顺序返回完整打印数据                  |
| `GET`    | `/api/intake-batches/filter-options`       | `column` + 当前筛选                                      | 筛选候选值                              |
| `GET`    | `/api/intake-batches/summary.docx`         | `startDate`、`endDate`（`YYYY-MM-DD`）                   | 接收汇总 Word 下载                      |
| `POST`   | `/api/intake-batches`                      | `{ item }`                                               | `{ item, placementTasks?, auditLogs? }` |
| `PUT`    | `/api/intake-batches/{id}`                 | `{ item, expectedUpdatedAt }`                            | `{ item, placementTasks?, auditLogs? }` |
| `DELETE` | `/api/intake-batches/{id}`                 | 空                                                       | 删除结果与受影响任务                    |
| `POST`   | `/api/intake-batches/{id}/confirm-receipt` | `{ actualReceiptDate, cardCount }`                       | 批次、接收记录、任务和审计              |
| `POST`   | `/api/intake-batches/mark-printed`         | `{ ids }`                                                | 批量标记为已打印                        |
| `POST`   | `/api/intake-batches/confirm-receipt`      | `{ ids }`                                                | 批量标记已接收，保留历史明细与任务      |
| `POST`   | `/api/quantity-sheets/print-data`          | `{ ids }`                                                | 批量读取打印所需的完整统计表            |
| `GET`    | `/api/placement-tasks`                     | 分页和状态筛选                                           | 分页任务                                |
| `POST`   | `/api/placement-tasks/{id}/reserve`        | `{ slotId }`                                             | `{ task, occupancy, affectedSlots? }`   |
| `POST`   | `/api/placement-tasks/{id}/move-in`        | `{ actualMoveInDate }`                                   | `{ task, occupancy, affectedSlots? }`   |
| `POST`   | `/api/placement-tasks/{id}/reassign-room`  | `{ roomId }`                                             | 更新任务和审计                          |

Animal Record ID 在批次生成、打印、接收、待进驻、占用和公开扫码之间保持唯一、持久和可追溯。

当前接收页面调用批量标记接口，仅将已打印批次标为已接收并记录审计，不创建分次接收明细或待进驻任务。单条兼容接口仍按实际日期和张数保存接收明细及任务。核查历史数据时区分这两种口径，不要求批量标记的批次具有分次明细，也不将未使用的历史确认／剩余计数字段直接判为接收数据丢失。

批次 `POST`／`PUT` 可选携带 `checkDuplicates: true`。新页面的保存、编辑及打印前自动保存均启用该参数；服务端在原写事务及权限、版本校验内分别比较采购单号和批次号，任一非空编号匹配即提醒。比较忽略首尾空白、字母大小写和批次号中英文括号差异，编辑排除当前ID，查询覆盖全部已保存状态，不受列表筛选与分页影响。未带该参数的旧客户端保留原保存行为，不增加唯一约束。

发现重复且未经确认时返回 `409`、`code: INTAKE_DUPLICATE_CONFIRMATION_REQUIRED` 和 `details: {items,total,confirmationToken}`，不写业务记录或审计。`items` 最多20条，含 `id`、`purchaseOrderNo`、`batchNo`、`intakeDate`、`pi`、`owner`、`status` 及 `matchedFields`；`total` 为全部匹配条数。用户确认后以同一草稿、原 `expectedUpdatedAt` 和 `duplicateConfirmation: confirmationToken` 重试。确认标识绑定草稿ID、编号、编辑排除ID及完整匹配集合；事务内重新核对，匹配记录变化时重新提醒，过期编辑仍返回原版本冲突。成功保存时在原审计之外增加 `intake_batch.duplicate_confirmed`，记录操作者、编号和全部匹配记录ID；确认审计与业务写入一起提交或回滚。

采购单号继续保留于原 `payload.purchaseOrderNo`，同时投影为 `purchase_order_no`；`purchase_order_key`、`batch_no_key` 保存规范化查询键并建立普通索引。字段创建、回填和索引纳入同一写事务，由调用方提交，失败回滚后可重试。原查询投影迁移从旧记录回填，不修改原payload、版本或审计；局部保存和旧全量状态保存均同步投影，无明确来源的历史缺失编号不推断补造。

另有一次性原文编号补填：仅在唯一完整 C13／DC15 来源与已有人工值相容时补齐空白编号，更新版本并记录前后值审计；多编号、字段冲突及明确人工清空保持原值并留档。执行标记为 `intakeIdentifierBackfillV1`，数据、查询键、版本、审计与标记在同一事务内提交，重复启动不补第二次。其余业务字段和历史审计保持原值。具体边界见[写入安全](write-safety.md#接收编号兼容)。接口响应和版本参数的可选兼容策略保持不变。

接收汇总与待接收列表沿用相同登录读取权限，按预约接收日期包含起止当天的全部批次和状态，不受分页、表头筛选或勾选限制；无预约日期的记录排除。无效日期、逆序区间或空区间返回 `400`，不生成空文档。响应为鉴权 `.docx` 附件，`Cache-Control: no-store`。汇总保留当前批次状态、原始品系和已填写的预约备注，不输出预约原文或签收等空栏；导出不写入批次、接收记录、待进驻任务或审计，不推进打印或接收状态。

## 数量统计表与结算

数量统计表全选使用 `GET /api/quantity-sheets?view=ids`，仅返回 `{items:[{id}],page}`。登录要求、跨房间可见范围、筛选、个人姓名匹配、排序与分页均和原列表一致；查询直接投影 ID，不读取明细 payload。默认及 `view=summary` 的原摘要响应保持兼容，两种投影分别缓存。全选仍分页读取，不提供无上限全量响应。

`sheet.customBillingSegments[]` 增加可选 `quantityMode: "fixed" | "all"`。`fixed` 必须填写正整数 `quantity`；`all` 保存为 `quantity: null`，区间内按每天实际结余只数或笼数核算。缺少模式的旧区间按数量推断（`null` 为全部）。全部结余区间不能与其他自定义区间重叠，固定数量区间仍校验同日合计不超过结余。结算明细保留 `customBillingQuantityMode` 与当天实际数量，打印说明据此区分固定数量和每日全部结余。

| 方法     | 路径                                           | 请求或参数                               | 响应                                                                   |
| -------- | ---------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/quantity-sheet-rooms`                    | 空                                       | `{ items }`，跨房间录入候选                                            |
| `GET`    | `/api/quantity-sheets`                         | 分页、排序、`columnFilters`              | 分页统计表                                                             |
| `GET`    | `/api/quantity-sheets/filter-options`          | `column` + 当前筛选                      | 筛选候选值                                                             |
| `GET`    | `/api/quantity-sheets/{id}`                    | 空                                       | `{ item }`                                                             |
| `GET`    | `/api/quantity-sheets/{id}/pdf`                | 空                                       | 单份数量统计表 PDF 下载                                                |
| `POST`   | `/api/quantity-sheets/pdf-export`              | `{ ids }`                                | 单份 PDF 或多份 PDF ZIP 下载                                           |
| `POST`   | `/api/quantity-sheets`                         | `{ sheet }`                              | `{ item, affectedItems? }`；服务端写入登记人员和房间管理员快照         |
| `PUT`    | `/api/quantity-sheets/{id}`                    | `{ sheet, expectedUpdatedAt }`           | `{ item, affectedItems? }`；服务端更新登记人员和房间管理员快照         |
| `DELETE` | `/api/quantity-sheets/{id}`                    | 空                                       | 删除结果、镜像变更和审计                                               |
| `GET`    | `/api/billing-settlement-candidates`           | 分页、排序、`columnFilters`              | 按月份和负责人聚合的结算候选列表                                       |
| `POST`   | `/api/quantity-sheets/{id}/generate-statement` | 结算选项                                 | statement、lines、workflow                                             |
| `POST`   | `/api/billing-statements/generate`             | month/IACUC 等筛选                       | 动态笼位图结算                                                         |
| `POST`   | `/api/billing-statements/generate-by-pi`       | `{ pi, month, sourceType, persist }`     | `{ statement, lines, workflow? }`                                      |
| `GET`    | `/api/billing-settlements/pdf`                 | `month`、`pi`、`sourceType`              | 单份项目负责人结算汇总表 PDF 下载                                      |
| `POST`   | `/api/billing-settlements/pdf-export`          | `{ items: [{ month, pi, sourceType }] }` | 单份 PDF 或多份 PDF ZIP 下载                                           |
| `POST`   | `/api/billing-monthly-summary/export`          | `{ month }`                              | 管理员或锁定授权账号下载按 IACUC 与设施汇总的月度费用 Excel            |
| `POST`   | `/api/pdf-exports`                             | `kind` + 数量统计表或结算项数组          | PDF 后台任务；缓存命中时返回 `ready`，其余返回 `queued` 或 `rendering` |
| `GET`    | `/api/pdf-export-jobs/{id}`                    | 空                                       | `{ status, completed, total, downloadUrl?, error? }`                   |
| `GET`    | `/api/pdf-export-jobs/{id}/download`           | 空                                       | 已完成后台任务的 PDF 或 ZIP 下载                                       |
| `GET`    | `/api/billing-statements[/{id}]`               | 空                                       | 当前结算单列表或单条                                                   |

数量统计表保存会同步转入转出镜像，并使受影响的单表 PDF 与按 PI 汇总 PDF 失效后后台预热。按 PI 结算自动纳入同月同负责人的全部有效 IACUC 和统计表。
PDF 用户导出优先于后台预热任务，未命中缓存的同一文档只生成一次；磁盘缓存按容量与保留时长自动淘汰。管理员可从 `/api/system/environment` 的 `performance.pdf` 查看队列、渲染延迟、失败、超时、缓存命中率和容量。
`fullExemption=true` 表示当前 IACUC 在项目有效期内按每日实际饲养量全额减免；该减免独立于 PI 普通减免额度，并保留在结算明细、PDF 和报销台账中。
月度汇总导出允许系统管理员或具有 `billingLockAllowed` 授权的账号访问，菜单、页面与 API 使用同一授权口径。饲养费汇总覆盖数量统计表来源，实时复用按 PI 合表的计费、减免和梯度规则。工作簿按 `IACUC + 设施` 分行，IACUC 索引提供经费和实验日期，结算单列显示单据跟踪登记的结算单交回状态，报销单的经费本编号、报销单编号、报销金额和报销备注仅取单据跟踪交回登记或补录且未撤回的报销单，报销金额为登记报销单金额汇总，无登记时为空，单号列填入全部报销单号；每次导出写入审计日志。

## 流程与报销台账

| 方法     | 路径                                              | 请求或参数                                                     | 响应                                                                                                                |
| -------- | ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/billing-workflows`                          | 分页、排序、`columnFilters`（月份/状态/负责人/登记人员/IACUC） | 分页流程；未指定状态时默认排除已生成（单据跟踪只展示已发起之后）                                                    |
| `GET`    | `/api/billing-workflows/{id}`                     | 空                                                             | `{ workflow, versions, events }`                                                                                    |
| `GET`    | `/api/billing-workflows/{id}/funding-options`     | 空                                                             | 关联 IACUC 最新经费本候选项、该 PI 全部已登记经费本号及其来源描述；优先独立 `fundCode`，否则从项目来源/支撑经费提取 |
| `GET`    | `/api/billing-workflows/{id}/lines`               | `versionId`                                                    | 指定版本明细                                                                                                        |
| `POST`   | `/api/billing-workflows/advance`                  | `{ workflowId, toStatus, note?, registration? }`               | workflow、event、auditLogs；`registration` 含结算单/报销单交回开关、报销单号与金额，实收金额由后端按报销单自动汇总  |
| `POST`   | `/api/billing-workflows/{id}/reimbursement-forms` | `{ reimbursementForms: [{ formNo, amount }] }`                 | 已登记或已归档流程按现有授权补录报销单，追加到现有报销单并重算实收金额                                              |
| `DELETE` | `/api/billing-workflows/{id}`                     | `{ note }`（管理员兼容空请求）                                 | 删除结果和审计                                                                                                      |
| `GET`    | `/api/reimbursement-records`                      | `status`、`month`、`pi`、`onlyUnpaid`、分页                    | 分页台账                                                                                                            |
| `GET`    | `/api/reimbursement-records/{id}`                 | 空                                                             | item、workflow、versions、events、history                                                                           |
| `PUT`    | `/api/reimbursement-records/{id}`                 | 台账可编辑字段                                                 | 更新后的完整详情                                                                                                    |
| `DELETE` | `/api/reimbursement-records/{id}`                 | 空                                                             | `{ ok: true }`                                                                                                      |
| `POST`   | `/api/reimbursement-records/import-monthly`       | Excel 文件                                                     | 导入摘要                                                                                                            |
| `POST`   | `/api/reimbursement-records/import-arrears`       | Excel 文件                                                     | 导入摘要                                                                                                            |

结算候选列表、流程列表和流程详情返回当前登录账号的 `canWithdraw`；能力字段在共享缓存之后投影，不写入流程或共享缓存。未归档单据允许实际经手人或具有 `billingLockAllowed` 授权的账号填写 `note` 后撤回；锁定授权账号不受创建人或经手人限制：已登记 → 已发起、已发起 → 已生成；已生成可经 `DELETE` 撤销；新增锁定授权不允许跨状态直接删除，已归档仍须先解锁，删除时保留已确认核销保护。经手人由各历史版本的生成、修订、发起、交回登记和报销单补录事件的账号 ID，以及来源数量统计表创建、修改和转移入账审计的账号 ID 判定；兼容已有 `sentBy`、`registeredBy` 和 `reimbursementRecordedBy`。来源优先使用版本保存的 `sourceIds/sourceId`，旧版本缺失时严格匹配账单快照中保存的月份、PI 和 IACUC 范围；不能按登记人员姓名推断。查询批量处理，审计查询使用实体／账号联合索引；无有效账号证据则拒绝。接口在同一写事务中重新校验身份及当前状态。撤回交回登记保留原发起人，撤回原因写入事件和审计，撤销原因写入删除审计；候选、流程、台账及 PDF 缓存按现有范围失效。

交回登记（`advance`、已发起 → 已登记）允许系统管理员和房间管理员操作，不限制发起人或授权房间。登记所需字段、报销金额汇总、台账同步、审计及缓存失效保持原规则。内部状态值兼容旧库：`statement_archived` 为已登记且未归档，`statement_locked` 为已锁定且已归档。页面操作称为锁定／解锁，归档状态称为已归档／未归档。锁定和解锁继续要求 `billingLockAllowed`；锁定后必须先解锁恢复未归档才能撤回。已归档响应额外返回 `unlockStatus`，页面和状态转换服务共用恢复规则：优先保存的锁定前状态，旧记录兼容交回标记，历史缺失标记时保留旧默认已登记阶段。该字段只在响应投影中生成，不写入共享缓存或旧记录。已登记／已归档补录报销单沿用原授权，补录不改变归档状态。

数据管理页面保留月报与欠缴 Excel 导入。月份支持原有分隔符、中文、紧凑 `YYYYMM`（含数值单元格）及 Excel 日期，必须是有效自然月；非法月份和非有限/非法金额以400返回工作表与单元格位置。规范千分位金额可读取；空白及 `-`、`—`、`–` 保留零值语义，舍入沿用原金额函数。候选月报缺少必需金额表头明确失败；连续空行不终止扫描。单表最多1200行（含模板占用行），欠缴月份最多到第120列；行数超限或超出列范围仍有月份时明确拒绝，不静默截断。全部输入校验通过后才取得写锁、读取并更新原台账；不改变同月同负责人的业务键、已有记录ID、已缴金额保留、状态计算与审计规则。重复导入复用原业务ID，不等同于全局请求幂等或无重复审计。

### 多对多核销台账

| 方法   | 路径                                                    | 请求或参数                        | 响应              |
| ------ | ------------------------------------------------------- | --------------------------------- | ----------------- |
| `GET`  | `/api/reimbursement-ledger/obligations`                 | 月份、费用产生负责人、IACUC、分页 | `{ items, page }` |
| `GET`  | `/api/reimbursement-ledger/obligations/{id}`            | 空                                | `{ item }`        |
| `GET`  | `/api/reimbursement-ledger/claims`                      | 单号、经费负责人、状态、分页      | `{ items, page }` |
| `GET`  | `/api/reimbursement-ledger/claims/{id}`                 | 空                                | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/claims`                      | 报销单头与经费明细                | `{ item }`        |
| `PUT`  | `/api/reimbursement-ledger/claims/{id}`                 | 报销单头与经费明细                | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/claims/{id}/attachments`     | PDF、JPEG 或 PNG 文件             | `{ item }`        |
| `GET`  | `/api/reimbursement-ledger/attachments/{id}`            | 空                                | 受鉴权附件流      |
| `POST` | `/api/reimbursement-ledger/claims/{id}/allocations`     | 经费明细、结算应收、本次金额      | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/allocations/{id}/confirm`    | 空                                | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/allocations/{id}/reverse`    | `{ reason }`                      | `{ item }`        |
| `GET`  | `/api/reimbursement-ledger/legacy-records`              | 分页                              | `{ items, page }` |
| `POST` | `/api/reimbursement-ledger/legacy-records/{id}/migrate` | 空                                | `{ item }`        |

> 当前“单据跟踪”以 `/api/billing-workflows` 为主（发起 → 交回登记 → 补录；锁定后才归档），上述多对多核销台账接口与旧报销单/核销分摊保留为兼容入口，界面已不再使用。

结算应收固化费用产生项目负责人、IACUC、结算版本和待核销金额。报销单以单号为业务键，经费明细保存经费本号、经费负责人和报销金额；同单明细使用同一位经费负责人。已确认核销同时受经费明细余额和结算应收余额约束。历史 `/api/reimbursement-records` 保持兼容和只读迁入入口。

结构化金额在8张金额表的22个金额列新增内部 `*_cents` 整数分字段；旧元字段及JSON保留，接口继续使用元。初始化幂等回填可精确表示为整分的值，不改变原金额、时间或审计；空值、非整分历史值及超出安全表示范围的值保持分字段为空，继续兼容原计算路径。SQLite触发器同步旧写入路径，并阻止分字段与元字段漂移。核销累计、余额和原子限额校验在金额可精确表示时使用整数分，兼容非整分历史值；原有输入舍入、单价精度、百分比、数量、收费、减免和结算状态规则不变。账单快照及审计JSON不因金额字段迁移重算或重写。

撤销结算流程在同一事务中处理关联应收并记录审计：无核销关联的应收移除；有草稿或已撤销核销历史的应收保留为 `void`，待核销余额归零，报销单及核销历史保留。仍有已确认核销时拒绝撤销，须先撤销核销。有效应收列表、总数和筛选选项排除 `void` 及失去来源流程／账单版本的历史记录；这些记录不能新增或确认核销，历史孤立记录不会因读取而被清理。金额调整应收仍可关联非当前的历史账单版本。前端沿用共用流程查询失效范围，同步刷新应收及报销详情。

应收列表和详情沿用读取时同步账单来源的机制。已生成账单重新生成时可以复用版本ID，因此版本ID相同仍须核对未核销应收与当前账单快照总金额；同步在写事务内重新核对来源及已确认核销，更新应收、待核销余额和状态，并记录 `reimbursement_ledger.obligation_snapshot_synced` 金额前后审计。无金额变化不重复写入或审计。草稿和已撤销核销历史保留，已确认核销的同版本应收不覆盖；新版本的调整应收规则保持不变。同步只读取账单快照，不按源表或现行收费规则重新计费。每次读取仍检查当前快照；版本和金额相同且无需回填伦理号时，跳过结果用不上的逐单核销汇总查询，不缓存或跳过来源同步。金额差异、伦理号回填和版本变化继续查询核销并沿用原事务及审计。

审计检索字段与列表裁剪契约保持不变。较大的审计原始JSON可保存在 `audit_event_payload_blocks`，原表保留摘要，完整读取使用 `repositories.audit_storage.read_payload`；不得通过直接解析 `audit_events.payload` 获取完整前后快照。小记录和旧JSON兼容，完整读取校验编码、字节数、校验和、事件ID及摘要，损坏或缺失不回退为不完整详情。新审计写入、摘要与压缩块在调用方事务内原子保存；历史压缩通过离线副本工具显式执行，并支持字节等价的旧格式还原。

数量统计表镜像关系采用可重建的 `quantity_sheet_transfer_links` 索引，正文JSON仍保持原契约。新建和编辑表在同一事务内保存关联，旧SQL写入正文由触发器标记待刷新，转移查询前刷新；删除表时清理其目标关联。查询覆盖来源表全部旧镜像，不只匹配当前剩余行；沿用现有镜像合并、数量、计费和权限规则，不增加统计表的组合唯一约束或来源删除级联。

## 数据与系统管理

升级后的首次启动在全部schema步骤完成后自动执行历史引用检查，使用同一事务中运行库的实际记录（包括已提交WAL），不新增HTTP写入口。`data_quality_scans/issues/observations` 分别保存扫描来源、独立问题标记和追加证据；引用业务ID但不级联删除业务记录，不修改原正文、二维码、金额、原审计或应收状态。自动扫描的 `trigger=upgrade`，来源指纹为 `sqlite-review-inputs-v1` 逻辑行SHA-256，覆盖见 `sourceSnapshot.tables`，不是运行中主文件的物理哈希。

`data_quality_upgrade_runs` 按 `DETECTOR_VERSION` 保存完成标记，与留档及 `data_quality.issues_archived` 审计同事务提交；失败回滚且不记录完成，下次启动重试。完成后同检查器版本的重复启动不再扫描或重复留档；即使业务数据之后变化，也不把重启作为持续监控。修改检测规则或覆盖时须提升检查器版本，新版本重新检查并追加证据，旧留档保留，不自动销项。空白新库保存完成记录而不添加业务审计；有业务数据但零问题时也记录检查摘要。历史证据读取校验SHA-256，损坏不静默视为完成。离线工具 `scripts/archive_data_quality_issues.py` 继续只写新副本，不生成升级完成标记。该登记不能替代完整核查，也不影响结算、资金状态或现有权限。

IACUC 汇总表导入仅更新可同步的业务记录：当前结算版本已发起、已登记或已归档（包括旧库已交回、已提交财务阶段）时，其关联数量统计表不被导入覆盖（包括项目字段、负责人及更新时间）。优先按版本中的 `sourceIds/sourceId` 确定关联；旧版本缺少来源 ID 时按月份、负责人及已有伦理范围兼容匹配。未发起或已撤回到已生成状态的记录沿用原同步规则。

已发起结算项的预览、打印及 PDF/Excel 导出读取当前有效版本的账单快照和完整逐日明细，不随项目主档、有效期或减免配置变化重算。PDF 缓存按结算版本隔离，异步任务使用入队时取得的账单快照；版本缺失时明确报错，不以实时数据替代。撤回后重新生成或显式修订才采用新数据；导入不会自动修订或回写历史流程。本规则不自动恢复修复前已被改动的源表。

账单明细采用兼容读写：旧 `billing_statement_version_lines.payload` JSON继续可读；有空间收益的新快照按版本保存到 `billing_statement_line_blocks`，codec为 `zlib-json-v1`，逐日行仅保存列表摘要及内部存储标记。压缩块包含原始行编号、日期和JSON文本，并校验版本、行数、长度、SHA-256及摘要一致性；API和打印读取完整还原后的明细，不返回存储标记，不调整数量、金额或未知字段。小快照及压缩收益不足的记录沿用JSON。替换行和压缩块使用同一事务／保存点，不在repository中提交调用方事务；撤销流程同时清理块数据。

初始化仅新增存储表，不自动转换历史快照。离线工具 `scripts/compact_billing_snapshots.py --database <离线副本> --output <新文件> --mode compact|expand` 只生成新副本，拒绝覆盖输入或已有输出；输入含未检查点的WAL时拒绝转换。转换前后逐版本校验原始明细、顺序和JSON文本；`--vacuum` 仅回收输出副本空间。交给不识别压缩格式的旧版程序前，须用 `--mode expand` 生成并校验旧格式副本，不能直接回退程序后读取压缩库。

账号创建、修改和删除分别记录 `user.created`、`user.updated`、`user.deleted`，与账号写入及原会话清理在同一事务提交；失败或版本冲突不留下成功审计。记录操作者、目标账号和实际变更前后公开字段；密码仅记录 `passwordChanged`，不记录密码、哈希或会话令牌。自改账号仍只允许更新联系电话，忽略的字段不计入变更。旧编辑请求仍可省略 `expectedUpdatedAt`，提供过期版本时仍返回409。成功后前端失效账号与操作日志查询；不补造历史记录，也不需要数据库结构迁移。

| 方法             | 路径                                               | 说明                                                       |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `GET` / `POST`   | `/api/users`                                       | 管理账号                                                   |
| `PUT` / `DELETE` | `/api/users/{id}`                                  | 更新或删除账号                                             |
| `POST`           | `/api/intake/standardize-strain`                   | 服务端 MGI 品系标准化，登录权限                            |
| `GET`            | `/api/iacuc-index`                                 | 完整 IACUC 索引                                            |
| `GET`            | `/api/iacuc-index/expiry`                          | 精简 IACUC 到期日索引（编码 + 到期日），列表页批量标记用   |
| `GET`            | `/api/iacuc-index/status`                          | 索引数量、时间和来源                                       |
| `POST`           | `/api/iacuc-index/upload`                          | 上传 CSV，更新快照和派生字段                               |
| `GET`            | `/api/principal-identities`                        | PI 身份和减免配置                                          |
| `PUT`            | `/api/principal-identities/{name}`                 | 更新 PI 配置                                               |
| `GET`            | `/api/audit-events`                                | 分页操作日志                                               |
| `GET`            | `/api/system/update-check`                         | Gitea 最新 Release，管理员权限                             |
| `GET`            | `/api/system/environment`                          | 兼容运行环境参数与当前进程性能快照，管理员权限             |
| `GET`            | `/api/system/performance-history`                  | `hours` 内的性能汇总（管理员权限）                         |
| `GET`            | `/api/release-announcements`                       | 当前账号全部已确认版本，返回 `{ acknowledgedVersions }`    |
| `POST`           | `/api/release-announcements/acknowledge`           | `{ versions: string[] }`，原子批量确认并返回全部已确认版本 |
| `GET`            | `/api/release-announcements/{version}`             | 当前账号是否已确认指定版本的更新说明                       |
| `POST`           | `/api/release-announcements/{version}/acknowledge` | 确认当前账号已阅读指定版本的更新说明                       |

更新提示按账号在服务端保存确认记录，旧单版本接口继续兼容。批量接口仅接受当前会话账号，`versions` 为 1～500 项的数组，每项沿用版本字符串格式限制；重复确认幂等，非法请求不产生部分确认。前端按数字版本排序，展示上次确认版本之后、当前版本以内的更新；没有可用确认基线时仅展示当前版本。一次确认只提交当时弹窗展示的版本，成功后关闭；失败保留内容供重试。读取进度不会因服务版本回退而倒退。

`/api/system/environment.performance` 返回当前服务进程自启动以来的低开销诊断数据：运行时长、HTTP 请求总数/慢请求/最近 512 个样本的 P50/P95/最大耗时、缓存容量/命中/未命中/过期/淘汰/命中率，以及 SQLite 操作/慢操作/锁错误和延迟摘要。指标随进程重启清零，不是 SLA；页面不得向非管理员请求或展示这些字段，也不得用高频自动轮询放大请求统计。

可选 `stages` 为固定处理阶段的累计次数、行数、字节数及最多512个延迟样本摘要，取数/解码与原生SQLite execute分开计时；可选 `documentWork` 返回共享文档执行名额、运行/等待数和繁忙拒绝累计数。两者也随性能历史保存运维摘要，不包含业务内容或请求参数，旧记录缺省兼容；阶段P95不相加。配置与计时范围见[共享性能约定](shared-performance.md)。

服务启动后和此后每 5 分钟，服务将聚合快照写入 `system_performance_snapshots`。快照只含计数增量、延迟摘要、缓存命中率、PDF 活动任务和数据库容量，不含用户、请求参数或 SQL 文本；默认保留 1,095 天。采样使用独立短事务，遇到锁冲突或其他失败会跳过当期而不影响业务请求。`/api/system/performance-history` 返回裁剪后的趋势字段，供管理员比较版本升级、重启和优化前后的变化。

## 动物巡检与目录

| 方法   | 路径                                                        | 请求或参数                                               | 响应                                                                                                  | 权限     |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| `GET`  | `/api/animal-inspection-catalog`                            | 空                                                       | `{ version, modules, nodes, reviewNotice }`                                                           | 登录可见 |
| `GET`  | `/api/animal-inspection-catalog/draft`                      | 空                                                       | `{ version, modules, nodes, hasDraft, active }`；无草稿时克隆 active；`active` 为未转换的生效目录基线 | `admin`  |
| `PUT`  | `/api/animal-inspection-catalog/draft`                      | `{ modules, nodes, expectedUpdatedAt }`                  | 保存后的 `{ version, modules, nodes, hasDraft }`；非法 400、过期 409                                  | `admin`  |
| `POST` | `/api/animal-inspection-catalog/draft/publish`              | 空                                                       | 新 active 的 `{ version, modules, nodes }`；旧 active 转 history                                      | `admin`  |
| `POST` | `/api/animal-inspection-catalog/images`                     | `multipart/form-data`，字段 `file`（jpg/png/webp，≤5MB） | `{ ok, filename, url }`                                                                               | `admin`  |
| `GET`  | `/api/animal-inspection-reference/{filename}`               | 空                                                       | 图片二进制；data 目录优先，resources 回退                                                             | 登录可见 |
| `GET`  | `/api/animal-inspection-catalog/versions`                   | 空                                                       | `{ items: [{ version, source, status, importedAt, nodeCount, isActive }] }`                           | `admin`  |
| `POST` | `/api/animal-inspection-catalog/versions/{version}/restore` | 空                                                       | 新 active 的目录 payload；回滚源内容发布为新版本，旧 active 转 history                                | `admin`  |

目录草稿契约与 `GET /api/animal-inspection-catalog` 的 `modules`/`nodes` 结构一致；草稿节点可引用现有分类/子分类的 `id` 或 `code` 作为 `parentId`。发布后版本号为 `manual-YYYYMMDD-HHMM`，历史版本保留在 `inspection_catalog_versions`，答案快照语义不受影响。

## Typed API 规则

- 共享类型写入 `src/contracts/<domain>.ts`，`src/react/api/contracts.ts` 仅保留兼容 re-export。
- endpoint hooks 按业务域拆在 `bootstrap.ts`、`intake.ts`、`cages.ts`、`quantitySheets.ts`、`workflows.ts`、`administration.ts`。
- API 契约变更同步更新类型、Query key、缓存失效、服务端测试和浏览器回归。
- 权限、迁移和写入接口按 `testing-strategy.md` 的 API 与双角色路径验证。
- 查询键写入 `queryKeys.ts`。
- 页面组件使用 hooks，文件上传使用 `uploadFile()`。
- 新响应优先消除 `Record<string, unknown>`，为稳定字段定义接口。
- mutation 成功后，完整响应在会话核对及取消旧读取后回写目标详情，并精准失效实际依赖；部分响应由唯一owner完成读取，避免hook和组件重复刷新。具体见[共享性能约定](shared-performance.md)。

## 兼容与变更规则

- 新字段保持可选，旧库启动迁移完成回填后再提升为必填。
- 删除或重命名字段需要数据库迁移、payload 兼容和前端契约同步方案。
- 列表新增筛选字段需要结构化列、索引、稳定排序和 Query key 参数。
- 权限变化同时更新后端校验、前端可见性、API 文档和浏览器测试。
- 接口变化同步更新本文件与 `wiki/API与数据模型.md`。

## 验证

```bash
npm run check
npm run smoke:api
npm run test:e2e
```

涉及性能的列表和写入再运行 `npm run benchmark`，并检查 `Server-Timing`、`[perf]` 日志和 SQLite 查询计划。涉及缓存、索引、SQLite 查询、PDF 渲染、批量操作或首屏加载时，还要用相同时间窗口的 `/api/system/performance-history` 对比改动前后，记录版本、HTTP/SQLite P95、慢请求、锁错误和结论；该记录只供管理员趋势与验收使用。

## 检疫管理

`/api/quarantine/` 下所有接口要求登录；第一版全部登录角色可读写，权限集中在检疫领域。批次来源取到货记录快照，检测保存混样及项目判定，不建立单笼采样关联。

`GET batches` 支持可选 `method=parasite|pcr|elisa|elisa_mouse|elisa_rat`，在分页前筛选已有对应检测记录的批次；`elisa` 包含小鼠和大鼠。省略该参数返回全部批次，供批次管理及新建检测选择使用。另支持 `state=open|completed`，返回批次的 `recordCount`、`issuedCount` 和 `methods` 只读汇总。

`GET records` 与 `GET reports` 分别提供检测记录及已出具报告台账，支持 `method`、`state`、`search`、`dateFrom/dateTo`、`limit/offset`，返回分页与当前筛选的 `summary`。日期以检测日期为准，筛选在分页前执行，按更新时间降序及 id 稳定排序；报告保留各版本，不暴露 snapshot 或 storageName。`GET batches/{id}/activity` 返回该批次及其检测、附件、报告的审计摘要分页，仅包含动作、操作人、时间，沿用现有检疫读取权限。已移除附件的下载与预览返回 404。

| 方法       | 相对路径                                      | 行为                                                    |
| ---------- | --------------------------------------------- | ------------------------------------------------------- |
| GET        | `catalog`、`supplier-options`、`batch-number` | 项目配置、供应商候选与 `BYYMMDDNN` 建议批次编号         |
| GET        | `sources`、`batches`                          | 分页来源与检疫批次，支持日期或批次编号筛选              |
| POST / PUT | `batches[/{id}]`、`tests[/{id}]`              | 创建或编辑，正文 `{ item, expectedUpdatedAt }`          |
| DELETE     | `batches/{id}`                                | 删除无检测记录的批次，正文 `{ expectedUpdatedAt }`      |
| GET        | `batches/{id}`                                | 覆盖范围、检测、附件与历史报告版本                      |
| GET        | `tests/{id}`                                  | 单条完整检测及其附件、报告目录                          |
| GET        | `batches/{id}/summary`                        | `kind=quarantine` 或 `self`，下载历史版式批次汇总 PDF   |
| POST       | `tests/{id}/attachments`                      | multipart字段file；查询参数传关联样本、项目、分类及版本 |
| GET        | `attachments/{id}`、`reports/{id}`            | 受鉴权下载；报告统一返回 PDF，历史 Word 在下载时转换    |
| GET        | `tests/{id}/preview`                          | 带草稿标识的 PDF 预览                                   |
| POST       | `tests/{id}/issue`                            | 传检测和批次版本；成功生成 PDF 后保存不可变快照         |
| POST       | `tests/{id}/correction`、`tests/{id}/retest`  | 新草稿ID及版本；复检另传供应商                          |
| GET        | `suppliers`                                   | 供应商、日期范围／类型、种类、方法、结果过滤，含明细    |

编辑必须提供 `expectedUpdatedAt`，缺失或过期返回409；出具另传 `expectedBatchUpdatedAt`。出具重试返回已有报告，生成失败保留草稿。更正新建检测记录并关联原版本；既有 Word 报告保留原件并在下载时转换为 PDF。PDF 渲染不可用、超时或转换结果无效返回503，文件读写失败返回500。事务记录操作者与审计快照。`quarantine_batches/tests/attachments/reports` 与 `files/quarantine/` 共同组成检疫备份范围。

`GET batches/{id}?view=overview` 返回 `{item,tests,reports,completionReasons}`：批次及完成条件保持完整，检测摘要省略 `samples/projects`，报告目录包含 `method`，省略冻结 `snapshot` 和存储文件名。单条 `GET tests/{id}` 返回 `{item,attachments,reports}`，只包含该检测；附件与报告目录均不暴露存储文件名。旧完整批次接口保留。页面按需加载单检测，确认整批完成仍携带全部检测的版本。

正式出具先读取一致快照，在数据库事务外完成转换和暂存文件，再在短写事务中复核检测、批次、附件及候选编号，原子提交报告、状态和审计。生成期间变化返回409，编号只在最终提交时消费；相同检测的并发重复出具返回已提交报告。失败仅清理本次且确定未被提交引用的文件，提交结果不明确时保留已引用原件。

草稿、汇总和历史Word转换按完整内容、标题／草稿类型、模板、文件引用和转换环境复用，合并相同转换请求；缓存有容量和回收期限限制，不代替每次鉴权及当前来源读取。新出具PDF继续直接下载不可变原件。供应商历史按完整来源内容复用聚合，分页参数不参与聚合身份；事务内未提交数据不读写共享缓存，Unicode供应商匹配、更正和范围外复检的统计口径保持。

检疫批次编号首次保存后冻结，流水号一经分配不再回收。正式报告按 `{批次编号}{M|E|P}{YYMMDD}{NN}` 编号；ELISA 大小鼠共用 `E` 序列，更正版本沿用报告编号并递增独立版本号。报告下载文件名为 `{检测类型}_{实验日期}_{批次号}_{报告编号}_v{版本}.pdf`，草稿以 `草稿` 替代报告编号和版本；ELISA 文件名区分小鼠和大鼠。

检疫来源 `sources` 可选 `view=summary`，复用到货列表投影并保留生成来源快照所需的 `notes`；不指定时仍返回完整旧结构。检疫来源 `sources` 仅返回 `received` 到货记录，默认排除已归入检疫批次的动物；`state=all` 返回所有已接收记录及 `quarantineStatus`、`quarantineBatches`。接收列表也返回这两个只读衍生字段，不改变原接收状态或写入原到货 payload。

`POST batches/{id}/complete` 接收 `{ expectedUpdatedAt, expectedTestVersions: { [testId]: updatedAt } }`，校验三类正式报告、适用动物种类、异常复检和批次结论，在单事务保存完成时间、确认人、报告关联及审计。重复确认返回已完成记录；并发变化返回409。更正或复检会重新打开该批次，历史完成快照保留。

`GET batches/{id}/summary` 的 `kind` 默认为 `quarantine`；`self` 仅改变报告标题，不筛除批次来源，其他值返回400。已出具记录读取最新报告的冻结检测快照，更正替代原记录，复检独立列出；含未出具记录时标为汇总草稿，没有检测记录时返回400。结果按阳性实验组数／已检测实验组数统计，混样不折算动物数，可疑、未检测和未填写分别说明。下载沿用登录校验及 PDF 转换错误语义，不推进状态、不创建正式报告编号、不替换已有报告。

### 检疫报告表单 v2

检测写入 `reportFormVersion: 2` 后，服务端对每组 `sourceIds` 去重，固定 `poolCount = 1`、`portionCount = sourceIds.length`；`reportMaterial` 与 `reportSpecimenState` 保存报告首节信息。新记录出具不要求额外 `conclusion`，批次完成结论校验不变。

附件上传接受 JSON 字符串 `projectIds`；`PUT /api/quarantine/attachments/{id}` 使用检测记录的 `expectedUpdatedAt` 校验，可修改多个项目关联、图注、顺序和草稿移除标记。返回附件与检测记录的新版本。保留首次 `uploadedBy`、`uploadedAt`，后续修改单独审计。正式版本附件不可修改，更正草稿复制关联，旧文件和报告快照保留。

## 后端安全与资源边界

保持既有方法、分页、DTO、权限、账单与审计语义。静态GET／HEAD只通过公开资源解析器，不再回退到源目录文件或目录列表；HEAD不执行API GET中的兼容同步副作用。下载文件名统一清除控制字符并保留RFC5987中文名称，编码头有界。

HTTP默认最多32个连接处理线程，过载在业务执行前返回503及Retry-After。PDF导出默认最多32个在途任务，预热预留用户容量，饱和时明确失败且不创建不可追踪任务；成功业务写入后的可选预热失败只记录安全日志，不改变已提交结果。PDF任务状态与所有者授权保持原结构；缓存失效会退役原任务，不能让旧任务ID下载重新生成的不同文件。

数据库共享缓存保留原TTL、空值和512项上限，按对象估算的64MiB总容量／16MiB单项上限保持。写事务不命中或发布共享缓存；加载前捕获世代，相关精确键/前缀失效后旧请求不能回填，无关写入不丢弃填充，超过有界历史窗口则保守拒绝。成功提交后再清相关视图，防止提交前读取的旧值残留。只读miss按精确键合并，热命中不等待；持有SQLite写事务时不等待重建锁。

登录会话与登录审计在同一事务提交，原create_session默认提交的调用保持兼容。报销附件上传数量／查重与元数据在写锁中检查，失败只清本次且确认未被提交引用的文件；提交不确定时保留。删除报销单先提交数据库与审计，再清其专属附件目录；异常旧ID或越界链接不触及根目录、流程附件或外部文件。

Excel业务文本显式写字符串，用户输入的等号不变成公式；系统生成的SUM、差值公式和金额类型不变。AI请求不转发重定向授权头，响应与错误体上限4MiB，错误不返回凭据、配置URL或内部路径。图像只用业务允许的格式解码，Pillow安全升级保留TIFF原图与原PNG预览的数值含义。

## 待接收批次编号派生查询

`GET /api/intake-batches?view=summary` 新增只读 `batchNumberInfo`：`status` 为 `parsed`、`unparseable`、`missing`，以及可空的 `iacuc`、`approvalDate`、`sequence`。来源是完整 `batchNo`，序号为保留前导零的字符串；审批日期不是接收日期。详情和默认完整列表维持原 payload，编辑客户端不得用摘要覆盖详情。

`columnFilters` 新增 `batchNumberSearch`（规范化括号和大小写后的字面子串）、`batchNumberIacuc`（编号内伦理号）、`batchApprovalDate`（YYYY-MM-DD 精确日期）、`batchSequence`（数字序号，忽略前导零）。同键多值为 OR，键间为 AND，过滤在计数和 SQL 分页之前执行。既有 `iacuc` 顶层参数仍查询业务 IACUC；既有 `batchNo` 列筛选仍按完整比较键精确匹配。查询键和全选分页复用原 `columnFilters`，不得只过滤客户端候选。

解析使用连接内纯 SQLite 函数，完整编号及 payload 不改写，无 DDL、回填、唯一约束或版本更新。序号长度不固定，不推断累计次数；日历校验失败时不部分猜测结构。新增查询可能扫描批次标量列，不能宣称使用了派生字段索引。
