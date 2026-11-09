---
layout: home
hero:
  name: CageLedger
  text: 从日常操作到工程维护
  tagline: 按任务找到入口，按流程理解业务，按契约维护系统。
  actions:
    - theme: brand
      text: 开始使用
      link: /guide/
    - theme: alt
      text: 部署与运维
      link: /operations/
    - theme: alt
      text: 开发与维护
      link: /development/
features:
  - title: 接收与饲养
    details: 从预约核对、笼卡打印到检疫、入驻与动物巡检。
    link: /guide/business-flow
    linkText: 查看业务流程
  - title: 费用与单据
    details: 录入数量统计表与服务明细，分别出单，跟踪登记与归档。
    link: /guide/settlement-and-reimbursement
    linkText: 查看结算指南
  - title: 可靠运行
    details: 核对部署配置、账号权限、备份范围与恢复步骤。
    link: /operations/
    linkText: 查看运维手册
  - title: 持续维护
    details: 从当前版本与实际入口出发，理解架构、约束和交付流程。
    link: /development/
    linkText: 查看开发手册
---

<div class="doc-home-content">

## 从你的任务开始

| 当前任务                     | 推荐阅读                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| 第一次登录并处理业务         | [快速开始](/guide/getting-started) → [工作台导航](/guide/navigation)            |
| 确认到货、打印笼卡与安排入驻 | [笼卡与接收](/guide/cage-cards) → [笼位与房间](/guide/rooms-and-cages)          |
| 录入月度数量并核算费用       | [数量统计表](/guide/quantity-sheets) → [饲养费核算](/guide/billing)             |
| 交回单据、补录报销与归档     | [结算与报销](/guide/settlement-and-reimbursement)                               |
| 新部署或排查运行异常         | [运维导航](/operations/) → [故障排查](/operations/troubleshooting)              |
| 修改代码或核对历史实现       | [当前版本与兼容边界](/development/current-baseline) → [开发导航](/development/) |

## 文档与当前版本

本轮文档以 **v1.31.7（Build 276）** 的实际入口为基准。[更新日志](/releases/)记录各版本变化，[当前版本与兼容边界](/development/current-baseline)说明现役流程与保留实现。截图使用隔离环境中的虚构数据，图注说明演示范围；[图文与引用规范](/development/documentation-media)记录来源和维护方法。

系统入口与产品介绍见<a href="/" target="_self">项目门户</a>。开发者可通过页面底部的“编辑此页”更新源文件；AI 工具可读取 [llms.txt](/llms.txt)。

</div>
