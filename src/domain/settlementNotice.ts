export interface SettlementNoticeInput {
  /** 结算月份，格式 YYYY-MM。 */
  month: string;
  /** 当月应交总额。 */
  totalAmount: number | null;
  /** 当前登录人员姓名。 */
  staffName: string;
  /** 当前登录人员电话。 */
  staffPhone: string;
  /** 通知落款日期，默认当天。 */
  date?: Date;
}

export interface SettlementNoticeEmail {
  subject: string;
  body: string;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function formatAmount(value: number | null) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}元`;
}

/**
 * 生成"实验动物饲养费结算通知"邮件模版，随发起结算流程一并提供。
 */
export function buildSettlementNoticeEmail(input: SettlementNoticeInput): SettlementNoticeEmail {
  const [year, monthNumber] = String(input.month || "")
    .split("-")
    .map(Number);
  const validMonth = Number.isInteger(year) && Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12;
  const safeYear = validMonth ? year : new Date().getFullYear();
  const safeMonth = validMonth ? monthNumber : new Date().getMonth() + 1;
  const monthLabel = `${safeYear}年${pad(safeMonth)}月`;
  const periodStart = `${monthLabel}01日`;
  const periodEnd = `${pad(safeMonth)}月${pad(lastDayOfMonth(safeYear, safeMonth))}日`;
  const letterDate = input.date || new Date();
  const dateLabel = `${letterDate.getFullYear()}年${pad(letterDate.getMonth() + 1)}月${pad(letterDate.getDate())}日`;

  const subject = `实验动物中心关于开展${monthLabel}实验动物饲养费结算的通知`;

  const body = `尊敬的教授、实验人员：

您好！

根据《实验动物饲养及技术服务管理办法》（眼科科研〔2024〕4号），经实验动物中心核算，您在${periodStart}至${periodEnd}期间进行的动物实验项目已产生实验动物饲养费用，当月应交总额为${formatAmount(input.totalAmount)}，详细费用见附件（饲养费结算单/核算汇总表）。

请确认您的项目支撑经费余额充足，并在确认无误后，于下月月底前将以下签字版纸质材料交回实验动物中心办公室：

1、日常报销单（科教经费）
- 请登录医院高效运营管理系统（OES）系统生成，需选择伦理对应的经费号，预算项目选“材料费”，费用项目选“动物饲养费”。
2、饲养费结算单/核算汇总表

材料接收点：珠江新城办公室8009（注：提交材料时请做好登记）
如有任何疑问，请随时与动物中心工作人员联系（${input.staffName} ${input.staffPhone}）。感谢您的配合！

此致，
敬礼！

实验动物中心
${dateLabel}`;

  return { subject, body };
}
