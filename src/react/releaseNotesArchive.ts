import type { ReleaseNote } from "./releaseNoteModel";

export const ARCHIVED_RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.3.0",
    title: "数量统计表结算",
    items: ["新增数量统计表录入与保存", "支持按纸质统计表生成饲养费明细和结算单", "完善表单提示和 IACUC 支撑经费回填"],
  },
  {
    version: "0.2.1",
    title: "离线部署和文档整理",
    items: [
      "支持 NAS 离线源码包构建",
      "README 拆分为入口文档、API 文档和部署文档",
      "补充环境变量模板和 Docker 构建忽略规则",
    ],
  },
  {
    version: "0.2.0",
    title: "共享模式和权限基础",
    items: ["SQLite 拆表存储", "系统管理员和房间管理员账号", "IACUC CSV 上传、审计日志和系统更新检查"],
  },
];
