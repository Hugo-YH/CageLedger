import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { QuantitySheetRow } from "../../../api/contracts";

const QUANTITY_ROWS_PER_PAGE = 31;
const QUANTITY_LEFT_ROWS = 15;
const QUANTITY_VISIBLE_ROWS = 16;
const QUANTITY_FIELD_ORDER: Record<string, number> = {
  date: 0,
  addedCount: 1,
  addedType: 2,
  addedTransferIn: 3,
  removedCount: 4,
  removedType: 5,
  removedTransferOut: 6,
  animalCount: 7,
  cageCount: 8,
};
export type QuantityRowHandle = {
  getRow: () => QuantitySheetRow;
  setCalculated: (animals: number, cages: number) => void;
};

export function QuantityEditorPages({
  rows,
  month,
  animalDetails,
  rowRefs,
  onChanged,
}: {
  rows: QuantitySheetRow[];
  month: string;
  animalDetails: boolean;
  rowRefs: React.MutableRefObject<Array<QuantityRowHandle | null>>;
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
  forwardRef<QuantityRowHandle, { row: QuantitySheetRow; index: number; month: string; onChanged: () => void }>(
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
      const handleTab = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Tab") return;
        const scope = event.currentTarget.closest(".quantity-entry-wrap");
        if (!(scope instanceof HTMLElement)) return;
        const focusables = Array.from(scope.querySelectorAll<HTMLElement>('[data-quantity-focusable="true"]'))
          .filter((element) => element.getClientRects().length > 0 && !element.hasAttribute("disabled"))
          .sort((left, right) => {
            const leftPage = Number(left.dataset.quantityPage || 0);
            const rightPage = Number(right.dataset.quantityPage || 0);
            if (leftPage !== rightPage) return leftPage - rightPage;
            const leftRow = Number(left.dataset.quantityRow || 0);
            const rightRow = Number(right.dataset.quantityRow || 0);
            if (leftRow !== rightRow) return leftRow - rightRow;
            const leftOrder = QUANTITY_FIELD_ORDER[left.dataset.quantityField || ""] ?? 99;
            const rightOrder = QUANTITY_FIELD_ORDER[right.dataset.quantityField || ""] ?? 99;
            return leftOrder - rightOrder;
          });
        const currentIndex = focusables.indexOf(event.currentTarget);
        if (currentIndex < 0) return;
        const next = focusables[currentIndex + (event.shiftKey ? -1 : 1)];
        if (!next) return;
        event.preventDefault();
        next.focus();
      };
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
                onKeyDown={handleTab}
                data-quantity-focusable="true"
                data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                data-quantity-row={index}
                data-quantity-field="date"
                onBlur={(event) => {
                  const normalized = normalizeEditorDate(event.currentTarget.value, month);
                  if (normalized) setDate(normalized, normalized);
                }}
              />
              <button
                className="quantity-date-picker-button"
                type="button"
                aria-label={`选择第 ${index + 1} 行日期`}
                tabIndex={-1}
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
                onKeyDown={handleTab}
                data-quantity-focusable="true"
                data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                data-quantity-row={index}
                data-quantity-field="addedCount"
              />
              <select
                aria-label={`第 ${index + 1} 行增加类型`}
                value={row.addedType}
                onChange={(event) => update("addedType", event.target.value)}
                onKeyDown={handleTab}
                data-quantity-focusable="true"
                data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                data-quantity-row={index}
                data-quantity-field="addedType"
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
                  onKeyDown={handleTab}
                  data-quantity-focusable="true"
                  data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                  data-quantity-row={index}
                  data-quantity-field="addedTransferIn"
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
                onKeyDown={handleTab}
                data-quantity-focusable="true"
                data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                data-quantity-row={index}
                data-quantity-field="removedCount"
              />
              <select
                aria-label={`第 ${index + 1} 行减少类型`}
                value={row.removedType}
                onChange={(event) => update("removedType", event.target.value)}
                onKeyDown={handleTab}
                data-quantity-focusable="true"
                data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                data-quantity-row={index}
                data-quantity-field="removedType"
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
                  onKeyDown={handleTab}
                  data-quantity-focusable="true"
                  data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
                  data-quantity-row={index}
                  data-quantity-field="removedTransferOut"
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
              onKeyDown={handleTab}
              data-quantity-focusable="true"
              data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
              data-quantity-row={index}
              data-quantity-field="animalCount"
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
              onKeyDown={handleTab}
              data-quantity-focusable="true"
              data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
              data-quantity-row={index}
              data-quantity-field="cageCount"
            />
          </td>
        </>
      );
    },
  ),
);
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
