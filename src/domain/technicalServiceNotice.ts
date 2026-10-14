export function technicalServiceNotice(month: string, pi: string, amount: number) {
  return {
    subject: `${month} 技术服务费结算通知 · ${pi}`,
    body: `${pi}老师：\n\n您课题组${month}的技术服务费合计为${amount.toFixed(2)}元，明细见技术服务费结算单。请核对服务日期、项目、计费数量及金额，并按单位流程办理确认和报销。\n\n技术服务费与饲养费分别结算，请使用本课题对应经费。\n\n实验动物中心`,
  };
}
