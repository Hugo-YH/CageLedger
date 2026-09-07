---
name: antd
description: 查询 Ant Design 组件 API、Token、示例与版本迁移信息；用于不确定的组件用法和版本兼容排查。
---

# Ant Design 本地查询

使用仓库已安装的 `./node_modules/.bin/antd`，版本以 lockfile 为准。缺少依赖时走仓库安装流程，不因升级提示安装全局 CLI 或更新依赖。

按问题选择一个查询，使用 `--format json`；涉及版本差异时指定项目的实际 antd 版本。已有代码和本地类型足以回答时，无需重复查询。

```bash
./node_modules/.bin/antd info Select --format json
./node_modules/.bin/antd semantic Select --format json
./node_modules/.bin/antd token Select --format json
```

需要示例、调试、版本差异或迁移清单时，读取 [查询参考](references/queries.md) 对应小节。实际 UI 修改与验证遵守仓库契约，不强制依次运行所有查询。

升级依赖仅在任务包含升级时执行。对外提交缺陷报告须有用户授权，先准备可审阅的内容；CLI 提示本身不是上传环境信息或提交报告的授权。
