import { useCallback, useState, type ReactNode } from "react";
import { Alert, Button, Form, Input, InputNumber, Select, Typography } from "antd";

import type { IacucIndexItem } from "../../../contracts/administration";
import type { TechnicalServiceSheet } from "../../../contracts/technicalServices";
import { technicalServiceAmount } from "../../../domain/technicalServiceMoney";
import { createClientId } from "../../../domain/id";
import { useServiceCatalog, useServiceMutation } from "../../api/technicalServices";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { ActionIcon, CommandBar, DataTable, DateInput } from "../../components/ui";
import { useQuantityIacuc } from "../billing/hooks/useQuantityIacuc";

function newServiceSheet(): TechnicalServiceSheet {
  const month = new Date().toISOString().slice(0, 7);
  return {
    id: createClientId(),
    month,
    iacuc: "",
    facility: "zhujiang",
    customerType: "internal",
    serviceId: "",
    serviceName: "",
    unit: "",
    unitPrice: 0,
    pi: "",
    project: "",
    owner: "",
    funding: "",
    manager: "",
    notes: "",
    updatedAt: "",
    rows: [{ id: createClientId(), date: `${month}-01`, quantity: 0 }],
    totalAmount: 0,
    totalQuantity: 0,
    serviceDayCount: 0,
  };
}

