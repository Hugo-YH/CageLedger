# Vite工程数据目录防护验收

2026-10-30 22:16:42 UTC用户明确同意此前候选防护。本次仅应用已批准的Vite数据目录规则、对应回归和文档；未调整其他安全配置、共享Python环境、Colima权限或依赖版本。开始于beta `017cfd5`，原实现提交 `bc25eb4` 的其他代码不变；本次单独本地签名提交，不push、合并main、tag或发布。

## 具体配置

`vite.config.ts`仅新增server.fs.deny：保留Vite8.1.6 SDK当前6组默认模式（.env、.env.*、证书/密钥扩展、.npmrc、.yarnrc.yml、.git），追加由配置import.meta.url定位、fileURLToPath及normalizePath生成的`<当前工程绝对路径>/data/**`。

SDK未公开默认配置对象，因此没有导入内部模块；回归通过resolveConfig取得实际SDK默认列表，要求工程列表恰为默认项加一个data规则，未来升级新增默认保护时会产生失败提示，避免静默遗漏。没有使用泛化的`**/data/**`，Data卷下其他文件保持可读。host、port、strictPort、allowedHosts、代理、build和test配置均未改。

这是开发静态/raw读取边界，不是API权限或Python生产路由变更。运行库、附件和业务数据仍从现有API读取。

## 合成HTTP回归

持久入口：`tests/test_vite_data_boundary.py`调用`tests/fixtures/vite-data-boundary.mjs`。仅在新临时目录复制实际配置，使用当前依赖；父目录包含Data、项目目录包含空格，私有mock上游与Vite均绑定随机回环端口。夹具结束关闭服务并删除自有临时树，绝不在真实工程data下创建或请求文件。

| 检查           | 结果                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| SDK默认保护    | 实际工程和合成服务的deny都严格等于SDK默认6项＋各自工程data绝对规则                                           |
| 16个合成文件   | 4个data内数据库/WAL/嵌套附件/运行JSON；12个默认敏感文件样本（环境文件、npm/yarn配置、git及7种证书/密钥扩展） |
| 直接/raw/@fs   | 每文件4种静态、raw、绝对fs变体，共64次；均403，响应无合成秘密marker                                          |
| 编码与路径变体 | 编码data段、import&raw、重复斜线、点段规范化后共4次；均403且无marker                                         |
| 正常资源       | HTML、TypeScript模块、public文件及正常模块@fs共4项200，内容匹配                                              |
| 代理           | 合成API POST保留method/body/query；docs GET保留path/query；2项正常，只有这2请求到达mock上游                  |

上述共68个受保护请求均403。原候选前的合成直接/raw请求200证据保留，未通过请求真实文件复现。默认沙箱最初拒绝本机listen（EPERM），经标准批准执行同一纯合成验证后通过；没有更改系统网络或沙箱设置。最初夹具在macOS的/var别名与/private/var真路径之间出现预期值不一致，已将临时根统一为realpath；未放宽403断言，失败日志保留。

边界：fetch先按URL标准规范化点段，所以该例不能证明服务端收到原始未规范化点段时的行为；符号链接别名、所有编码组合和任意未来插件不在证明范围。Vite匹配忽略大小写，规则按请求文件路径匹配，不能宣称具备额外realpath防护。没有为扩展覆盖增加其他安全配置。

## 实际页面与相关检查

- 新Python持久回归1项通过（包括上述HTTP断言）；不是把原972项称为重新全跑或合计973项新测。
- 修改文件Prettier、ESLint、Ruff格式/规则及完整TypeScript类型检查通过。
- Chromium实际beta服务11项通过、0 skipped/unexpected/flaky/报告错误、零自动重试，用例ID与独立目录一致；约22.3秒。覆盖项目门户3项、数据管理2项、主页/刷新及上传离开保护2项、文档/llms代理4项。
- 浏览器开始前health已核实为新建cageledger-e2e临时库，并确认docs代理就绪；随后只复用本任务刚创建的服务，单worker，没有连接原运行库或外部反馈服务。
- 浏览器运行前后配置/测试输入指纹一致；本轮未重跑全部365、Vitest752及原Python972，既有完整验收仍作为bc25eb4实现阶段的历史证据，不冒充新配置全量结果。无生产构建、容器构建或发布。

## 数据与清理

原获准生产离线拷贝在前后两次独立只读核对中均为100文件；集合、大小、SHA-256相同，新增/删除/变更、符号链接及读取/遍历错误均0。未打开原数据库、读取行值或通过HTTP请求真实库/附件。

实际浏览器与开发服务退出码均0，6393/6394/6395已无监听；合成服务关闭，自有夹具临时树清理完成，其他服务未处理。工作区原有未跟踪`node_modules 2`链接保留，不纳入提交、不改ignore。交付时没有本轮仍运行的页面。

仓库外私有证据：`vite-data-guard-http-summary.json`、`vite-data-guard-python-final.json/log`、`vite-data-guard-code-checks.json`、`vite-data-guard-browser/`及其目录核对摘要、`vite-data-source-integrity-before.json`和`after.json`。这些证据不含HTTP真实数据读取；原数据清单不提交。

恢复缺件仍failed，npm/Python额外环境告警及双架构Docker访问阻碍保持原结论。没有因本次配置批准自动升级其他依赖或配置。

[最终验收](acceptance.md) · [前次收尾](follow-up.md) · [进度](progress.md)
