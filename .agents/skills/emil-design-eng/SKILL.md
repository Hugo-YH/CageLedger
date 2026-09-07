---
name: emil-design-eng
description: 打磨具体组件的反馈、过渡与微交互；用于 UI 细节实现或评审，不替代项目设计规范。
---

# 组件细节与动效

依据 Emil Kowalski 的设计工程方法，改善用户已指定组件的反馈、连续性和响应速度。沿用 CageLedger 的 Ant 组件与 Token，建议值是参考，不因风格偏好重写设计系统或更换库。

按问题读取一份相关参考，需要更多信息时再扩展：

| 问题                             | 参考                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| 是否需要动画、时长、缓动或弹簧   | [motion.md](references/motion.md)                                       |
| 按钮、Popover、Tooltip、进出场   | [components.md](references/components.md)                               |
| transform、clip-path、坐标与缩放 | [transforms.md](references/transforms.md)                               |
| 拖动、动量、边界阻尼             | [gestures.md](references/gestures.md)                                   |
| 性能、减少动态效果、触屏 hover   | [performance-accessibility.md](references/performance-accessibility.md) |
| Toast、组件一致性与细节          | [polish.md](references/polish.md)                                       |
| 错峰进场、慢放检查与调试         | [debugging.md](references/debugging.md)                                 |

高频操作优先即时响应；动效不得阻塞输入。减少动态效果的具体处理以项目无障碍契约为准，可以关闭非必要动画。实现任务完成目标组件与必要验收；评审任务只报告有证据的问题，不强制输出固定表格或等待次日复查。
