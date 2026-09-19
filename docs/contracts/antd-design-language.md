# CageLedger Ant Design 视觉语言

使用 lockfile 锁定的 Ant Design 6.5.2。API、弃用项、示例和语义样式以本地 CLI 与类型为依据，不随 CLI 升级提示修改依赖。

## 唯一来源

`src/theme/visual-system.mjs` 定义主题和集中对比度调整。`AntdProvider` 消费 `createTheme`；`scripts/generate_theme.mjs` 调用相同配置的 `getDesignToken`，生成 `src/styles/brand-tokens.css`。业务 CSS 通过 `tokens.css` 语义别名消费；文档站消费生成变量，保留阅读结构。浅色、深色和跟随系统均保留。

## 视觉尺度

| 项目             | 标准                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| 字体             | Ant 官方系统字体栈与中文系统回退，不加载网络字体                            |
| 正文／说明       | 14px/22px；12px/20px                                                        |
| 页标题／分区标题 | 24px/32px；16px/24px；600 字重                                              |
| 控件             | 桌面 32px、紧凑行操作 24px；手机输入 40px、16px 字号，按钮触控目标至少 44px |
| 间距             | 4/8/16/24/32px；页面桌面 24px、手机 16px                                    |
| 圆角             | 控件 6px，容器和浮层 8px；细节遵循官方 Token                                |
| 色彩             | 官方蓝与语义色、官方浅深算法；正常文字对比度至少 4.5:1                      |
| 层次             | 页面、内容容器、浮层三级；内容用边框和底色，阴影主要用于浮层                |
| 动效             | 官方 100/200/300ms 和命名缓动；无统一按压缩放、整页入场或延迟行动画         |

保留深色侧栏和业务菜单分组。宽屏展开，中屏可折叠；小于 768px 使用移动导航。列表利用工作区宽度；普通表单最大 1200px、桌面两列、手机一列。领域矩阵和图形工作区保留专用结构与独立滚动。

## 开发边界

- 每个决策区最多一个主动作；常用操作直接可见，低频动作通过明确的“更多”配置呈现。
- 原生控件兜底样式不能覆盖 Ant 内部控件，页面不调整 Ant 私有 DOM 来模拟另一套组件。
- 切换主题和减少动画不得重挂载表单；状态推进不依赖动画结束事件。
- 普通筛选静态，长表单和批量操作栏按场景吸顶；后台刷新保留内容及控件，初载才用骨架。
- 业务字段、权限、API、打印尺寸、Word/PDF 内容保持原有语义。
- `ConfigProvider.componentSize` 使用 `medium`；其他组件尺寸按对应组件 API 判断，禁止无差别替换 `middle`。

组件见 [UI 组件标准](ui-component-standard.md)，状态与选择见 [交互系统](ui-interaction-system.md)，颜色见 [颜色系统](ui-color-system.md)，布局见 [样式归属](style-ownership.md)。

官方依据：[Agent 文档](https://ant.design/docs/react/for-agents-cn.md)、[主题定制](https://ant.design/docs/react/customize-theme-cn)。API 查询使用项目 `antd` Skill 与本地 CLI，质量门禁与实际浏览器验收共同构成证据。
