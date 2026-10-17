import type { CustomBillingSegment } from "../../../api/contracts";
import { Button, Collapse, Input, InputNumber, Space, Switch, Tag, Typography } from "antd";
import { customBillingUsesAllQuantity } from "../../../../domain/quantitySheets";
import { Tooltip } from "../../../components/Tooltip";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import { ActionButton, DateInput } from "../../../components/ui";
import type { QuantitySheetEditor } from "../hooks/useQuantitySheetEditor";

export function QuantityBillingOptions({ editor }: { editor: QuantitySheetEditor }) {
  const {
    draft,
    optionsExpanded,
    setOptionsExpanded,
    freeCageEnabled,
    tierPriorityEnabled,
    customBillingSegmentCount,
    freeCageAllowance,
    supportsFreeCages,
    supportsTierPriority,
    setFreeCageEnabled,
    setField,
    setFullExemption,
    setTierPriorityEnabled,
    addCustomBillingSegment,
    unit,
    updateCustomBillingSegment,
    removeCustomBillingSegment,
    billingProfile,
  } = editor;
  return (
    <div className={`quantity-options-panel ${optionsExpanded ? "expanded" : "collapsed"}`}>
      <Collapse
        className="quantity-options-collapse"
        ghost
        activeKey={optionsExpanded ? ["options"] : []}
        onChange={(keys) => setOptionsExpanded(keys.includes("options"))}
        destroyOnHidden={false}
        classNames={{ header: "quantity-options-toggle" }}
        styles={{ body: { padding: 0 } }}
        items={[
          {
            key: "options",
            id: "quantity-options",
            showArrow: false,
            onKeyDown: (event) => {
              if (
                event.key === " " &&
                event.target instanceof Element &&
                event.target.closest(".quantity-options-toggle")
              ) {
                event.preventDefault();
                if (!event.repeat) setOptionsExpanded((current) => !current);
              }
            },
            label: (
              <span className="quantity-options-toggle-content">
                <span className="quantity-options-toggle-copy">
                  <strong>计费扩展选项</strong>
                  {billingOptionsBadges({
                    freeCageEnabled,
                    fullExemption: draft.fullExemption,
                    tierPriorityEnabled,
                    customBillingSegmentCount,
                  }).length ? (
                    <span className="quantity-options-badges" aria-label="已启用计费扩展选项">
                      {billingOptionsBadges({
                        freeCageEnabled,
                        fullExemption: draft.fullExemption,
                        tierPriorityEnabled,
                        customBillingSegmentCount,
                      }).map((label) => (
                        <Tag key={label} className="quantity-options-badge">
                          {label}
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <small>
                      {billingOptionsSummary({
                        freeCageEnabled,
                        fullExemption: draft.fullExemption,
                        tierPriorityEnabled,
                        customBillingSegmentCount,
                      })}
                    </small>
                  )}
                </span>
                <span className="quantity-options-toggle-icon" aria-hidden="true">
                  {optionsExpanded ? "收起" : "展开"}
                </span>
              </span>
            ),
            children: (
              <div id="quantity-billing-options-panel" className="quantity-billing-options">
                <div className="quantity-free-cage-module">
                  <div className="quantity-free-cage-head">
                    <div>
                      <strong>优先减免</strong>
                      <span>
                        {draft.fullExemption
                          ? "当前伦理在有效期内产生的饲养费全部减免"
                          : draft.pi
                            ? `项目负责人每日总额度 ${freeCageAllowance} 笼；开启后本伦理优先参与减免分配，可再指定每日优先笼数`
                            : "选择 IACUC 后显示项目负责人减免额度"}
                      </span>
                    </div>
                    <Tooltip
                      content={
                        draft.fullExemption
                          ? "全额减免已开启，普通优先减免暂停使用。"
                          : supportsFreeCages
                            ? "打开后本伦理优先参与减免分配；未填写笼数时按剩余额度优先分配。"
                            : "当前计费口径没有项目负责人减免额度。"
                      }
                    >
                      <div
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${freeCageEnabled ? "enabled" : ""} ${supportsFreeCages && !draft.fullExemption ? "" : "locked"}`}
                      >
                        <Switch
                          aria-label="优先减免"
                          checked={freeCageEnabled}
                          disabled={!supportsFreeCages || draft.fullExemption}
                          onChange={setFreeCageEnabled}
                        />
                        <span className="quantity-animal-toggle-label">优先减免</span>
                      </div>
                    </Tooltip>
                  </div>
                  {freeCageEnabled ? (
                    <label className="quantity-free-cage-field" htmlFor="quantity-preferred-free-cages">
                      优先减免笼数/天
                      <Input
                        type="number"
                        id="quantity-preferred-free-cages"
                        min="0"
                        step="1"
                        value={draft.preferredFreeCages ?? ""}
                        placeholder="请输入笼数"
                        onChange={(event) =>
                          setField("preferredFreeCages", event.target.value === "" ? null : Number(event.target.value))
                        }
                      />
                      <small>
                        指定额度优先分配给当前伦理号，剩余额度继续自动分配；可不填写，仅开启开关时本伦理号在剩余额度分配中优先。
                      </small>
                    </label>
                  ) : null}
                  <div className={`quantity-full-exemption-row ${draft.fullExemption ? "enabled" : ""}`}>
                    <div>
                      <strong>全额减免</strong>
                      <small>有效期内每日实际饲养量全部减免，且不占用项目负责人普通减免额度。</small>
                    </div>
                    <Tooltip content="打开后，当前伦理在有效期内产生的饲养费全部减免。">
                      <div
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${draft.fullExemption ? "enabled" : ""}`}
                      >
                        <Switch aria-label="全额减免" checked={draft.fullExemption} onChange={setFullExemption} />
                        <span className="quantity-animal-toggle-label">全额减免</span>
                      </div>
                    </Tooltip>
                  </div>
                  <div className={`quantity-full-exemption-row ${tierPriorityEnabled ? "enabled" : ""}`}>
                    <div>
                      <strong>优先梯度</strong>
                      <small>
                        {supportsTierPriority
                          ? "打开后，当前伦理优先承接本项目负责人在本月超出 160 笼/天后的梯度收费。"
                          : "当前房间计费口径没有梯度收费。"}
                      </small>
                    </div>
                    <Tooltip
                      content={
                        draft.fullExemption
                          ? "全额减免已开启，优先梯度暂停使用。"
                          : supportsTierPriority
                            ? "打开后，当前伦理优先承接梯度收费。"
                            : "当前计费口径没有梯度收费。"
                      }
                    >
                      <div
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${tierPriorityEnabled ? "enabled" : ""} ${supportsTierPriority && !draft.fullExemption ? "" : "locked"}`}
                      >
                        <Switch
                          aria-label="优先梯度"
                          checked={tierPriorityEnabled}
                          disabled={!supportsTierPriority || draft.fullExemption}
                          onChange={setTierPriorityEnabled}
                        />
                        <span className="quantity-animal-toggle-label">优先梯度</span>
                      </div>
                    </Tooltip>
                  </div>
                </div>
                <div className="quantity-free-cage-module quantity-custom-billing-module">
                  <div className="quantity-free-cage-head">
                    <div>
                      <strong>自定义收费区间</strong>
                      <span>特殊饲养按日期、数量与单价独立计费，不参与减免和梯度累计。</span>
                    </div>
                    <ActionButton
                      icon={<ActionIcon name="create" />}
                      className="compact-action"
                      onClick={addCustomBillingSegment}
                    >
                      新增区间
                    </ActionButton>
                  </div>
                  {customBillingSegmentCount ? (
                    <CustomBillingSegmentsEditor
                      segments={draft.customBillingSegments}
                      unit={unit}
                      onChanged={updateCustomBillingSegment}
                      onRemoved={removeCustomBillingSegment}
                    />
                  ) : (
                    <p className="quantity-custom-billing-empty">
                      标准收费 ¥{billingProfile.price.toFixed(2)} / {unit === "animal_day" ? "只/天" : "笼/天"}
                      ；按需新增特殊饲养收费区间。
                    </p>
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function CustomBillingSegmentsEditor({
  segments,
  unit,
  onChanged,
  onRemoved,
}: {
  segments: CustomBillingSegment[];
  unit: "animal_day" | "cage_day";
  onChanged: (id: string, update: Partial<CustomBillingSegment>) => void;
  onRemoved: (id: string) => void;
}) {
  const quantityLabel = unit === "animal_day" ? "动物数/天" : "笼数/天";
  const unitLabel = unit === "animal_day" ? "只/天" : "笼/天";
  return (
    <div className="custom-billing-segments" aria-label="自定义收费区间">
      {segments.map((segment, index) => (
        <section key={segment.id} className="custom-billing-segment">
          <div className="custom-billing-segment-head">
            <div>
              <strong>区间 {index + 1}</strong>
              <span>
                {customBillingUsesAllQuantity(segment)
                  ? "按每日实际结余核算"
                  : `预估 ¥${estimateCustomBillingSegment(segment).toFixed(2)}`}
              </span>
            </div>
            <Button danger size="small" onClick={() => onRemoved(segment.id)}>
              删除
            </Button>
          </div>
          <Space wrap>
            <Switch
              aria-label={`区间 ${index + 1} 全部${unit === "animal_day" ? "动物" : "笼位"}按自定义收费`}
              checked={customBillingUsesAllQuantity(segment)}
              onChange={(checked) => onChanged(segment.id, { quantityMode: checked ? "all" : "fixed", quantity: null })}
            />
            <span>全部{unit === "animal_day" ? "动物" : "笼位"}按自定义收费</span>
            <Typography.Text type="secondary">仅在本区间内，按每天实际结余数量计算</Typography.Text>
          </Space>
          <div className="custom-billing-segment-fields">
            <div className="custom-billing-field">
              <span>开始日期</span>
              <DateInput
                label="开始日期"
                value={segment.startDate}
                onChange={(value) => onChanged(segment.id, { startDate: value })}
              />
            </div>
            <div className="custom-billing-field">
              <span>结束日期</span>
              <DateInput
                label="结束日期"
                value={segment.endDate}
                onChange={(value) => onChanged(segment.id, { endDate: value })}
              />
            </div>
            {customBillingUsesAllQuantity(segment) ? (
              <div className="custom-billing-field">
                <span>{quantityLabel}</span>
                <Typography.Text>当天全部实际结余</Typography.Text>
              </div>
            ) : (
              <label>
                {quantityLabel}
                <InputNumber<number>
                  min={1}
                  step={1}
                  value={segment.quantity ?? null}
                  placeholder="每日数量"
                  onChange={(event) => onChanged(segment.id, { quantity: event == null ? null : Number(event) })}
                />
              </label>
            )}
            <label>
              单价（元/{unitLabel}）
              <InputNumber<number>
                min={0.01}
                step={0.01}
                value={segment.unitPrice ?? null}
                placeholder="收费单价"
                onChange={(event) => onChanged(segment.id, { unitPrice: event == null ? null : Number(event) })}
              />
            </label>
            <div className="custom-billing-segment-note custom-billing-field">
              <span>收费说明</span>
              <Input
                aria-label="收费说明"
                value={segment.note}
                placeholder="例如：特殊饲料"
                onChange={(event) => onChanged(segment.id, { note: event.target.value })}
              />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function estimateCustomBillingSegment(segment: CustomBillingSegment) {
  if (!segment.quantity || !segment.unitPrice) return 0;
  const start = new Date(`${segment.startDate}T00:00:00`);
  const end = new Date(`${segment.endDate}T00:00:00`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(days, 0) * segment.quantity * segment.unitPrice;
}
function billingOptionsSummary({
  freeCageEnabled,
  fullExemption,
  tierPriorityEnabled,
  customBillingSegmentCount,
}: {
  freeCageEnabled: boolean;
  fullExemption: boolean;
  tierPriorityEnabled: boolean;
  customBillingSegmentCount: number;
}) {
  const active = billingOptionsBadges({
    freeCageEnabled,
    fullExemption,
    tierPriorityEnabled,
    customBillingSegmentCount,
  });
  return active.length ? `已启用：${active.join("、")}` : "默认收起，按需展开设置优先减免、梯度和自定义收费";
}

function billingOptionsBadges({
  freeCageEnabled,
  fullExemption,
  tierPriorityEnabled,
  customBillingSegmentCount,
}: {
  freeCageEnabled: boolean;
  fullExemption: boolean;
  tierPriorityEnabled: boolean;
  customBillingSegmentCount: number;
}) {
  return [
    freeCageEnabled ? "优先减免" : "",
    fullExemption ? "全额减免" : "",
    tierPriorityEnabled ? "优先梯度" : "",
    customBillingSegmentCount ? `自定义收费 ${customBillingSegmentCount} 条` : "",
  ].filter(Boolean);
}
