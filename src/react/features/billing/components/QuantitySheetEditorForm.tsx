import { InfoCircleFilled } from "@ant-design/icons";
import { PersonNamesInput } from "../../../components/ui/PersonNamesInput";
import { formatPersonNames } from "../../../../domain/personNames";
import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { Alert, Button, DatePicker, Input, Popover, Select, Space, Tag, Typography, type InputRef } from "antd";
import dayjs from "dayjs";
import type { SessionUser } from "../../../api/contracts";
import { createQuantityRow } from "../../../../domain/quantitySheets";
import { ActionButton, CommandBar, ReadOnlyInput } from "../../../components/ui";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import type { QuantitySheetEditor } from "../hooks/useQuantitySheetEditor";
import { todayMonth, QUANTITY_ROWS_PER_PAGE, quantityAutoFillState } from "../quantitySheetEditorModel";
import { quantityValidationProps } from "../quantityValidation";
import { QuantityFieldError } from "./QuantityFieldError";
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
    validationIssues,
    validationRowsExpanded,
    validateEditor,
    restoreSourceField,
  } = editor;
  const visibleNotice = iacucLookup.error || notice;
  const visibleNoticeKind = iacucLookup.error ? "error" : noticeKind;
  const sourceMatch =
    iacucMatch?.iacuc.trim().toUpperCase() === draft.iacuc.trim().toUpperCase() ? iacucMatch : undefined;
  return (
    <form
      id="quantity-sheet-entry-form"
      className="panel large quantity-editor-panel quantity-entry-panel"
      onSubmit={requestSave}
      onInvalidCapture={(event) => validateEditor(event.currentTarget)}
    >
      {headActions ? (
        <CommandBar title="数量明细" titleSize="section" ariaLabel="编辑数量统计表操作" actions={headActions} />
      ) : null}
      {visibleNotice ? (
        <Alert
          role={visibleNoticeKind === "error" ? "alert" : "status"}
          showIcon
          type={visibleNoticeKind}
          title={visibleNotice}
        />
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
                {...quantityValidationProps(validationIssues, { field: "month" })}
                aria-label="月份"
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
              <QuantityFieldError issues={validationIssues} target={{ field: "month" }} />
            </label>
            <label
              className="field-required quantity-ant-field quantity-ant-field-required"
              htmlFor="quantity-sheet-room"
            >
              <span>房间号</span>
              <Select
                {...quantityValidationProps(validationIssues, { field: "roomId" })}
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
              <QuantityFieldError issues={validationIssues} target={{ field: "roomId" }} />
            </label>
            <ReadOnlyField label="登记人员" value={user.displayName} />
            <ReadOnlyField
              label="房间管理员"
              value={selectedRoom?.roomManager || ""}
              placeholder={draft.roomId ? "该房间未配置管理员" : "请先选择房间"}
            />
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
                {...quantityValidationProps(validationIssues, { field: "iacuc" })}
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
              <QuantityFieldError issues={validationIssues} target={{ field: "iacuc" }} />
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
            <AutoFilledField
              label="项目名称"
              value={draft.project}
              source={sourceMatch?.project}
              matched={Boolean(sourceMatch)}
              onRestore={() => restoreSourceField("project")}
              onChange={(value) => setField("project", value)}
            />
            <AutoFilledField
              label="支撑经费"
              value={draft.funding}
              source={sourceMatch?.funding}
              matched={Boolean(sourceMatch)}
              onRestore={() => restoreSourceField("funding")}
              onChange={(value) => setField("funding", value)}
            />
            <AutoFilledField
              personNames
              label="项目负责人"
              value={draft.pi}
              source={sourceMatch?.pi}
              matched={Boolean(sourceMatch)}
              onRestore={() => restoreSourceField("pi")}
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
              source={sourceMatch?.owner}
              matched={Boolean(sourceMatch)}
              onRestore={() => restoreSourceField("owner")}
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
        animalDetails={animalDetails || validationRowsExpanded}
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
  source,
  matched,
  onRestore,
  personNames = false,
}: {
  personNames?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: { title?: ReactNode; content: ReactNode };
  source?: string;
  matched: boolean;
  onRestore: () => void;
}) {
  const id = useId();
  const inputRef = useRef<InputRef>(null);
  const state = quantityAutoFillState(value, source, matched, personNames);
  const input = personNames ? (
    <PersonNamesInput ref={inputRef} id={id} aria-label={label} value={value} onChange={onChange} />
  ) : (
    <Input ref={inputRef} id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  );
  return (
    <div className="quantity-ant-field quantity-auto-field">
      <label htmlFor={id}>
        {label}
        <Tag
          variant="filled"
          className="quantity-field-source"
          title={matched ? "与当前 IACUC 来源比较，可按实际情况修订" : "尚未匹配当前 IACUC，可手动填写"}
        >
          {state.label}
        </Tag>
      </label>
      {hint ? (
        <Popover placement="top" open title={hint.title} content={hint.content}>
          {input}
        </Popover>
      ) : (
        input
      )}
      {state.canRestore ? (
        <Button
          htmlType="button"
          type="link"
          size="small"
          className="quantity-restore-source"
          aria-label={`恢复${label}来源值`}
          onClick={() => {
            onRestore();
            inputRef.current?.focus();
          }}
        >
          恢复来源值
        </Button>
      ) : null}
    </div>
  );
}

function ReadOnlyField({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="quantity-ant-field" role="group">
      <span id={labelId}>
        {label}
        <Tag variant="filled" className="quantity-field-source">
          系统带入
        </Tag>
      </span>
      <ReadOnlyInput aria-label={label} value={value} placeholder={placeholder || "-"} />
    </div>
  );
}
