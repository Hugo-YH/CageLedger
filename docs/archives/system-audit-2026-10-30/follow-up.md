# 系统审计收尾复核

本轮仅补证据与文档，未再修改业务实现、依赖锁、运行环境或安全配置。原实现仍为 `bc25eb4`；此前报告提交为 `5402a80`。没有push、合并main、标签、容器上传或部署。

## 基线与成果归属

Git对象确认 `c06ac0248c27222bc210075c987c09c663e364ce`（Release v1.21.2）的唯一直接父提交是 `63b38f8dfa2ab6f5bef8339dc4d04fae4dee18bc`。发布提交时间为2026-10-30 21:09:24（UTC+8），仅改5个版本/发布说明文件：package.json、version.ts、releaseNotesDocs.ts、releaseNotesVersions.ts、wiki更新日志。没有本轮业务优化。

本地reflog显示原main于21:11:45快进至c06ac02；beta于23:31:31从缓存origin/beta快进至同一提交；本轮首个实现91d5dcf于23:59:52生成。任务进度15:30 UTC起与此一致。因此c06ac02属于任务开始基线，六个实现提交才是本轮成果。该本地证据不能识别外部发布操作者，也不是实时远端状态；没有为核查执行fetch/pull/push。

## 审计矩阵证据抽核

| 领域            | 可定位的代码/证据                                                                                                                                                                           | 尚未证明的范围                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| API/后端        | reimbursement importer/application与test_reimbursement_import_validation；animal_management inspection_repository/service及test_animal_inspection；check:api、权限/稳定排序和失败零写入回归 | 没有枚举证明所有接口统一幂等或完全相同错误结构；未做生产负载      |
| 前端性能        | App/ReactWorkspace/ReleaseAnnouncementGate的lazy、VirtualRack的useVirtualizer；final-bundle-comparison同口径产物；巡检查询30次合成测量                                                      | 所有路由JS字节上升不能称首屏改善；未测生产网络首屏或各端点真实P95 |
| 布局/UI/UX/动画 | UI证据列出的几何、空/错/加载、慢请求、草稿/焦点、动效中断用例；七份有效报告及目录ID核对                                                                                                     | 没有实体设备或全站人工穷举，没有整体WCAG认证                      |
| 数据库/备份     | database_review/restore_drill及对应Python测试；53张非SQLite内部表原列/原行、金额/ID/审计、原100文件指纹                                                                                     | 不含视图语义证明；恢复缺4引用仍failed；远端附件/生产切换未证      |
| 工程/依赖       | Python入口反例、输入指纹、npm11干净安装、全部声明门禁、下列离线审计                                                                                                                         | 依赖范围未来解析、原生库/解释器、双架构容器仍未证                 |
| 开发文档        | CONTRIBUTING、导入/备份/前端状态等契约、此前8份归档/索引的格式、lint、29个相对链接与diff                                                                                                    | 不是发布记录，没有同步wiki或生成新版本说明                        |

这是对本批实际证据的复核，不是额外完整测试运行；没有将未发现问题写成全域无风险。详情见 [验收报告](acceptance.md) 与 [UI证据](ui-evidence.md)。

## Python依赖：公开整库下载、本地比对

