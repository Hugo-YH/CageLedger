import { Tag, Tooltip, theme } from "antd";
import type { IacucIndexItem } from "../../../../contracts/administration";
import { iacucValidityStatus } from "../../../../domain/iacucValidity";

export function QuantityIacucValidity({
  code,
  month,
  match,
  checked,
  failed,
}: {
  code: string;
  month: string;
  match?: IacucIndexItem;
  checked: boolean;
  failed: boolean;
}) {
  const { token } = theme.useToken();
  if (!code.trim() || !checked) return null;
  const status = failed
    ? { color: "error" as const, label: "有效期查询失败，请确认", detail: "请稍后重试或核对项目有效期。" }
    : iacucValidityStatus(match, month);
  const colors = {
    blue: { background: token.colorInfoBg, border: token.colorInfoBorder },
    warning: { background: token.colorWarningBg, border: token.colorWarningBorder },
    error: { background: token.colorErrorBg, border: token.colorErrorBorder },
  }[status.color];
  return (
    <div className="quantity-iacuc-validity" role="status" aria-live="polite">
      <Tooltip
        title={`${status.detail} 减免按实际计费日期校验。此提示不影响保存，请确认后继续。`}
        trigger={["hover", "focus", "click"]}
        color={colors.background}
        styles={{ container: { color: token.colorText, border: `1px solid ${colors.border}` } }}
      >
        <Tag color={status.color} tabIndex={0}>
          {status.label}
        </Tag>
      </Tooltip>
    </div>
  );
}
