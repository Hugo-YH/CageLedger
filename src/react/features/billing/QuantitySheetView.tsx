import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { QuantitySheet, QuantitySheetRow, SessionUser } from "../../api/contracts";
import { usePrincipalIdentities } from "../../api/administration";
import { useIacucIndex } from "../../api/iacuc";
import { useQuantitySheetRooms, useSaveQuantitySheet } from "../../api/quantitySheets";
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

export function QuantitySheetView({ user }: { user: SessionUser }) {
  const roomsQuery = useQuantitySheetRooms();
  const iacucQuery = useIacucIndex();
  const identitiesQuery = usePrincipalIdentities();
  const rooms = roomsQuery.data?.items || [];
  const [draft, setDraft] = useState(() => createQuantitySheet(todayMonth, user.displayName));
  const [editorRows, setEditorRows] = useState(() => makeEditorRows(draft));
  const [exists, setExists] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmSave, setConfirmSave] = useState<QuantitySheet | null>(null);
  const rowRefs = useRef<Array<QuantityRowHandle | null>>([]);
  const selectedRoom = rooms.find((room) => room.id === draft.roomId);
  const unit = roomBillingUnit(selectedRoom);
  const billingProfile = roomBillingProfile(selectedRoom);
  const animalDetails = unit === "animal_day" || draft.animalDetailEnabled;
  const principalIdentity = identitiesQuery.data?.items.find((item) => item.pi.trim() === draft.pi.trim());
  const freeCageAllowance = Number(principalIdentity?.freeCageAllowance ?? 10);
  const supportsFreeCages =
    billingProfile.item === "小鼠饲养费" &&
    billingProfile.customerType === "internal" &&
    unit === "cage_day" &&
    freeCageAllowance > 0;
  const freeCageEnabled =
    supportsFreeCages && (Number(draft.preferredFreeCages || 0) > 0 || draft.freeCagePriority !== null);
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

  function chooseRoom(roomId: string) {
    const room = rooms.find((item) => item.id === roomId);
    const billingUnit = roomBillingUnit(room);
    setDraft((current) => ({
      ...current,
      roomId,
      roomName: room?.name || "",
      billingUnit,
      animalDetailEnabled: billingUnit === "animal_day" ? true : current.animalDetailEnabled,
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
      rows,
      pageCount: Math.max(Math.ceil(snapshot.length / QUANTITY_ROWS_PER_PAGE), 1),
      billingUnit: unit,
      animalDetailEnabled: animalDetails,
      updatedAt: new Date().toISOString(),
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
  }

  function loadForEdit(sheet: QuantitySheet) {
    const next = normalizeQuantitySheet(sheet);
    setDraft(next);
    setEditorRows(makeEditorRows(next));
    setExists(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="billing-layout quantity-billing-layout react-quantity-layout">
      <form className="panel large quantity-editor-panel quantity-entry-panel" onSubmit={requestSave}>
        <div className="panel-head">
          <div className="panel-title-line">
            <h2>数量统计表（录入）</h2>
          </div>
          <div className="panel-head-actions quantity-sheet-head-actions">
            <label
              className={`quantity-animal-toggle ${animalDetails ? "enabled" : ""} ${unit === "animal_day" ? "required locked" : ""}`}
              title={unit === "animal_day" ? "当前房间按只/天计费，动物数量必须填写。" : "打开后记录动物数量变化。"}
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
            <button className="secondary info-button" type="button" onClick={startNew}>
              新建
            </button>
            <button
              className="primary"
              type="submit"
              disabled={save.isPending}
              title={saveHint(editorRows, animalDetails)}
            >
              保存统计表
            </button>
          </div>
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
              <Field label="管理员" value={draft.manager} onChange={(value) => setField("manager", value)} />
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
          <div className={`quantity-free-cage-module ${supportsFreeCages ? "" : "muted-field"}`}>
            <div className="quantity-free-cage-head">
              <div>
                <strong>优先减免</strong>
                <span>
                  {draft.pi
                    ? `项目负责人每日总额度 ${freeCageAllowance} 笼；开启后本伦理优先使用指定额度`
                    : "选择 IACUC 后显示项目负责人减免额度"}
                </span>
              </div>
              <label
                className={`quantity-animal-toggle quantity-free-cage-toggle ${freeCageEnabled ? "enabled" : ""} ${supportsFreeCages ? "" : "locked"}`}
                title={supportsFreeCages ? "打开后先按本伦理设置的笼数减免。" : "当前计费口径没有项目负责人减免额度。"}
              >
                <input
                  type="checkbox"
                  checked={freeCageEnabled}
                  disabled={!supportsFreeCages}
                  onChange={(event) => setFreeCageEnabled(event.target.checked)}
                />
                <span className="quantity-animal-toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="quantity-animal-toggle-label">优先减免</span>
              </label>
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
          rowRefs={rowRefs}
          onChanged={recalculate}
        />
      </form>
      <SavedQuantitySheets onEdit={loadForEdit} />
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