按[OSV官方批量下载说明](https://google.github.io/osv.dev/data/)取得公开PyPI漏洞ZIP（37,559,071字节、26,755条JSON，Last-Modified为2026-10-30 18:33:07 UTC），在19:08 UTC对当前共享Python3.13.16环境的24个安装分发进行离线比对。请求只下载公共数据库，不发送依赖清单、业务数据或凭据。下载内容不作为代码执行；ZIP CRC通过，私有记录保留SHA与下载头。

私有脚本使用现有pip内置packaging的PEP 440版本比较，处理ECOSYSTEM的introduced/fixed/last_affected/limit和显式versions，并按同包ID/alias去重；9个匹配边界断言和独立代码复核通过。393条相关affected记录中5条withdrawn被排除；未遇到本脚本定义的无版本信息或解析错误。额外GIT区间未独立匹配，不把unknown=0解读为全部漏洞来源覆盖。`pip check`通过，没有安装或升级软件。

当前平台、已安装元数据和默认extra下，requirements运行根4包的依赖闭包9包、开发根ruff/pypdf闭包2包均未匹配该公开快照已知条目。这个结果不是锁定未来解析、动态导入、其他extra、部署环境或安全认证；脚本本身不检查缺失依赖，pip check另行补查当前安装一致性。CPython解释器、系统/原生库、浏览器二进制不在本次审计范围。

全环境另外发现以下6组（3个包）匹配，不能统称“Python无漏洞”：

| 已安装包       | 已知条目与级别                                                                 | 触发前提                                                                   | 公告修复版/处置                                                                           |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Brotli1.2.0    | [CVE-2026-111497](https://github.com/advisories/GHSA-9v8h-qqgm-4m35)，critical | 向易受影响解码器提供恶意压缩流                                             | PyPI分支1.2.1；本项目默认闭包外，源码未见调用；共享环境维护时优先处理，未擅自更新共享venv |
| pip26.1.2      | [CVE-2026-13346](https://github.com/advisories/GHSA-qwm4-qh6w-59xr)，moderate  | 从恶意索引下载/安装双重编码URL的包；不是任意恶意包本身即可触发             | 26.2.0（26.2等价）；pip属于项目安装工具，安装阶段风险单列，容器pip版本未测                |
| WeasyPrint66.0 | [CVE-2025-68616](https://github.com/advisories/GHSA-983w-rhvv-gwmv)，high      | 使用该渲染器处理可控资源/重定向，绕过请求保护                              | 68.0修该项；项目默认闭包外，源码未见调用                                                  |
| WeasyPrint66.0 | [CVE-2026-49452](https://github.com/advisories/GHSA-jhhc-3hcp-qhm5)，moderate  | 不可信HTML且开启presentational_hints                                       | 此快照无fixed，不能声称没有任何修复；未运行该载荷                                         |
| WeasyPrint66.0 | [CVE-2026-55073](https://github.com/advisories/GHSA-jf6q-chmf-3h3v)，moderate  | 使用该渲染器抓取不可信文档资源                                             | 70.0修该项；未更换项目PDF引擎                                                             |
| WeasyPrint66.0 | [CVE-2026-106443](https://github.com/advisories/GHSA-r543-q48m-4c9j)，high     | 不可信EPS/PS图片进入渲染器、存在Ghostscript；完整RCE还依赖易受影响的解释器 | 70.0修该项；未执行载荷或探测生产                                                          |

Brotli、WeasyPrint在原main共享venv中额外安装，Required-by为空，requirements/Dockerfile无其直接声明，源码搜索未发现引用。不能证明其他软件从未使用或从未经动态导入，也不能推断生产环境一样。建议后续按环境归属升级/清理或重建最小依赖venv，并复验其所有使用者；本轮未变更共享环境，避免影响其他任务。

版本记录精确化：Node Playwright为1.61.1，Python共享venv的Playwright为1.61.0；Python PDF路径使用后者。此前报告中的单一Playwright1.61.1应按此区分；已有实测结果保持原口径，不因文档更正重复运行。

## npm剩余10个告警节点

下表使用最终锁文件及本轮已保存的完整npm审计结果，不混用中间22节点报告。high3/moderate2/low5中包含父链传播，不是10个独立漏洞；本次没有新的兼容范围内可安全替换节点。已修的开发补丁仍保留，生产依赖209节点不变。

| 包及版本                       | 级别/关系/环境    | 可利用前提及实际边界                                                                                                                                             | 修复版本及暂缓原因                                                                                                                                                                                                          |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| markdownlint-cli2 0.22.1       | high，直接dev     | 从smol-toml/数学解析链传播；CLI可读TOML配置，仓库当前为JSONC，不等于不可能处理不可信配置                                                                         | 审计建议0.24.0，超直接^0.22.1范围；需独立CLI迁移与规则验证                                                                                                                                                                  |
| smol-toml 1.6.1                | high，传递dev     | 解析恶意/巨大TOML可挂起；不是浏览器运行时端点                                                                                                                    | 无限循环[修1.7.1](https://github.com/advisories/GHSA-7w5x-hrqm-74c2)，二次复杂度[修1.9.0](https://github.com/advisories/GHSA-r4xh-jqrq-34v2)；父包精确钉1.6.1，未强制override                                               |
| Vite 5.4.21（VitePress内）     | high，传递dev     | 包括Windows编辑器入口的组合命令注入，以及可达dev服务的路径/源码边界；各条前提不同，Mac不满足仅Windows条目，不等于其余风险消失                                    | 新条目[Vite修6.4.4/7.3.7/8.1.6等](https://github.com/advisories/GHSA-587h-7wmj-h5pm)，[非Windows路径修版相同](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)；超VitePress的^5.4.14。根应用Vite已8.1.6，与该嵌套节点不同 |
| VitePress 1.6.4                | moderate，直接dev | 由旧Vite链传播；docs:dev会运行它，构建后静态文档并不运行dev服务                                                                                                  | 审计无当前父范围可用修复；主线迁移需插件/SSR/搜索/文档验证，不拿根Vite override替代                                                                                                                                         |
| esbuild 0.21.5（VitePress内）  | moderate，传递dev | [内置serve开启且开发者访问恶意站点](https://github.com/advisories/GHSA-67mh-4wv8-2f99)时可跨源读取；没有据此证明项目实际使用其serve或已经泄露                    | 0.25.0；超嵌套Vite声明^0.21.3，需随父链迁移                                                                                                                                                                                 |
| antd-mobile 5.42.3             | low，直接runtime  | 由deepmerge传播；生产组件不能因依赖标注低危而忽略                                                                                                                | 审计建议降至5.34.0，会改变现有组件基线且非修复库本身；未自动降级                                                                                                                                                            |
| deepmerge 4.3.1                | low，传递runtime  | [合并攻击者可控对象可污染返回对象原型](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)；库Form用于合并locale/validateMessages，未证明这些配置可被攻击者控制   | 公告无patched版本；父范围^4.3.1内无已知可用修复，不盲升或换表单                                                                                                                                                             |
| KaTeX 0.16.47                  | low，传递dev      | [已有原型污染/可控原型＋恶意表达式＋未独立清理后插入网页](https://github.com/advisories/GHSA-238p-pmpm-9mq7)；当前链为Markdownlint解析，未证明应用运行时渲染入口 | 0.18.2；超父包^0.16.0                                                                                                                                                                                                       |
| micromark-extension-math 3.1.0 | low，传递dev      | KaTeX父链传播；不单独计新漏洞                                                                                                                                    | 随markdownlint-cli2 0.24.0链升级；当前父包精确版本3.1.0，未override内部实现                                                                                                                                                 |
| markdownlint 0.40.0            | low，传递dev      | 数学扩展父链传播                                                                                                                                                 | 随CLI链升级；CLI精确钉0.40.0，需规则/输出兼容验证                                                                                                                                                                           |

这里只核读公告与本地调用点，没有运行漏洞利用、外部扫描或生产测试，也没有把所有传递告警判为可从线上直接利用。

## 恢复缺件：源中已缺、非本轮复制或路径误报

在获准的源附件树、source-copy、bundle、restored四份树中，均有92文件/5目录；逐文件大小、SHA-256及目录集合与演练清单一致。原数据库只读提取的4个引用与报告一致：两份反馈PNG、检疫TIFF原件及声明的PNG预览，均为有效本地引用。

核查URL解码、大小写、Unicode、目录前缀和跨目录同名未找到候选；三项有已知大小且全树无同大小文件，检疫原件已知哈希也无匹配；预览没有已存大小/哈希，因此不能靠内容指纹排除它曾被改名。路径映射与实际下载实现一致。

可确认提供的源拷贝本来不包含这4项，未发现本轮复制或路径解析导致的缺件；不能据此判断生产、NAS或其他备份是否有文件，也不能判断历史丢失时间。恢复继续failed，未改数据库引用、生成占位、改门禁或连接远端补件。

用户补齐所需的类别和准确相对路径已写仓库外私有 `restore-missing-paths-private.txt`；核实细节在 `restore-missing-path-private.json`。文件权限0600、私有目录0700；主报告不写业务文件名或身份。需提供与该数据库同批的完整附件，再对新隔离副本重做恢复。

## Vite待批准动作的具体边界

拟修改的是工程根 `vite.config.ts` 的 **server.fs.deny**：保留SDK当前6组默认规则（.env、.env.*、证书/密钥扩展、.npmrc、.yarnrc.yml、.git），仅追加由import.meta.url定位并normalizePath的 `<工程绝对路径>/data/**` 递归拒绝项。

目的为拒绝该工程data目录中的SQLite/WAL、附件及运行数据经Vite静态/源码raw路径读取；已测合成 `/data/database/synthetic-boundary.sqlite` 及同路径`?raw`由200变403，正常src对照仍200。规则是解析后文件路径匹配，不是改API鉴权。没有把未测的其他编码/别名路线宣称已验证。

不使用通用`**/data/**`，避免大小写不敏感时误伤名为Data的父卷。拟议范围不改server.host、port、allowedHosts、proxy、API或Python生产静态逻辑。兼容风险是依赖直接从工程data读取的开发页面会被403；现有业务/API应继续从代理读取，批准后需核实际调用并回归正常src、API、文档和默认敏感文件保护，未来Vite升级也需复核默认deny是否变化。

当前已知配置host0.0.0.0、5173、allowedHosts含既有域名；先前只读时已知main预览为回环5803/5903，未见5173。没有外网、隧道或代理探测；没有真实文件请求及完整日志取证。**仍仅有自有合成复现，无真实泄露或主动利用证据。** 私有候选未应用，等待用户明确授权，可在晨间报告再询问。

## 双架构容器：没有启动，访问被拒绝

只读 `docker version` 可见客户端29.8.2，但访问Colima的default/docker.sock返回permission denied；`docker buildx ls`各构建器为error。目标是本机Colima Unix socket，结果为访问被拒，不能证明宿主daemon未运行。没有重试绕过、修改权限/连接/上下文或启动build。

现有prewarm脚本只构建frontend-deps及两架构runtime-deps缓存；正式发布脚本含各架构push及manifest上传，不能直接用于本轮仅本地验证。复建需可用daemon/Buildx、arm64/amd64执行或仿真、基础镜像和依赖网络/缓存，runtime还安装Chromium、LibreOffice和字体。当前没有足够依据估算耗时、磁盘及内存峰值；且此前浏览器并行swap已升高，未为形式启动长跑。

因此双架构安装、容器pip版本及原生组件仍列未测。未来获准恢复本地Docker访问后，应设计不push、不加载生产配置的隔离target验证，而非调用发布脚本。

## 收尾变更与证据

本次只有报告补充和版本记录更正；源码/锁/实际安全配置不变，已有752/972及浏览器结果按原输入复用，不称为重跑。新私有证据含 `python-osv-audit-private.json`、`audit_python_osv_local.py`、OSV公开快照、`baseline-follow-up-private.json`、缺件清单；均在仓库之外。

报告变更另做文档格式、lint、相对链接、隐私模式与diff检查，再单独本地签名提交。没有推送或发布；完整恢复、待授权Vite及环境/工具链风险仍保留。

[最终验收](acceptance.md) · [进度](progress.md) · [UI证据](ui-evidence.md)
