import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircleFilled, CloseCircleFilled, InfoCircleFilled } from "@ant-design/icons";
import { Button, DatePicker, Input, InputNumber, Select, Switch, Tag } from "antd";
import dayjs from "dayjs";

import type { CustomBillingSegment, QuantitySheet, QuantitySheetRow, SessionUser } from "../../api/contracts";
import { usePrincipalIdentities } from "../../api/administration";
import { useIacucSearch } from "../../api/iacuc";
import { useQuantitySheetRooms, useSaveQuantitySheet } from "../../api/quantitySheets";
import { Tooltip } from "../../components/Tooltip";
import { ActionButton } from "../../components/ui";
import { AsyncActionButton, ModalShell } from "../../components/WorkspaceUi";
import {
  createQuantityRow,
  createQuantitySheet,
  createCustomBillingSegment,
  normalizeQuantitySheet,
  roomBillingProfile,
  roomBillingUnit,
  validateQuantitySheet,
} from "../../../domain/quantitySheets";
import { QuantityEditorPages, type QuantityRowHandle } from "./components/QuantityEditorPages";
import { ConfirmSave } from "./components/QuantitySheetModals";
import { SavedQuantitySheets } from "./components/SavedQuantitySheets";

const todayMonth = new Date().toISOString().slice(0, 7);
const QUANTITY_ROWS_PER_PAGE = 31;

