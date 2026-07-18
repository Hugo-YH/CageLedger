import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { QuantitySheet, QuantitySheetRow, SessionUser } from "../../api/contracts";
import { usePrincipalIdentities } from "../../api/administration";
import { useIacucIndex } from "../../api/iacuc";
import { useQuantitySheetRooms, useSaveQuantitySheet } from "../../api/quantitySheets";
import { Tooltip } from "../../components/Tooltip";
import { ModalShell } from "../../components/WorkspaceUi";
import {
  createQuantityRow,
  createQuantitySheet,
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
  const iacucQuery = useIacucIndex();
  const identitiesQuery = usePrincipalIdentities();
  const rooms = roomsQuery.data?.items || [];
  const [draft, setDraft] = useState(() => createQuantitySheet(todayMonth, user.displayName));
  const [editorRows, setEditorRows] = useState(() => makeEditorRows(draft));
  const [exists, setExists] = useState(false);
  const [notice, setNotice] = useState("");
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
  const iacucOptions = useMemo(() => {
    const query = draft.iacuc.trim().toUpperCase();
    const items = iacucQuery.data?.items || [];
    return query ? items.filter((item) => item.iacuc.trim().toUpperCase().includes(query)) : items;
  }, [draft.iacuc, iacucQuery.data?.items]);
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

  useEffect(() => {
    if (freeCageEnabled || draft.fullExemption || tierPriorityEnabled || draft.customBillingEnabled) {
      setOptionsExpanded(true);
    }
  }, [draft.customBillingEnabled, draft.fullExemption, freeCageEnabled, tierPriorityEnabled]);

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

  function setCustomBillingEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      customBillingEnabled: enabled,
      customUnitPrice: enabled ? (current.customUnitPrice ?? billingProfile.price) : null,
    }));
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
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
            <label
              className={`quantity-animal-toggle ${animalDetails ? "enabled" : ""} ${unit === "animal_day" ? "required locked" : ""}`}
            >
              <input
                type="checkbox"
                checked={animalDetails}
                disabled={unit === "animal_day"}
                onChange={(event) => setField("animalDetailEnabled", event.target.checked)}
              />
              <span className="quantity-animal-toggle-track" aria-hidden="true">
                <span />
              </span>
              <strong>动物数量</strong>
            </label>
          </Tooltip>
        </div>
        <div className="workspace-toolbar-actions quantity-entry-toolbar-actions">
          <button className="secondary info-button quantity-entry-toolbar-button" type="button" onClick={startNew}>
            新建
          </button>
          <Tooltip content={saveHint(editorRows, animalDetails)}>
            <button
              className="primary quantity-entry-toolbar-button quantity-entry-save-button"
              type="submit"
              form="quantity-sheet-entry-form"
              disabled={save.isPending}
            >
              保存统计表
            </button>
          </Tooltip>
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
          <div className="react-inline-notice" role="status">
            {notice}
          </div>
        ) : null}
        <div className="quantity-sheet-fields">
          <div className="field-cluster quantity-field-cluster">
            <div className="field-cluster-head">
              <strong>基础信息</strong>
              <span>月份和房间决定计费口径</span>
            </div>
            <div className="field-cluster-body quantity-field-group quantity-field-group-basic">
              <label className="field-required">
                月份
                <input
                  type="month"
                  max={todayMonth}
                  value={draft.month}
                  onChange={(event) => {
                    const month = event.target.value;
                    setField("month", month);
                    setEditorRows((rows) =>
                      rows.map((row, index) =>
                        index === 0 ? { ...row, date: `${month}-01`, rawDateInput: `${month}-01` } : row,
                      ),
                    );
                  }}
                />
              </label>
              <label className="field-required">
                房间号
                <select value={draft.roomId} onChange={(event) => chooseRoom(event.target.value)}>
                  <option value="">请选择房间号</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
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
              <label className="field-required">
                IACUC 编号
                <input
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
              <Field label="项目名称" value={draft.project} onChange={(value) => setField("project", value)} />
              <Field label="支撑经费" value={draft.funding} onChange={(value) => setField("funding", value)} />
              <Field label="项目负责人" value={draft.pi} onChange={(value) => setField("pi", value)} />
              <Field label="实验负责人" value={draft.owner} onChange={(value) => setField("owner", value)} />
            </div>
          </div>
          <div className={`quantity-options-panel ${optionsExpanded ? "expanded" : "collapsed"}`}>
            <button
              className="quantity-options-toggle"
              type="button"
              aria-expanded={optionsExpanded}
              aria-controls="quantity-billing-options-panel"
              onClick={() => setOptionsExpanded((current) => !current)}
            >
              <span className="quantity-options-toggle-copy">
                <strong>计费扩展选项</strong>
                {billingOptionsBadges({
                  freeCageEnabled,
                  fullExemption: draft.fullExemption,
                  tierPriorityEnabled,
                  customBillingEnabled: draft.customBillingEnabled,
                }).length ? (
                  <span className="quantity-options-badges" aria-label="已启用计费扩展选项">
                    {billingOptionsBadges({
                      freeCageEnabled,
                      fullExemption: draft.fullExemption,
                      tierPriorityEnabled,
                      customBillingEnabled: draft.customBillingEnabled,
                    }).map((label) => (
                      <span key={label} className="quantity-options-badge">
                        {label}
                      </span>
                    ))}
                  </span>
                ) : (
                  <small>
                    {billingOptionsSummary({
                      freeCageEnabled,
                      fullExemption: draft.fullExemption,
                      tierPriorityEnabled,
                      customBillingEnabled: draft.customBillingEnabled,
                    })}
                  </small>
                )}
              </span>
              <span className="quantity-options-toggle-icon" aria-hidden="true">
                {optionsExpanded ? "收起" : "展开"}
              </span>
            </button>
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
                      <label
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${freeCageEnabled ? "enabled" : ""} ${supportsFreeCages && !draft.fullExemption ? "" : "locked"}`}
                      >
                        <input
                          type="checkbox"
                          checked={freeCageEnabled}
                          disabled={!supportsFreeCages || draft.fullExemption}
                          onChange={(event) => setFreeCageEnabled(event.target.checked)}
                        />
                        <span className="quantity-animal-toggle-track" aria-hidden="true">
                          <span />
                        </span>
                        <span className="quantity-animal-toggle-label">优先减免</span>
                      </label>
                    </Tooltip>
                  </div>
                  {freeCageEnabled ? (
                    <label className="quantity-free-cage-field">
                      优先减免笼数/天
                      <input
                        type="number"
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
                      <label
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${draft.fullExemption ? "enabled" : ""}`}
                      >
                        <input
                          type="checkbox"
                          aria-label="全额减免"
                          checked={draft.fullExemption}
                          onChange={(event) => setFullExemption(event.target.checked)}
                        />
                        <span className="quantity-animal-toggle-track" aria-hidden="true">
                          <span />
                        </span>
                        <span className="quantity-animal-toggle-label">全额减免</span>
                      </label>
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
                      <label
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${tierPriorityEnabled ? "enabled" : ""} ${supportsTierPriority && !draft.fullExemption ? "" : "locked"}`}
                      >
                        <input
                          type="checkbox"
                          aria-label="优先梯度"
                          checked={tierPriorityEnabled}
                          disabled={!supportsTierPriority || draft.fullExemption}
                          onChange={(event) => setTierPriorityEnabled(event.target.checked)}
                        />
                        <span className="quantity-animal-toggle-track" aria-hidden="true">
                          <span />
                        </span>
                        <span className="quantity-animal-toggle-label">优先梯度</span>
                      </label>
                    </Tooltip>
                  </div>
                </div>
                <div className="quantity-free-cage-module quantity-custom-billing-module">
                  <div className="quantity-free-cage-head">
                    <div>
                      <strong>自定义饲养费</strong>
                      <span>
                        标准收费 ¥{billingProfile.price.toFixed(2)} / {unit === "animal_day" ? "只/天" : "笼/天"}
                      </span>
                    </div>
                    <Tooltip content="打开后，当前伦理按输入的自定义标准计费。">
                      <label
                        className={`quantity-animal-toggle quantity-free-cage-toggle ${draft.customBillingEnabled ? "enabled" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={draft.customBillingEnabled}
                          onChange={(event) => setCustomBillingEnabled(event.target.checked)}
                        />
                        <span className="quantity-animal-toggle-track" aria-hidden="true">
                          <span />
                        </span>
                        <span className="quantity-animal-toggle-label">自定义收费</span>
                      </label>
                    </Tooltip>
                  </div>
                  {draft.customBillingEnabled ? (
                    <label className="quantity-free-cage-field">
                      自定义收费标准（元/{unit === "animal_day" ? "只/天" : "笼/天"}）
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={draft.customUnitPrice ?? ""}
                        placeholder="请输入单价"
                        onChange={(event) =>
                          setField("customUnitPrice", event.target.value === "" ? null : Number(event.target.value))
                        }
                      />
                      <small>该单价仅应用于当前统计表对应伦理，结算单会保留实际单价。</small>
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="quantity-page-toolbar compact">
          <button
            className="secondary info-button"
            type="button"
            onClick={() =>
              setEditorRows((rows) => [
                ...rows,
                ...Array.from({ length: QUANTITY_ROWS_PER_PAGE }, () => createQuantityRow(draft.month)),
              ])
            }
          >
            新增统计表页
          </button>
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
      {mode === "entry" ? <div className="workspace-toolbar quantity-entry-toolbar">{entryToolbar}</div> : null}
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
            <button className="secondary" type="button" onClick={() => setEditingDialog(false)}>
              关闭
            </button>
          </div>
          <div className="modal-shell-body">
            <div className="react-quantity-layout quantity-edit-context">
              {renderEditor(
                <Tooltip content={saveHint(editorRows, animalDetails)}>
                  <button className="primary" type="submit" form="quantity-sheet-entry-form" disabled={save.isPending}>
                    {save.isPending ? "保存中..." : "保存统计表"}
                  </button>
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

function Field({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className={required ? "field-required" : undefined}>
      {label}
      <input value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ReadOnlyField({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  return (
    <label>
      {label}
      <input className="readonly-field" value={value} placeholder={placeholder} readOnly aria-readonly="true" />
    </label>
  );
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
    sheet.customBillingEnabled ||
    sheet.tierCagePriority !== null ||
    Number(sheet.preferredFreeCages || 0) > 0 ||
    sheet.freeCagePriority !== null,
  );
}

function billingOptionsSummary({
  freeCageEnabled,
  fullExemption,
  tierPriorityEnabled,
  customBillingEnabled,
}: {
  freeCageEnabled: boolean;
  fullExemption: boolean;
  tierPriorityEnabled: boolean;
  customBillingEnabled: boolean;
}) {
  const active = billingOptionsBadges({
    freeCageEnabled,
    fullExemption,
    tierPriorityEnabled,
    customBillingEnabled,
  });
  return active.length ? `已启用：${active.join("、")}` : "默认收起，按需展开设置优先减免、梯度和自定义收费";
}

function billingOptionsBadges({
  freeCageEnabled,
  fullExemption,
  tierPriorityEnabled,
  customBillingEnabled,
}: {
  freeCageEnabled: boolean;
  fullExemption: boolean;
  tierPriorityEnabled: boolean;
  customBillingEnabled: boolean;
}) {
  return [
    freeCageEnabled ? "优先减免" : "",
    fullExemption ? "全额减免" : "",
    tierPriorityEnabled ? "优先梯度" : "",
    customBillingEnabled ? "自定义收费" : "",
  ].filter(Boolean);
}
