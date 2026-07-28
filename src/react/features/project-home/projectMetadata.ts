import { APP_VERSION } from "../../version";

export const PROJECT_METADATA = {
  name: "CageLedger",
  productName: "实验动物笼位管理与计费系统",
  summary: "面向实验动物中心的笼卡、笼位、动物管理、饲养费结算与报销核销运营平台。",
  version: APP_VERSION,
  organization: "中山大学中山眼科中心 · 实验动物中心",
  repositoryUrl: "https://git.cellnucle.us/hugo/cageledger",
  docsUrl: "/docs/",
  releasesUrl: "https://git.cellnucle.us/hugo/cageledger/releases",
} as const;

export const PROJECT_RESOURCE_LINKS = [
  {
    title: "用户与部署文档",
    description: "查看使用流程、Docker/NAS 部署、离线包和升级说明。",
    href: PROJECT_METADATA.docsUrl,
  },
  {
    title: "版本与离线包",
    description: "查看正式发布记录、容器镜像与离线部署资源。",
    href: PROJECT_METADATA.releasesUrl,
  },
  {
    title: "源码与开发规范",
    description: "访问 Gitea 仓库、Issue 与项目开发资料。",
    href: PROJECT_METADATA.repositoryUrl,
  },
] as const;
