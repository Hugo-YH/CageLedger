# UI 变更与浏览器证据

实现提交 `bc25eb4`，最终完整代码输入核对通过。以下为本批实际检查的范围，不作为全站视觉或无障碍认证。原始JSON、trace、帧数据和合成截图保存在仓库外私有证据目录，未向第三方上传。

## 变更边界

| 项目           | 记录                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 组件族         | 移动主导航 `data-ui="mobile-navigation"`、弹层内容 `data-ui="mobile-navigation-sheet"`；工作区导航离开保护和数据管理上传。                                                                  |
| 样式所有者     | `src/styles/shell.css`，登记于 `src/styles/style-ownership.json`。仅添加限定弹层body/mask规则，本批没有删除遗留样式。                                                                       |
| 离开与重复操作 | 主页/刷新复用已注册guard；取消保留草稿/偏好，批准文档跳转后避免第二次beforeunload；数据管理上传阻止应用内离开，错误可重试；选择当前页关闭移动菜单。没有为全部表单增加保护。                 |
| 减少动态效果   | 初始reduce、打开中切换、关闭中切换、重新打开、卸载/重建后恢复普通动画；保留草稿、关闭遮罩不阻挡底部tab、body锁恢复。                                                                        |
| 实现方式       | 懒加载移动导航使用公开reduceMotion/restoreMotion；仅helper不能停止正在运行的spring，故另以限定CSS即时取消位移，关闭状态隐藏遮罩。没有导入库内未公开getter、重挂业务表单或修改桌面依赖分包。 |

## 完整报告核对

| 有效报告                     | 通过 | 跳过 | 非预期失败 | flaky | 报告错误 |
| ---------------------------- | ---: | ---: | ---------: | ----: | -------: |
| Chromium 1/3                 |  122 |    0 |          0 |     0 |        0 |
| Chromium 2/3                 |  134 |    0 |          0 |     0 |        0 |
| Chromium 3/3（串行完整重跑） |  109 |    0 |          0 |     0 |        0 |
| Firefox桌面兼容              |   38 |    0 |          0 |     0 |        0 |
| WebKit桌面兼容               |   38 |    0 |          0 |     0 |        0 |
| Firefox移动动效专项          |    6 |    0 |          0 |     0 |        0 |
| WebKit移动动效专项           |    6 |    0 |          0 |     0 |        0 |

三个Chromium有效报告用例ID并集为365，等于锁定目录且两两无交集；其他四组与各自目录核对一致。所有有效报告零自动重试。移动动效属于专项，不能直接加到Chromium全量当成额外独立全量；Firefox/WebKit只运行声明的桌面兼容和移动专项，未运行全部365项。

私有证据映射：`e2e-verified/chromium-1-of-3/results.json`、`chromium-2-of-3/results.json`；第三片为独立的 `e2e-shard3-serial/results.json`；兼容和动效分别在 `e2e-verified/compat/`、`mobile-motion/`。机器聚合为 `final-validation-summary.json`。

并发时swap持续上升，按预算中止第三片后单独重跑；原中断片、原编排退出1不计通过且未覆盖失败记录。七份有效报告使用7个不同的隔离临时数据库，最终1,526项代码/测试/锁输入与启动指纹相同。详见 [资源与验收边界](acceptance.md)。

## 真实帧与视觉抽查

三个引擎各在390×844、667×375、760×900覆盖初始reduce和打开中切换reduce，每种状态采样12帧，纵向位移均0。修复前两种模式均已复现位移，单靠库helper时运行中切换的反例仍失败；最终限定CSS修复后全部通过。恢复普通偏好并经桌面卸载、移动重建后有非零位移。

打开中切换时遮罩仍可淡入，因此不宣称无透明度动画。断言验证的是草稿、遮罩、body锁、再次打开和Escape的可观察结果，并非单独证明原生spring回调发生，也未对移动弹层宣称完整焦点循环认证。

Chromium合成截图已人工抽查：390×844标题、关闭、列表和底部操作可见；760×900同结构容纳正常；667×375横屏标题和底部操作可见，列表窗口较短，可滚动内容以测试断言为准，不据静态截图声称所有项目同时可见。主代理复看667×375截图。对应私有第二片artifacts中的 `mobile-popup-reduced.png`，视口和模式由测试目录名区分；没有真实业务数据截图进入Git。

## 桌面、状态与可访问性覆盖

| 范围                 | 实际有效用例入口                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面/窄屏/短横屏几何 | `zz-ant-system-audit.spec.ts`、`visual-contract.spec.ts`、`feedback.spec.ts`、`intake-image-recognition.spec.ts`；包含1440/1180桌面、760及844×390等尺寸，非所有页面穷举。                 |
| 加载、空、错与重试   | `dashboard-chart-states.spec.ts`、`quantity-list-recovery.spec.ts`、`list-read-loading.spec.ts`、`settings-inspection-resilience.spec.ts`；成功空态不冒充错误，关闭后迟到响应不重新打开。 |
| 慢请求与重复操作     | `document-navigation-guard.spec.ts`、`data-settings-feedback.spec.ts`、`async-feedback.spec.ts`；导入中保护、重复写入保护、错误保留和有意重试。                                           |
| 键盘、焦点与状态保留 | `dialog-motion.spec.ts`、`desktop-compat.spec.ts`、`quantity-navigation.spec.ts`、`feedback-drawer-lifecycle.spec.ts`；Escape、关闭后焦点、主题/动态偏好变化保持草稿。                    |
| 局部Axe扫描          | `accessibility.spec.ts`、`desktop-readability.spec.ts`、`date-column-filters.spec.ts`及技术服务、数据质量等指定区域；以已有严重/关键规则为准，未降低阈值。                                |

本批没有做整站视觉重写，也没有更换图表、账务模型或业务权限。浏览器引擎自动化不等于实体Safari/手机，Axe和键盘用例不等于整体WCAG认证。[W3C交互动效条目](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)为AAA，不能据此宣称系统已达到AAA。

## PDF运行环境与清理

初轮隔离环境未找到LibreOffice入口，原Chromium359项目录的9项及Firefox/WebKit各1项失败与转换组件缺失有关；图注空值是expect.poll中间采样，最终保存成功。所有初轮日志保留。后来取得官方26.8.2只读镜像并核SHA；复制件严格签名失败且未执行，镜像原件严格签名与Gatekeeper检查通过，版本26.8.2.2用于完整复验，原转换相关用例在最终有效报告中通过。没有移除系统安全标志、改签名或全局安装。

验收后本轮测试服务全部结束、自有端口无监听，只读镜像正常卸载；未停止其他任务的服务。交付时没有仍运行的本轮页面，浏览器证据可从私有报告复看。

[最终验收](acceptance.md) · [进度与证据索引](progress.md)
