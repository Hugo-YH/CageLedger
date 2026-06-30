import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type {
  CageRoom,
  QuantitySheet,
  QuantitySheetListParams,
  QuantitySheetRow,
  SessionUser,
} from "../../api/contracts";
import { requestJson } from "../../api/client";
import { usePrincipalIdentities } from "../../api/administration";
import { useIacucIndex } from "../../api/iacuc";
import {
  useDeleteQuantitySheet,
  useQuantityFilterOptions,
  useQuantitySheetDetail,
  useQuantitySheetRooms,
  useQuantitySheets,
  useSaveQuantitySheet,
} from "../../api/quantitySheets";
import { FilterableTableHeader } from "../../components/FilterableTableHeader";
import { ModalShell } from "../../components/WorkspaceUi";
import { openQuantitySheetsPrint, quantitySheetPagesMarkup } from "../../print/quantitySheets";
import {
  createQuantityRow,
  createQuantitySheet,
  normalizeQuantitySheet,
  roomBillingProfile,
  roomBillingUnit,
  validateQuantitySheet,
} from "../../../domain/quantitySheets";

const todayMonth = new Date().toISOString().slice(0, 7);
const QUANTITY_ROWS_PER_PAGE = 31;
const QUANTITY_LEFT_ROWS = 15;
const QUANTITY_VISIBLE_ROWS = 16;
const pageSize = 5;
type RowHandle = { getRow: () => QuantitySheetRow; setCalculated: (animals: number, cages: number) => void };

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
  const rowRefs = useRef<Array<RowHandle | null>>([]);
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
      setDraft(normalized);
      setEditorRows(makeEditorRows(normalized));
      setExists(true);
      setConfirmSave(null);
      setNotice(
        unit === "cage_day" && !normalized.rows.some((row) => Number(row.animalCount || 0) > 0)
          ? "统计表已保存；当前按结余笼数计算饲养费。"
          : "数量统计表已保存。",
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
                  {(iacucQuery.data?.items || []).slice(0, 500).map((item, index) => (
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

function QuantityEditorPages({
  rows,
  month,
  animalDetails,
  rowRefs,
  onChanged,
}: {
  rows: QuantitySheetRow[];
  month: string;
  animalDetails: boolean;
  rowRefs: React.MutableRefObject<Array<RowHandle | null>>;
  onChanged: () => void;
}) {
  const pageCount = Math.max(Math.ceil(rows.length / QUANTITY_ROWS_PER_PAGE), 1);
  return (
    <div className="quantity-entry-wrap">
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const pageStart = pageIndex * QUANTITY_ROWS_PER_PAGE;
        return (
          <div className="quantity-template-page" key={pageIndex}>
            <div className="quantity-template-page-title">第 {pageIndex + 1} 页</div>
            <div
              className="table-wrap"
              role="region"
              tabIndex={0}
              aria-label={`数量统计表第 ${pageIndex + 1} 页录入区`}
            >
              <table
                className={`quantity-entry-table quantity-template-table ${animalDetails ? "animal-details-enabled" : "animal-details-hidden"}`}
              >
                <thead>
                  <tr>
                    <QuantityTableHeaders />
                    <QuantityTableHeaders />
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: QUANTITY_VISIBLE_ROWS }, (_, rowIndex) => {
                    const leftIndex = rowIndex < QUANTITY_LEFT_ROWS ? pageStart + rowIndex : null;
                    const rightIndex = pageStart + QUANTITY_LEFT_ROWS + rowIndex;
                    return (
                      <tr key={rowIndex}>
                        {leftIndex == null ? (
                          <QuantityEmptyCells />
                        ) : (
                          <QuantityEntryCells
                            key={rows[leftIndex].id}
                            ref={(handle) => {
                              rowRefs.current[leftIndex] = handle;
                            }}
                            row={rows[leftIndex]}
                            index={leftIndex}
                            month={month}
                            onChanged={onChanged}
                          />
                        )}
                        <QuantityEntryCells
                          key={rows[rightIndex].id}
                          ref={(handle) => {
                            rowRefs.current[rightIndex] = handle;
                          }}
                          row={rows[rightIndex]}
                          index={rightIndex}
                          month={month}
                          onChanged={onChanged}
                        />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QuantityTableHeaders() {
  return (
    <>
      <th>日期</th>
      <th className="animal-detail-col">
        新增
        <br />
        （购/转/分）
      </th>
      <th className="animal-detail-col">
        减少
        <br />
        （取/死/转）
      </th>
      <th className="animal-detail-col">
        结余
        <br />
        总数
      </th>
      <th>
        结余
        <br />
        笼数
      </th>
    </>
  );
}

function QuantityEmptyCells() {
  return (
    <>
      <td className="quantity-date-cell quantity-empty-calendar-cell" />
      <td className="quantity-change-cell animal-detail-col" />
      <td className="quantity-change-cell animal-detail-col" />
      <td className="animal-detail-col" />
      <td />
    </>
  );
}

const QuantityEntryCells = memo(
  forwardRef<RowHandle, { row: QuantitySheetRow; index: number; month: string; onChanged: () => void }>(
    function QuantityEntryCells({ row: initial, index, month, onChanged }, ref) {
      const [row, setRow] = useState(initial);
      const [calculated, setCalculated] = useState({
        animals: Number(initial.animalCount || 0),
        cages: Number(initial.cageCount || 0),
      });
      const pickerRef = useRef<HTMLInputElement>(null);
      useImperativeHandle(
        ref,
        () => ({
          getRow: () => row,
          setCalculated: (animals, cages) =>
            setCalculated((current) =>
              current.animals === animals && current.cages === cages ? current : { animals, cages },
            ),
        }),
        [row],
      );
      useEffect(() => {
        onChanged();
      }, [row, onChanged]);
      const update = (key: keyof QuantitySheetRow, value: string | number | null) =>
        setRow((current) => ({
          ...current,
          [key]: value,
          balanceSource: key === "animalCount" || key === "cageCount" ? "manual" : current.balanceSource,
        }));
      const count = (value: string) => (value === "" ? null : Math.max(Number(value), 0));
      const setDate = (rawDateInput: string, date = normalizeEditorDate(rawDateInput, month)) =>
        setRow((current) => ({ ...current, rawDateInput, date }));
      return (
        <>
          <td className="quantity-date-cell">
            <div className="quantity-date-field">
              <input
                name="rowDate"
                aria-label={`第 ${index + 1} 行日期`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder=""
                value={row.rawDateInput || row.date}
                onChange={(event) => setDate(event.target.value)}
              />
              <button
                className="quantity-date-picker-button"
                type="button"
                aria-label={`选择第 ${index + 1} 行日期`}
                onClick={() => pickerRef.current?.showPicker()}
              >
                <CalendarIcon />
              </button>
              <input
                ref={pickerRef}
                className="quantity-date-picker-native"
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                min={`${month}-01`}
                max={monthEnd(month)}
                value={row.date}
                onChange={(event) => setDate(event.target.value, event.target.value)}
              />
            </div>
          </td>
          <td className="quantity-change-cell animal-detail-col">
            <div className="quantity-change-editor">
              <input
                aria-label={`第 ${index + 1} 行增加`}
                type="number"
                min="0"
                value={row.addedCount ?? ""}
                onChange={(event) => update("addedCount", count(event.target.value))}
              />
              <select
                aria-label={`第 ${index + 1} 行增加类型`}
                value={row.addedType}
                onChange={(event) => update("addedType", event.target.value)}
              >
                <option value="">类型</option>
                <option>购入</option>
                <option>转入</option>
                <option>分笼</option>
              </select>
              {row.addedType === "转入" ? (
                <input
                  className="iacuc-lookup"
                  aria-label={`第 ${index + 1} 行转入伦理号`}
                  value={row.transferInFromIacuc}
                  onChange={(event) => update("transferInFromIacuc", event.target.value.toUpperCase())}
                />
              ) : null}
            </div>
          </td>
          <td className="quantity-change-cell animal-detail-col">
            <div className="quantity-change-editor">
              <input
                aria-label={`第 ${index + 1} 行减少`}
                type="number"
                min="0"
                value={row.removedCount ?? ""}
                onChange={(event) => update("removedCount", count(event.target.value))}
              />
              <select
                aria-label={`第 ${index + 1} 行减少类型`}
                value={row.removedType}
                onChange={(event) => update("removedType", event.target.value)}
              >
                <option value="">类型</option>
                <option>取材</option>
                <option>死亡</option>
                <option>转出</option>
              </select>
              {row.removedType === "转出" ? (
                <input
                  className="iacuc-lookup"
                  aria-label={`第 ${index + 1} 行转出伦理号`}
                  value={row.transferOutToIacuc}
                  onChange={(event) => update("transferOutToIacuc", event.target.value.toUpperCase())}
                />
              ) : null}
            </div>
          </td>
          <td className="animal-detail-col">
            <input
              className="quantity-balance-input"
              aria-label={`第 ${index + 1} 行结余总数`}
              type="number"
              min="0"
              placeholder={calculated.animals > 0 ? String(calculated.animals) : ""}
              value={row.animalCount ?? ""}
              onChange={(event) => update("animalCount", count(event.target.value))}
            />
          </td>
          <td>
            <input
              className="quantity-balance-input"
              aria-label={`第 ${index + 1} 行结余笼数`}
              type="number"
              min="0"
              placeholder={calculated.cages > 0 ? String(calculated.cages) : ""}
              value={row.cageCount ?? ""}
              onChange={(event) => update("cageCount", count(event.target.value))}
            />
          </td>
        </>
      );
    },
  ),
);

function SavedQuantitySheets({ onEdit }: { onEdit: (sheet: QuantitySheet) => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [viewId, setViewId] = useState("");
  const [editId, setEditId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const params: QuantitySheetListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useQuantitySheets(params);
  const detail = useQuantitySheetDetail(viewId || editId);
  const remove = useDeleteQuantitySheet();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  useEffect(() => {
    if (editId && detail.data?.item) {
      onEdit(detail.data.item);
      setEditId("");
    }
  }, [detail.data, editId, onEdit]);

  async function exportSelected() {
    const sheets = await Promise.all(
      selected.map((id) =>
        requestJson<{ item: QuantitySheet }>(`/api/quantity-sheets/${encodeURIComponent(id)}`).then(
          (response) => response.item,
        ),
      ),
    );
    openQuantitySheetsPrint(sheets);
  }

  return (
    <section className="panel quantity-saved-panel">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>已保存数量统计表</h2>
        </div>
        <div className="panel-head-actions">
          <span className="panel-summary-chip">
            {total} 条 · 已选 {selected.length}
          </span>
          <button
            className="secondary info-button"
            type="button"
            disabled={!selected.length}
            onClick={() => void exportSelected()}
          >
            导出数量统计表 PDF
          </button>
        </div>
      </div>
      <div className="list-meta">
        <span>{list.isFetching ? "正在加载" : `当前加载 ${items.length} 条`}</span>
        <span>
          第 {page} / {pages} 页
        </span>
      </div>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="已保存数量统计表">
        <table className="dense-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label="全选当前页统计表"
                  type="checkbox"
                  checked={items.length > 0 && items.every((item) => selected.includes(item.id))}
                  onChange={(event) => setSelected(event.target.checked ? items.map((item) => item.id) : [])}
                />
              </th>
              {[
                ["month", "月份"],
                ["iacuc", "IACUC"],
                ["roomName", "房间"],
                ["pi", "负责人"],
                ["updatedAt", "更新时间"],
              ].map(([key, label]) => (
                <QuantityHeader
                  key={key}
                  column={key}
                  label={label}
                  params={params}
                  values={filters[key] || []}
                  onSort={() => {
                    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
                    setPage(1);
                  }}
                  onFilter={(values) => {
                    setFilters((current) => ({ ...current, [key]: values }));
                    setPage(1);
                  }}
                />
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      aria-label={`选择 ${item.iacuc}`}
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...new Set([...current, item.id])]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                  </td>
                  <td>{item.month}</td>
                  <td>{item.iacuc}</td>
                  <td>{item.roomName || "-"}</td>
                  <td>{item.pi || "-"}</td>
                  <td>{formatTime(item.updatedAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="secondary info-button compact"
                        type="button"
                        onClick={() => setViewId(item.id)}
                      >
                        预览
                      </button>
                      <button
                        className="secondary info-button compact"
                        type="button"
                        onClick={() => setEditId(item.id)}
                      >
                        编辑
                      </button>
                      <button className="ghost danger-text compact" type="button" onClick={() => setDeleteId(item.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>当前没有已保存数量统计表。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>共 {total} 条</span>
        <div>
          <button
            className="secondary"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            上一页
          </button>
          <button
            className="secondary"
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      </div>
      {viewId ? (
        <QuantityPreviewModal sheet={detail.data?.item} loading={detail.isPending} onClose={() => setViewId("")} />
      ) : null}
      {deleteId ? (
        <ModalShell ariaLabel="删除数量统计表" onClose={() => setDeleteId("")}>
          <div className="modal-shell-head">
            <h2>删除数量统计表</h2>
          </div>
          <div className="modal-shell-body">
            <p>删除后，该统计表将退出结算合表范围。</p>
          </div>
          <div className="modal-shell-actions">
            <button className="secondary" type="button" onClick={() => setDeleteId("")}>
              取消
            </button>
            <button
              className="danger"
              type="button"
              onClick={async () => {
                await remove.mutateAsync(deleteId);
                setSelected((current) => current.filter((id) => id !== deleteId));
                setDeleteId("");
              }}
            >
              确认删除
            </button>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

function QuantityHeader({
  column,
  label,
  params,
  values,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  params: QuantitySheetListParams;
  values: string[];
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useQuantityFilterOptions(params, column, open);
  return (
    <FilterableTableHeader
      label={label}
      values={values}
      options={options.data?.items || []}
      loading={options.isFetching}
      onOpenChange={setOpen}
      onSort={onSort}
      onFilter={onFilter}
    />
  );
}

function QuantityPreviewModal({
  sheet,
  loading,
  onClose,
}: {
  sheet?: QuantitySheet;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <ModalShell ariaLabel="预览数量统计表" className="quantity-react-preview" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>预览数量统计表</h2>
          <p>{sheet ? `${sheet.month} · ${sheet.iacuc}` : "正在加载"}</p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="modal-shell-body">
        {loading || !sheet ? <div className="empty-state">正在加载...</div> : <QuantityPreview sheet={sheet} />}
      </div>
    </ModalShell>
  );
}

function QuantityPreview({ sheet }: { sheet: QuantitySheet }) {
  return (
    <div className="quantity-stat-preview" dangerouslySetInnerHTML={{ __html: quantitySheetPagesMarkup([sheet]) }} />
  );
}

function ConfirmSave({
  sheet,
  room,
  pending,
  onCancel,
  onConfirm,
}: {
  sheet: QuantitySheet;
  room?: CageRoom;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const filled = sheet.rows.filter(hasRowContent).length;
  const profile = roomBillingProfile(room);
  return (
    <ModalShell ariaLabel="确认保存数量统计表" className="quantity-save-confirm" onClose={onCancel}>
      <div className="modal-shell-head">
        <div>
          <span className="workspace-kicker">保存前核对</span>
          <h2>确认保存数量统计表</h2>
        </div>
      </div>
      <div className="modal-shell-body">
        <div className="quantity-confirm-profile">
          <div>
            <strong>{room?.name || "未选择房间"}</strong>
            <span>
              {profile.facilityLabel} · {profile.item} · {profile.customerLabel}
            </span>
          </div>
          <strong>
            ¥{profile.price.toFixed(2)} / {profile.unit === "animal_day" ? "只/天" : "笼/天"}
          </strong>
        </div>
        <dl className="quantity-confirm-grid">
          <div>
            <dt>月份</dt>
            <dd>{sheet.month}</dd>
          </div>
          <div>
            <dt>IACUC</dt>
            <dd>{sheet.iacuc}</dd>
          </div>
          <div>
            <dt>项目负责人</dt>
            <dd>{sheet.pi || "-"}</dd>
          </div>
          <div>
            <dt>有效明细</dt>
            <dd>{filled} 行</dd>
          </div>
        </dl>
      </div>
      <div className="modal-shell-actions">
        <button className="secondary" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="primary" type="button" disabled={pending} onClick={onConfirm}>
          确认保存
        </button>
      </div>
    </ModalShell>
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
function monthEnd(month: string) {
  const [year, value] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, "0")}`;
}
function normalizeEditorDate(value: string, month: string) {
  const raw = value.trim().replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
  if (!raw) return "";
  const day = /^\d{1,2}$/.test(raw) ? Number(raw) : null;
  const parts = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  const candidate =
    day == null
      ? parts
        ? `${parts[1]}-${String(Number(parts[2])).padStart(2, "0")}-${String(Number(parts[3])).padStart(2, "0")}`
        : ""
      : `${month}-${String(day).padStart(2, "0")}`;
  return candidate >= `${month}-01` && candidate <= monthEnd(month) ? candidate : "";
}
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h2v3h6V2h2v3h3v17H4V5h3zm11 8H6v10h12zM6 7v1h12V7z" />
    </svg>
  );
}
function saveHint(rows: QuantitySheetRow[], animalDetails: boolean) {
  return `${Math.max(rows.length / QUANTITY_ROWS_PER_PAGE, 1)} 页 · ${rows.filter(hasRowContent).length} 行 · ${animalDetails ? "记录动物数量" : "仅记录笼数"}`;
}
function formatTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}
