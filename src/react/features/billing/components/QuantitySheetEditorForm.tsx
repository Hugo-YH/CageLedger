import { PersonNamesInput } from "../../../components/ui/PersonNamesInput";
import { formatPersonNames } from "../../../../domain/personNames";
import { useId } from "react";
import type { ReactNode } from "react";
import { CheckCircleFilled, CloseCircleFilled, InfoCircleFilled } from "@ant-design/icons";
import { Button, DatePicker, Input, Popover, Select, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { SessionUser } from "../../../api/contracts";
import { createQuantityRow } from "../../../../domain/quantitySheets";
import { ActionButton, CommandBar } from "../../../components/ui";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import type { QuantitySheetEditor } from "../hooks/useQuantitySheetEditor";
import { todayMonth, QUANTITY_ROWS_PER_PAGE } from "../quantitySheetEditorModel";
import { QuantityBillingOptions } from "./QuantityBillingOptions";
import { QuantityEditorPages } from "./QuantityEditorPages";
import { QuantityIacucValidity } from "./QuantityIacucValidity";

export function QuantitySheetEditorForm({
  editor,
  user,
  mode,
  headActions,
}: {
  editor: QuantitySheetEditor;
  user: SessionUser;
  mode: "entry" | "saved";
  headActions?: ReactNode;
}) {
  const {
    draft,
    setDraft,
    editorRows,
    setEditorRows,
    notice,
    noticeKind,
    iacucLookup,
    iacucOptions,
    iacucMatch,
    piHistory,
    previousPi,
    piHint,
    rooms,
    selectedRoom,
    chooseRoom,
    setField,
    requestSave,
    rowRefs,
    recalculate,
    animalDetails,
  } = editor;
  const visibleNotice = iacucLookup.error || notice;
  const visibleNoticeKind = iacucLookup.error ? "error" : noticeKind;
  return (
    <form
      id="quantity-sheet-entry-form"
      className="panel large quantity-editor-panel quantity-entry-panel"
      onSubmit={requestSave}
    >
      {headActions ? (
        <CommandBar title="数量明细" titleSize="section" ariaLabel="编辑数量统计表操作" actions={headActions} />
      ) : null}
      {visibleNotice ? (
        <div
          className={`react-inline-notice is-${visibleNoticeKind}`}
          role={visibleNoticeKind === "error" ? "alert" : "status"}
        >
          {visibleNoticeKind === "success" ? (
            <CheckCircleFilled aria-hidden className="notice-icon" />
          ) : visibleNoticeKind === "error" ? (
            <CloseCircleFilled aria-hidden className="notice-icon" />
          ) : (
            <InfoCircleFilled aria-hidden className="notice-icon" />
          )}
          <span>{visibleNotice}</span>
        </div>
      ) : null}
      <div className="quantity-sheet-fields">
        <div className="field-cluster quantity-field-cluster">
          <div className="field-cluster-head">
            <h3>基础信息</h3>
            <span>月份和房间决定计费口径</span>
          </div>
          <div className="field-cluster-body quantity-field-group quantity-field-group-basic">
            <label
              className="field-required quantity-ant-field quantity-ant-field-required"
              htmlFor="quantity-sheet-month"
            >
              <span>月份</span>
              <DatePicker
                id="quantity-sheet-month"
                picker="month"
                format="YYYY-MM"
                value={draft.month ? dayjs(draft.month) : null}
                disabledDate={(current) => Boolean(current && current.isAfter(dayjs(todayMonth).endOf("month")))}
                onChange={(date) => {
                  const month = date ? date.format("YYYY-MM") : "";
                  setField("month", month);
                  setEditorRows((rows) =>
                    rows.map((row, index) =>
                      index === 0 ? { ...row, date: `${month}-01`, rawDateInput: `${month}-01` } : row,
                    ),
                  );
                }}
              />
            </label>
            <label
              className="field-required quantity-ant-field quantity-ant-field-required"
              htmlFor="quantity-sheet-room"
            >
              <span>房间号</span>
              <Select
                aria-label="房间号"
                className="quantity-room-select"
                id="quantity-sheet-room"
                options={[
                  { value: "", label: "请选择房间号" },
                  ...rooms.map((room) => ({ value: room.id, label: room.name })),
                ]}
                value={draft.roomId}
                onChange={chooseRoom}
              />
            </label>
            <ReadOnlyField label="登记人员" value={user.displayName} />
            <ReadOnlyField label="房间管理员" value={selectedRoom?.roomManager || ""} placeholder="当前房间未设置" />
          </div>
        </div>
        <div className="field-cluster quantity-field-cluster">
          <div className="field-cluster-head">
            <h3>项目与伦理</h3>
          </div>
          <div className="field-cluster-body quantity-field-group quantity-field-group-project">
            <label className="field-required quantity-ant-field quantity-ant-field-required quantity-iacuc-field">
              <span>IACUC 编号</span>
              <Input
                aria-label="IACUC 编号"
                list="quantity-iacuc-options"
                value={draft.iacuc}
                required
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  setField("iacuc", value);
                  if (!value.trim()) {
                    setDraft((current) => ({ ...current, project: "", pi: "", owner: "", funding: "" }));
                  }
                }}
                onBlur={(event) => void iacucLookup.apply(event.target.value)}
              />
              <datalist id="quantity-iacuc-options">
                {iacucOptions.map((item, index) => (
                  <option key={`${item.iacuc}-${item.project}-${item.pi}-${index}`} value={item.iacuc}>
                    {item.project || formatPersonNames(item.pi)}
                  </option>
                ))}
              </datalist>
              <QuantityIacucValidity
                code={draft.iacuc}
                month={draft.month}
                match={iacucMatch}
                checked={iacucLookup.checked}
                failed={iacucLookup.failed}
              />
            </label>
            <AutoFilledField label="项目名称" value={draft.project} onChange={(value) => setField("project", value)} />
            <AutoFilledField label="支撑经费" value={draft.funding} onChange={(value) => setField("funding", value)} />
            <AutoFilledField
              personNames
              label="项目负责人"
              value={draft.pi}
              onChange={(value) => setField("pi", value)}
              hint={
                piHint
                  ? {
                      title: (
                        <Space size={6}>
                          <InfoCircleFilled className="quantity-pi-hint-icon" />
                          <span>项目负责人与 IACUC 登记不一致</span>
                        </Space>
                      ),
                      content: (
                        <div className="quantity-pi-history-hint">
                          <Typography.Paragraph type="secondary" className="quantity-pi-hint-text">
                            {piHistory.data?.item?.month} 该伦理号最近一次按「{previousPi}」结算，与 IACUC 登记的「
                            {formatPersonNames(iacucMatch?.pi)}」不一致，请确认后修改。
                          </Typography.Paragraph>
                          <div className="quantity-pi-hint-actions">
                            <Button size="small" type="primary" onClick={() => setField("pi", previousPi)}>
                              带入「{previousPi}」
                            </Button>
                          </div>
                        </div>
                      ),
                    }
                  : undefined
              }
            />
            <AutoFilledField
              personNames
              label="实验负责人"
              value={draft.owner}
              onChange={(value) => setField("owner", value)}
            />
          </div>
        </div>
        <QuantityBillingOptions editor={editor} />
      </div>
      <div className="quantity-page-toolbar compact">
        <ActionButton
          icon={<ActionIcon name="create" />}
          className="info-button"
          onClick={() =>
            setEditorRows((rows) => [
              ...rows,
              ...Array.from({ length: QUANTITY_ROWS_PER_PAGE }, () => createQuantityRow(draft.month)),
            ])
          }
        >
          新增统计表页
        </ActionButton>
      </div>
      <QuantityEditorPages
        rows={editorRows}
        month={draft.month}
        animalDetails={animalDetails}
        showCalculatedPlaceholders={mode === "entry"}
        rowRefs={rowRefs}
        onChanged={recalculate}
      />
    </form>
  );
}

function AutoFilledField({
  label,
  value,
  onChange,
  hint,
  personNames = false,
}: {
  personNames?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: { title?: ReactNode; content: ReactNode };
}) {
  const input = personNames ? (
    <PersonNamesInput aria-label={label} value={value} onChange={onChange} />
  ) : (
    <Input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  );
  return (
    <label className="quantity-ant-field quantity-auto-field">
      <span>
        {label}
        <Tag variant="filled" className="quantity-field-source" title="选择 IACUC 后自动带入，可按实际情况修订">
          自动带入
        </Tag>
      </span>
      {hint ? (
        <Popover placement="top" open title={hint.title} content={hint.content}>
          {input}
        </Popover>
      ) : (
        input
      )}
    </label>
  );
}

function ReadOnlyField({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="quantity-ant-field quantity-readonly-field" role="group">
      <span id={labelId}>
        {label}
        <Tag variant="filled" className="quantity-field-source">
          系统带入
        </Tag>
      </span>
      <Typography.Text className="readonly-field" type={value ? undefined : "secondary"}>
        {value || placeholder || "-"}
      </Typography.Text>
    </div>
  );
}