export function QuantitySheetView({ user, mode }: { user: SessionUser; mode: "entry" | "saved" }) {
  const roomsQuery = useQuantitySheetRooms();
  const identitiesQuery = usePrincipalIdentities();
  const rooms = roomsQuery.data?.items || [];
  const [draft, setDraft] = useState(() => createQuantitySheet(todayMonth, user.displayName));
  const iacucQuery = useIacucSearch(draft.iacuc, 20);
  const [editorRows, setEditorRows] = useState(() => makeEditorRows(draft));
  const [exists, setExists] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error" | "info">("info");
  const [confirmSave, setConfirmSave] = useState<QuantitySheet | null>(null);
  const [editingDialog, setEditingDialog] = useState(false);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const rowRefs = useRef<Array<QuantityRowHandle | null>>([]);
  const selectedRoom = rooms.find((room) => room.id === draft.roomId);
  const unit = roomBillingUnit(selectedRoom);
  const billingProfile = roomBillingProfile(selectedRoom);
  const animalDetails = unit === "animal_day" || draft.animalDetailEnabled;
  const principalIdentity = identitiesQuery.data?.items.find((item) => item.pi.trim() === draft.pi.trim());
  const freeCageAllowance = Number(principalIdentity?.freeCageAllowance ?? 10);
  const supportsFreeCages = billingProfile.freeAllowance && unit === "cage_day" && freeCageAllowance > 0;
  const supportsTierPriority = billingProfile.tiered && unit === "cage_day";
  const freeCageEnabled =
    supportsFreeCages && (Number(draft.preferredFreeCages || 0) > 0 || draft.freeCagePriority !== null);
  const tierPriorityEnabled = supportsTierPriority && draft.tierCagePriority !== null;
  const iacucOptions = useMemo(() => iacucQuery.data?.items || [], [iacucQuery.data?.items]);
  const save = useSaveQuantitySheet();

  const recalculate = useCallback(() => {
    let animals = 0;
    let cages = 0;
    rowRefs.current.forEach((handle) => {
      if (!handle) return;
      const row = handle.getRow();
      const autoAnimals = Math.max(animals + Number(row.addedCount || 0) - Number(row.removedCount || 0), 0);
      animals = row.animalCount == null ? autoAnimals : row.animalCount;
      cages = row.cageCount == null ? (animalDetails ? animals : cages) : row.cageCount;
      handle.setCalculated(animals, cages);
    });
  }, [animalDetails]);

  useEffect(() => {
    recalculate();
  }, [recalculate, editorRows]);

  const customBillingSegmentCount = draft.customBillingSegments.length;

  useEffect(() => {
    if (freeCageEnabled || draft.fullExemption || tierPriorityEnabled || customBillingSegmentCount > 0) {
      setOptionsExpanded(true);
    }
  }, [customBillingSegmentCount, draft.fullExemption, freeCageEnabled, tierPriorityEnabled]);

  function setField<K extends keyof QuantitySheet>(key: K, value: QuantitySheet[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setFreeCageEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      preferredFreeCages: enabled ? current.preferredFreeCages : null,
      freeCagePriority: enabled ? 1 : null,
    }));
  }

  function setFullExemption(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      fullExemption: enabled,
      preferredFreeCages: enabled ? null : current.preferredFreeCages,
      freeCagePriority: enabled ? null : current.freeCagePriority,
      tierCagePriority: enabled ? null : current.tierCagePriority,
    }));
  }

  function setTierPriorityEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      tierCagePriority: enabled ? 1 : null,
    }));
  }

  function addCustomBillingSegment() {
    setDraft((current) => ({
      ...current,
      customBillingEnabled: true,
      customUnitPrice: null,
      customBillingSegments: [
        ...current.customBillingSegments,
        createCustomBillingSegment(current.month, billingProfile.price),
      ],
    }));
  }

  function updateCustomBillingSegment(id: string, update: Partial<CustomBillingSegment>) {
    setDraft((current) => ({
      ...current,
      customBillingSegments: current.customBillingSegments.map((segment) =>
        segment.id === id ? { ...segment, ...update } : segment,
      ),
    }));
  }

  function removeCustomBillingSegment(id: string) {
    setDraft((current) => {
      const customBillingSegments = current.customBillingSegments.filter((segment) => segment.id !== id);
      return {
        ...current,
        customBillingSegments,
        customBillingEnabled: customBillingSegments.length > 0,
        customUnitPrice: customBillingSegments.length ? current.customUnitPrice : null,
      };
    });
  }

  function chooseRoom(roomId: string) {
    const room = rooms.find((item) => item.id === roomId);
    const billingUnit = roomBillingUnit(room);
    const nextBillingProfile = roomBillingProfile(room);
    setDraft((current) => ({
      ...current,
      roomId,
      roomName: room?.name || "",
      manager: user.displayName,
      roomManager: room?.roomManager || "",
      billingUnit,
      animalDetailEnabled: billingUnit === "animal_day" ? true : current.animalDetailEnabled,
      tierCagePriority: nextBillingProfile.tiered && billingUnit === "cage_day" ? current.tierCagePriority : null,
    }));
  }

  function applyIacuc(value: string) {
    const normalized = value.trim().toUpperCase();
    const match = iacucQuery.data?.items.find((item) => item.iacuc.trim().toUpperCase() === normalized);
    setDraft((current) => ({
      ...current,
      iacuc: match?.iacuc || normalized,
      project: match?.project || current.project,
      pi: match?.pi || current.pi,
      owner: match?.owner || current.owner,
      funding: match?.funding || current.funding,
    }));
  }

  function collectSheet() {
    const snapshot = rowRefs.current
      .map((handle) => handle?.getRow())
      .filter((row): row is QuantitySheetRow => Boolean(row));
    const rows = snapshot.filter(hasRowContent);
    return normalizeQuantitySheet({
      ...draft,
      manager: user.displayName,
      roomManager: selectedRoom?.roomManager || "",
      rows,
      pageCount: Math.max(Math.ceil(snapshot.length / QUANTITY_ROWS_PER_PAGE), 1),
      billingUnit: unit,
      animalDetailEnabled: animalDetails,
      updatedAt: draft.updatedAt,
    });
  }

  function requestSave(event: React.FormEvent) {
    event.preventDefault();
    const sheet = collectSheet();
    const issues = validateQuantitySheet(sheet);
    if (issues.length) {
      setNotice(issues.slice(0, 4).join("；"));
      setNoticeKind("error");
      return;
    }
    setConfirmSave(sheet);
  }

  async function persistSheet() {
    if (!confirmSave) return;
    try {
      const response = await save.mutateAsync({ sheet: confirmSave, exists });
      const normalized = normalizeQuantitySheet(response.item);
      const next = createQuantitySheet(normalized.month, user.displayName);
      setDraft(next);
      setEditorRows(makeEditorRows(next));
      setExists(false);
      setConfirmSave(null);
      if (mode === "saved") setEditingDialog(false);
      setNotice(
        unit === "cage_day" && !normalized.rows.some((row) => Number(row.animalCount || 0) > 0)
          ? `${normalized.month} · ${normalized.iacuc} 统计表已保存；当前按结余笼数计算饲养费，录入区已清空。`
          : `${normalized.month} · ${normalized.iacuc} 统计表已保存，录入区已清空。`,
      );
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
      setNoticeKind("error");
      setConfirmSave(null);
    }
  }

  function startNew() {
    const next = createQuantitySheet(todayMonth, user.displayName);
    setDraft(next);
    setEditorRows(makeEditorRows(next));
    setExists(false);
    setNotice("");
    setOptionsExpanded(false);
  }

  function loadForEdit(sheet: QuantitySheet) {
    const next = normalizeQuantitySheet(sheet);
    setDraft(next);
    setEditorRows(makeEditorRows(next));
    setExists(true);
    setOptionsExpanded(hasExpandedBillingOptions(next));
    if (mode === "saved") setEditingDialog(true);
  }

  const entryToolbar =
    mode === "entry" ? (
      <>
        <div className="workspace-toolbar-main quantity-entry-toolbar-main">
          <Tooltip
            content={unit === "animal_day" ? "当前房间按只/天计费，动物数量必须填写。" : "打开后记录动物数量变化。"}
          >
            <div
              className={`quantity-animal-control ${animalDetails ? "enabled" : ""} ${unit === "animal_day" ? "required locked" : ""}`}
            >
              <Switch
                aria-label="动物数量"
                checked={animalDetails}
                disabled={unit === "animal_day"}
                onChange={(checked) => setField("animalDetailEnabled", checked)}
              />
              <span>动物数量</span>
            </div>
          </Tooltip>
        </div>
        <div className="workspace-toolbar-actions quantity-entry-toolbar-actions">
          <div className="workspace-toolbar-action-group">
            <ActionButton className="quantity-entry-toolbar-button" onClick={startNew}>
              新建
            </ActionButton>
            <Tooltip content={saveHint(editorRows, animalDetails)}>
              <AsyncActionButton
                className="primary quantity-entry-toolbar-button quantity-entry-save-button"
                type="submit"
                form="quantity-sheet-entry-form"
                pending={save.isPending}
                pendingLabel="保存中..."
              >
                保存统计表
              </AsyncActionButton>
            </Tooltip>
          </div>
        </div>
      </>
    ) : null;

  function renderEditor(headActions?: React.ReactNode) {
    return (
      <form
        id="quantity-sheet-entry-form"
        className="panel large quantity-editor-panel quantity-entry-panel"
        onSubmit={requestSave}
      >
        <div className="panel-head">
          <div className="panel-title-line">
            <h2>数量统计表（录入）</h2>
          </div>
          {headActions ? <div className="panel-head-actions">{headActions}</div> : null}
        </div>
        {notice ? (
          <div className={`react-inline-notice is-${noticeKind}`} role="status">
            {noticeKind === "success" ? (
              <CheckCircleFilled aria-hidden className="notice-icon" />
            ) : noticeKind === "error" ? (
              <CloseCircleFilled aria-hidden className="notice-icon" />
            ) : (
              <InfoCircleFilled aria-hidden className="notice-icon" />
            )}
            <span>{notice}</span>
          </div>
        ) : null}
        <div className="quantity-sheet-fields">
          <div className="field-cluster quantity-field-cluster">
            <div className="field-cluster-head">
              <strong>基础信息</strong>
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
                  virtual={false}
                  onChange={chooseRoom}
                />
              </label>
              <ReadOnlyField label="登记人员" value={user.displayName} />
              <ReadOnlyField label="房间管理员" value={selectedRoom?.roomManager || ""} placeholder="当前房间未设置" />
            </div>
          </div>
          <div className="field-cluster quantity-field-cluster">
            <div className="field-cluster-head">
              <strong>项目与伦理</strong>
              <span>IACUC 是保存和结算主键</span>
            </div>
            <div className="field-cluster-body quantity-field-group quantity-field-group-project">
              <label className="field-required quantity-ant-field quantity-ant-field-required quantity-iacuc-field">
                <span>IACUC 编号</span>
                <Input
                  aria-label="IACUC 编号"
                  list="quantity-iacuc-options"
                  value={draft.iacuc}
                  required
                  onChange={(event) => setField("iacuc", event.target.value.toUpperCase())}
                  onBlur={(event) => applyIacuc(event.target.value)}
                />
                <datalist id="quantity-iacuc-options">
                  {iacucOptions.map((item, index) => (
                    <option key={`${item.iacuc}-${item.project}-${item.pi}-${index}`} value={item.iacuc}>
                      {item.project || item.pi}
                    </option>
                  ))}
                </datalist>
              </label>
              <AutoFilledField
                label="项目名称"
                value={draft.project}
                onChange={(value) => setField("project", value)}
              />
              <AutoFilledField
                label="支撑经费"
                value={draft.funding}
                onChange={(value) => setField("funding", value)}
              />
              <AutoFilledField label="项目负责人" value={draft.pi} onChange={(value) => setField("pi", value)} />
              <AutoFilledField label="实验负责人" value={draft.owner} onChange={(value) => setField("owner", value)} />
            </div>
          </div>
          <div className={`quantity-options-panel ${optionsExpanded ? "expanded" : "collapsed"}`}>
            <Button
              className="quantity-options-toggle"
              aria-expanded={optionsExpanded}
              aria-controls="quantity-billing-options-panel"
              type="text"
              onClick={() => setOptionsExpanded((current) => !current)}
            >
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
            </Button>
            {optionsExpanded ? (
              <div id="quantity-billing-options-panel" className="quantity-billing-options">
                <div className="quantity-free-cage-module">
                  <div className="quantity-free-cage-head">
                    <div>
                      <strong>优先减免</strong>
                      <span>
                        {draft.fullExemption
                          ? "当前伦理在有效期内产生的饲养费全部减免"
                          : draft.pi
                            ? `项目负责人每日总额度 ${freeCageAllowance} 笼；开启后本伦理优先使用指定额度`
                            : "选择 IACUC 后显示项目负责人减免额度"}
                      </span>
                    </div>
                    <Tooltip
                      content={
                        draft.fullExemption
                          ? "全额减免已开启，普通优先减免暂停使用。"
                          : supportsFreeCages
                            ? "打开后先按本伦理设置的笼数减免。"
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
                      <small>指定额度优先分配给当前伦理号，剩余额度继续自动分配。</small>
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
                    <ActionButton className="compact-action" onClick={addCustomBillingSegment}>
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
            ) : null}
          </div>
        </div>
        <div className="quantity-page-toolbar compact">
          <ActionButton
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

  return (
    <section className="billing-layout quantity-billing-layout react-quantity-layout">
      {mode === "entry" ? (
        <div className="workspace-toolbar quantity-entry-toolbar" data-ui="workspace-toolbar">
          {entryToolbar}
        </div>
      ) : null}
      {mode === "entry" ? renderEditor() : <SavedQuantitySheets onEdit={loadForEdit} />}
      {mode === "saved" && editingDialog ? (
        <ModalShell ariaLabel="编辑数量统计表" className="quantity-edit-modal" onClose={() => setEditingDialog(false)}>
          <div className="modal-shell-head">
            <div>
              <h2>编辑数量统计表</h2>
              <p>
                {draft.month} · {draft.iacuc}
              </p>
            </div>
            <ActionButton onClick={() => setEditingDialog(false)}>关闭</ActionButton>
          </div>
          <div className="modal-shell-body">
            <div className="react-quantity-layout quantity-edit-context">
              {renderEditor(
                <Tooltip content={saveHint(editorRows, animalDetails)}>
                  <ActionButton form="quantity-sheet-entry-form" loading={save.isPending} tone="primary" type="submit">
                    保存统计表
                  </ActionButton>
                </Tooltip>,
              )}
            </div>
          </div>
        </ModalShell>
      ) : null}
      {confirmSave ? (
        <ConfirmSave
          sheet={confirmSave}
          room={selectedRoom}
          onCancel={() => setConfirmSave(null)}
          onConfirm={() => void persistSheet()}
          pending={save.isPending}
        />
      ) : null}
    </section>
  );
}

function AutoFilledField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="quantity-ant-field quantity-auto-field">
      <span>
        {label}
        <Tag variant="filled" className="quantity-field-source" title="选择 IACUC 后自动带入，可按实际情况修订">
          自动带入
        </Tag>
      </span>
      <Input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ReadOnlyField({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  return (
    <label className="quantity-ant-field quantity-readonly-field">
      <span>
        {label}
        <Tag variant="filled" className="quantity-field-source">
          系统带入
        </Tag>
      </span>
      <Input
        aria-label={label}
        className="readonly-field"
        value={value}
        placeholder={placeholder}
        readOnly
        aria-readonly="true"
      />
    </label>
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
              <span>预估 ¥{estimateCustomBillingSegment(segment).toFixed(2)}</span>
            </div>
            <Button danger size="small" onClick={() => onRemoved(segment.id)}>
              删除
            </Button>
          </div>
          <div className="custom-billing-segment-fields">
            <div className="custom-billing-field">
              <span>开始日期</span>
              <Input
                type="date"
                aria-label="开始日期"
                value={segment.startDate}
                onChange={(event) => onChanged(segment.id, { startDate: event.target.value })}
              />
            </div>
            <div className="custom-billing-field">
              <span>结束日期</span>
              <Input
                type="date"
                aria-label="结束日期"
                value={segment.endDate}
                onChange={(event) => onChanged(segment.id, { endDate: event.target.value })}
              />
            </div>
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
function makeEditorRows(sheet: QuantitySheet) {
  const count = Math.max(sheet.pageCount, 1) * QUANTITY_ROWS_PER_PAGE;
  return Array.from({ length: count }, (_, index) => sheet.rows[index] || createQuantityRow(sheet.month, index === 0));
}
function hasRowContent(row: QuantitySheetRow) {
  return Boolean(row.date || row.addedCount || row.removedCount || row.animalCount != null || row.cageCount != null);
}
function saveHint(rows: QuantitySheetRow[], animalDetails: boolean) {
  return `${Math.max(rows.length / QUANTITY_ROWS_PER_PAGE, 1)} 页 · ${rows.filter(hasRowContent).length} 行 · ${animalDetails ? "记录动物数量" : "仅记录笼数"}`;
}

function hasExpandedBillingOptions(sheet: QuantitySheet) {
  return Boolean(
    sheet.fullExemption ||
    sheet.customBillingSegments.length > 0 ||
    sheet.tierCagePriority !== null ||
    Number(sheet.preferredFreeCages || 0) > 0 ||
    sheet.freeCagePriority !== null,
  );
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
