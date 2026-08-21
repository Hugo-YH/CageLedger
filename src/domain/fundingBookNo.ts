const FUND_BOOK_LABELED = /经费本(?:编号|号)\s*[:：]\s*([0-9A-Za-z][0-9A-Za-z-]*)/;
const NON_FUND_BOOK_LABEL = /项目编号|基金号|基金编号/;
const TRAILING_TOKEN = /([0-9A-Za-z]+(?:-[0-9A-Za-z]+)*)\s*[)）]?\s*$/;

/**
 * 从 IACUC 索引的“支撑经费”描述文本中提取经费本编号。
 *
 * 优先识别“经费本编号/经费本号：…”的显式标注；没有显式标注时回退到
 * 末尾的经费本编号（数字或字母数字，可含连字符）。带“项目编号/基金号”
 * 标注的文本不会被当作经费本编号。
 */
export function extractFundingBookNo(fundingText: string): string {
  const text = fundingText.trim();
  if (!text) return "";

  const labeled = text.match(FUND_BOOK_LABELED);
  if (labeled?.[1]) return labeled[1];

  if (NON_FUND_BOOK_LABEL.test(text)) return "";

  const trailing = text.match(TRAILING_TOKEN);
  if (trailing?.[1] && /\d/.test(trailing[1])) return trailing[1];

  return "";
}

export interface FundingBookOption {
  value: string;
  label: string;
}

/**
 * 将合并后的“支撑经费”文本拆成下拉选项：展示完整描述，值保存为纯经费本编号。
 * 未识别出编号的条目回退为整段文本，并按值去重。
 */
export function buildFundingBookOptions(fundingText: string): FundingBookOption[] {
  const entries = [
    ...new Set(
      fundingText
        .split(/[、，,；;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const seen = new Set<string>();
  const options: FundingBookOption[] = [];
  for (const fullText of entries) {
    const value = extractFundingBookNo(fullText) || fullText;
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: fullText });
  }
  return options;
}

export function unverifiedFundingBookNos(values: Array<string | undefined>, knownFundingBookNos: string[]): string[] {
  const known = new Set(knownFundingBookNos.map((value) => value.trim()).filter(Boolean));
  return [...new Set(values.map((value) => value?.trim() || "").filter((value) => value && !known.has(value)))];
}

export interface FundingBookReference {
  value: string;
  label: string;
}

/**
 * 区分本月结算伦理可直接使用的经费本、同一负责人其他项目的经费本，及未登记的新经费本。
 */
export function reviewFundingBookNos(
  values: Array<string | undefined>,
  currentFundingBookNos: string[],
  piFundingBookOptions: FundingBookReference[],
) {
  const current = new Set(currentFundingBookNos.map((value) => value.trim()).filter(Boolean));
  const piOptions = new Map(
    piFundingBookOptions.map((option) => [option.value.trim(), option] as const).filter(([value]) => Boolean(value)),
  );
  const otherProjectOptions: FundingBookReference[] = [];
  const unknownFundingBookNos: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = rawValue?.trim() || "";
    if (!value || seen.has(value) || current.has(value)) continue;
    seen.add(value);
    const piOption = piOptions.get(value);
    if (piOption) otherProjectOptions.push(piOption);
    else unknownFundingBookNos.push(value);
  }
  return { otherProjectOptions, unknownFundingBookNos };
}

export function fundingBookRemark(option: FundingBookReference): string {
  return `${option.value} 为${option.label}的支撑经费`;
}