export function ServiceEditor({
  initial,
  onSaved,
  onCancel,
  toolbarActions,
}: {
  toolbarActions?: ReactNode;
  initial?: TechnicalServiceSheet;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    initial
      ? { ...structuredClone(initial), rows: initial.rows.map((row) => ({ ...row, id: createClientId() })) }
      : newServiceSheet(),
  );
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const catalog = useServiceCatalog();
  const mutation = useServiceMutation();
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  useUnsavedChanges(JSON.stringify(draft) !== baseline, mutation.isPending);
  const applyIacuc = useCallback(
    (item: IacucIndexItem) =>
      setDraft((previous) => ({
        ...previous,
        iacuc: item.iacuc,
        project: (initial?.iacuc === item.iacuc ? initial.project : item.project) || "",
        pi: (initial?.iacuc === item.iacuc ? initial.pi : item.pi) || "",
        owner: (initial?.iacuc === item.iacuc ? initial.owner : item.owner) || "",
        funding: (initial?.iacuc === item.iacuc ? initial.funding : item.funding) || "",
      })),
    [initial],
  );
  const iacuc = useQuantityIacuc(draft.iacuc, applyIacuc);
  const selected =
    draft.priceSnapshot && draft.priceSnapshot.id === draft.serviceId
      ? draft.priceSnapshot
      : catalog.data?.items.find((item) => item.id === draft.serviceId);
  const price = selected ? (draft.customerType === "external" ? selected.externalPrice : selected.internalPrice) : 0;
  const quantity = draft.rows.reduce((sum, row) => sum + row.quantity, 0);
  const amount =
    draft.rows.reduce((sum, row) => sum + Math.round(technicalServiceAmount(row.quantity, price) * 100), 0) / 100;
  const days = new Set(draft.rows.filter((row) => row.quantity > 0).map((row) => row.date)).size;

  function updateRow(index: number, patch: Partial<TechnicalServiceSheet["rows"][number]>) {
    setDraft((previous) => ({
      ...previous,
      rows: previous.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  async function save() {
    setNotice(null);
    try {
      await mutation.mutateAsync({ kind: "save", sheet: draft, editing: Boolean(initial) });
      setNotice({ error: false, text: "技术服务明细已保存" });
      setBaseline(JSON.stringify(draft));
      if (onSaved) onSaved();
      else {
        iacuc.reset();
        const fresh = newServiceSheet();
        setBaseline(JSON.stringify(fresh));
        setDraft(fresh);
      }
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "保存失败，请重试" });
    }
  }

  return (
    <Form
      className="technical-service-editor"
      disabled={Boolean(initial?.protected) || mutation.isPending}
      layout="vertical"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}
      onFinish={() => void save()}
      aria-label="技术服务明细录入"
    >
      <CommandBar
        title={initial ? "编辑技术服务明细" : "录入技术服务明细"}
        titleSize={initial ? "section" : "page"}
        description="匹配 IACUC 后选择服务项目，收费标准自动带入。按实际服务日期填写计费数量。"
        ariaLabel="技术服务明细录入操作"
        sticky={!initial}
        actions={
          <>
            {toolbarActions}
            {onCancel ? (
              <Button icon={<ActionIcon name="back" />} disabled={false} onClick={onCancel}>
                取消
              </Button>
            ) : null}
          </>
        }
        primaryAction={
          <Button
            icon={<ActionIcon name="save" />}
            type="primary"
            htmlType="submit"
            loading={mutation.isPending}
            disabled={mutation.isPending || !draft.pi || !selected || initial?.protected}
          >
            保存技术服务明细
          </Button>
        }
      />
      <div className={initial ? "technical-service-form-panel" : "panel large technical-service-form-panel"}>
        {notice ? <Alert role="status" showIcon type={notice.error ? "error" : "success"} title={notice.text} /> : null}
        {catalog.isError ? (
          <Alert
            showIcon
            type="error"
            title="收费标准读取失败"
            action={<Button onClick={() => void catalog.refetch()}>重试</Button>}
          />
        ) : null}
        <section className="technical-service-field-cluster" aria-label="项目与收费标准">
          <Typography.Title level={3} className="technical-service-section-title">
            项目与收费标准
          </Typography.Title>
          <div className="technical-service-fields">
            <Form.Item label="月份" htmlFor="service-month" required>
              <DateInput
                id="service-month"
                label="月份"
                picker="month"
                value={draft.month}
                onChange={(month) => setDraft((previous) => ({ ...previous, month }))}
              />
            </Form.Item>
            <Form.Item label="IACUC 编号" htmlFor="service-iacuc" required>
              <Input
                id="service-iacuc"
                list="service-iacuc-options"
                value={draft.iacuc}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    iacuc: event.target.value,
                    pi: "",
                    project: "",
                    funding: "",
                    owner: "",
                  }))
                }
                onBlur={() => void iacuc.apply(draft.iacuc)}
              />
              <datalist id="service-iacuc-options">
                {iacuc.options.map((item) => (
                  <option key={item.iacuc} value={item.iacuc}>
                    {item.project}
                  </option>
                ))}
              </datalist>
            </Form.Item>
            <Form.Item label="服务设施" htmlFor="service-facility" required>
              <Select
                id="service-facility"
                value={draft.facility}
                onChange={(facility) => setDraft((previous) => ({ ...previous, facility }))}
                options={[
                  { value: "zhujiang", label: "珠江新城" },
                  { value: "bioisland", label: "生物岛" },
                ]}
              />
            </Form.Item>
            <Form.Item label="计费类别" htmlFor="service-customer" required>
              <Select
                id="service-customer"
                value={draft.customerType}
                onChange={(customerType) =>
                  setDraft((previous) => ({ ...previous, customerType, priceSnapshot: undefined }))
                }
                options={[
                  { value: "internal", label: "院内" },
                  { value: "external", label: "院外" },
                ]}
              />
            </Form.Item>
            <Form.Item label="技术服务项目" htmlFor="service-item" required>
              <Select
                id="service-item"
                showSearch={{ optionFilterProp: "label" }}
                loading={catalog.isPending}
                value={draft.serviceId || undefined}
                onChange={(serviceId) => setDraft((previous) => ({ ...previous, serviceId, priceSnapshot: undefined }))}
                options={(catalog.data?.items || []).map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            <Form.Item label="收费标准">
              <Typography.Text>
                {selected ? `${price.toFixed(2)} 元／${selected.unit}` : "选择服务项目后自动匹配"}
              </Typography.Text>
            </Form.Item>
          </div>
          <div className="technical-service-fields">
            {[
              ["科研项目", draft.project || "待匹配IACUC"],
              ["项目负责人", draft.pi || "待匹配"],
              ["项目来源", draft.funding || "—"],
              ["收费依据", selected?.source || "—"],
            ].map(([label, value]) => (
              <Form.Item key={label} label={label}>
                <Input aria-label={label} readOnly value={value} title={value} className="technical-service-readonly" />
              </Form.Item>
            ))}
          </div>
          {iacuc.error ? <Alert showIcon type="error" title={iacuc.error} /> : null}
          {selected?.notes ? <Alert showIcon type="info" title={selected.notes} /> : null}
        </section>
        <section className="technical-service-field-cluster" aria-label="日期与计费数量">
          <CommandBar
            title="日期与计费数量"
            titleSize="section"
            description="日期可从日历选择；手动输入后按 Enter 确认。"
            ariaLabel="技术服务日期操作"
            actions={
              <Button
                icon={<ActionIcon name="create" />}
                disabled={Boolean(initial?.protected) || mutation.isPending || draft.rows.length >= 31}
                onClick={() =>
                  setDraft((previous) => ({
                    ...previous,
                    rows: [...previous.rows, { id: createClientId(), date: `${previous.month}-01`, quantity: 0 }],
                  }))
                }
              >
                添加服务日期
              </Button>
            }
          />
          <DataTable
            resizeKey="technical-service-entry"
            pagination={false}
            rowKey="id"
            dataSource={draft.rows}
            scroll={{ x: 620 }}
            columns={[
              {
                title: "日期",
                key: "date",
                width: 240,
                render: (_, row, index) => (
                  <DateInput
                    label={`服务日期 ${index + 1}`}
                    value={row.date}
                    required
                    onChange={(date) => updateRow(index, { date })}
                  />
                ),
              },
              {
                title: `计费数量${selected ? `（${selected.unit}）` : ""}`,
                key: "quantity",
                width: 180,
                render: (_, row, index) => (
                  <InputNumber
                    aria-label={`计费数量 ${index + 1}`}
                    min={0}
                    step={selected?.unit === "小时" ? 0.5 : 1}
                    value={row.quantity}
                    onChange={(value) => updateRow(index, { quantity: Number(value ?? 0) })}
                  />
                ),
              },
              {
                title: "当日金额（元）",
                key: "amount",
                width: 180,
                align: "right",
                render: (_, row) => technicalServiceAmount(row.quantity, price).toFixed(2),
              },
              {
                title: "操作",
                key: "action",
                width: 160,
                fixed: "right",
                render: (_, __, index) => (
                  <Button
                    danger
                    disabled={mutation.isPending || draft.rows.length === 1}
                    onClick={() =>
                      setDraft((previous) => ({ ...previous, rows: previous.rows.filter((__, i) => i !== index) }))
                    }
                  >
                    移除第{index + 1}行
                  </Button>
                ),
              },
            ]}
          />
          <Typography.Paragraph>
            服务日数：{days} 累计数量：{quantity} {selected?.unit} 技术服务费：{amount.toFixed(2)} 元
          </Typography.Paragraph>
          <Form.Item label="备注" htmlFor="service-notes">
            <Input.TextArea
              id="service-notes"
              value={draft.notes}
              onChange={(event) => setDraft((previous) => ({ ...previous, notes: event.target.value }))}
            />
          </Form.Item>
        </section>
      </div>
    </Form>
  );
}
