# v1.21.3依赖审计边界（2026-10-31）

发布准备阶段按SECURITY.md重新检查最终锁文件和Python依赖来源；不将2026-10-30的10节点报告当成当前结果。本次只记录适用性，不修改依赖大版本、共享Python环境、网络配置或安全阈值。

## npm当前快照

当前锁文件的npm审计为24个告警节点：high3、moderate16、low5、critical0。较前次增加的一项底层中危公告沿开发工具父链传播为14个额外节点，不代表新增14个独立漏洞或生产端点。

新增为[minimatch globparts放大DoS](https://github.com/advisories/GHSA-g3hv-75wg-m249)。公告影响<11.0.1，修复版11.0.1；需要攻击者可控glob模式，优化级别>=2时预处理增长并触发高CPU/内存占用。当前锁中的3.1.5和10.2.5均标记dev，父声明分别^3.1.2/^3.1.5及^10.2.2，修复主版本不在这些范围内。未运行攻击载荷，也不将审计的广泛版本范围当成各旧实现都已复现利用。

传播涉及ESLint、eslint-config-array/eslintrc、typescript-eslint及插件等。审计自动建议部分工具降级，未采用强制降级或跨主版本override；需另行迁移工具链与规则兼容验证。该链不属于应用生产依赖图，镜像最终层不安装Node开发依赖；这不是对开发/CI输入安全的免除。

原有high3仍为smol-toml、markdownlint-cli2和VitePress内旧Vite；原moderate2为VitePress/esbuild；low5为antd-mobile/deepmerge及KaTeX/数学解析父链。具体触发前提与修复范围沿用[前次收尾表](follow-up.md)，当前minimatch增量以本页为准。生产依赖图未作升级，不宣称依赖已清零。

审计在仓库外临时锁文件副本执行，仅发送已核实来自官方registry的公开包名/版本，不含源文件、业务记录或凭据；没有执行npm audit fix或安装脚本。

## Python当前环境

重新下载[OSV官方PyPI公开整库](https://google.github.io/osv.dev/data/)，使用既有离线PEP440匹配脚本在本地比对24个安装分发，未上传清单。当前平台/default extra的运行9包和开发2包闭包无已知匹配；共享环境额外包与安装工具仍有6组匹配（Brotli1、pip1、WeasyPrint4），修复版本与触发条件见[收尾复核](follow-up.md)。

不将本机共享venv当作容器依赖证明；容器实际包版本在产物验收中另外核对。未审计完整CPython/原生系统库或所有未来依赖解析，不据此提供供应链安全认证。没有更新共享Python环境。

## 发布验收与数据边界

最终main版本/Build/更新说明作为完整门禁输入；Vite防护须保留默认deny及工程data绝对规则，通过现有合成回归。API、数据库兼容和恢复继续使用隔离副本。原始真实副本缺4附件仍是failed，synthetic-complete通过仅证明含水印测试材料的恢复，不代表找回真实文件。

公开报告只保留聚合和官方公告；安装清单、数据库、真实或占位图片、私有路径/日志不进入Git或制品。制品需在上传前检查文件清单和已知输入指纹，并核对两架构镜像标签、修订及摘要；ARM64主机的AMD64仿真测试不称原生AMD64验证。
