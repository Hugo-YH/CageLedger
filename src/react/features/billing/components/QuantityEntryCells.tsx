import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button, Calendar, Input, Popover, Select } from "antd";
import dayjs from "dayjs";

import type { QuantitySheetRow } from "../../../api/contracts";
import {
  monthEnd,
  normalizeEditorDate,
  QUANTITY_ROWS_PER_PAGE,
  quantityTabTarget,
  type QuantityRowHandle,
} from "./quantityEntry";

export const QuantityEntryCells = memo(
  forwardRef<
    QuantityRowHandle,
    {
      row: QuantitySheetRow;
      index: number;
      month: string;
      shortViewport: boolean;
      showCalculatedPlaceholders: boolean;
      onChanged: () => void;
    }
  >(function QuantityEntryCells(
    { row: initial, index, month, shortViewport, showCalculatedPlaceholders, onChanged },
    ref,
  ) {
    const [row, setRow] = useState(initial);
    const [calculated, setCalculated] = useState({
      animals: Number(initial.animalCount || 0),
      cages: Number(initial.cageCount || 0),
    });
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const datePickerTrigger = useRef<HTMLButtonElement>(null);
    const selectedCalendarDay = useRef<HTMLButtonElement>(null);
    const calendarDate = row.date >= `${month}-01` && row.date <= monthEnd(month) ? row.date : `${month}-01`;
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
      const current =
        event.currentTarget.closest<HTMLElement>('[data-quantity-focusable="true"]') ?? event.currentTarget;
      const next = quantityTabTarget(scope, current, event.shiftKey);
      if (!next) return;
      event.preventDefault();
      (next.querySelector<HTMLElement>("input, button") ?? next).focus({ preventScroll: true });
      // Native focus can reveal only the caret in a horizontally clipped input.
      // Reveal the whole control, including Select's visible shell.
      (next.closest<HTMLElement>(".ant-select") ?? next).scrollIntoView({
        behavior: "instant",
        block: "nearest",
        inline: "nearest",
      });
    };
    return (
      <>
        <td className="quantity-date-cell">
          <div className="quantity-date-field">
            <Input
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
            <Popover
              open={datePickerOpen}
              onOpenChange={setDatePickerOpen}
              afterOpenChange={(open) => {
                if (open) selectedCalendarDay.current?.focus({ preventScroll: true });
              }}
              trigger="click"
              placement={shortViewport ? "right" : "bottom"}
              destroyOnHidden
              content={
                <div className="quantity-date-calendar">
                  <Calendar
                    fullscreen={false}
                    headerRender={() => <strong>{month}</strong>}
                    value={dayjs(calendarDate)}
                    validRange={[dayjs(`${month}-01`), dayjs(monthEnd(month))]}
                    fullCellRender={(date) => {
                      const value = date.format("YYYY-MM-DD");
                      return (
                        <Button
                          size="small"
                          type={value === row.date ? "primary" : "text"}
                          aria-label={value}
                          ref={value === calendarDate ? selectedCalendarDay : undefined}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.stopPropagation();
                              setDatePickerOpen(false);
                              datePickerTrigger.current?.focus({ preventScroll: true });
                            }
                          }}
                          disabled={value < `${month}-01` || value > monthEnd(month)}
                        >
                          {date.date()}
                        </Button>
                      );
                    }}
                    onSelect={(date, info) => {
                      if (info.source !== "date") return;
                      const value = date.format("YYYY-MM-DD");
                      setDate(value, value);
                      setDatePickerOpen(false);
                      datePickerTrigger.current?.focus({ preventScroll: true });
                    }}
                  />
                </div>
              }
            >
              <Button
                ref={datePickerTrigger}
                aria-label={`选择第 ${index + 1} 行日期`}
                className="quantity-date-picker-button"
                htmlType="button"
                icon={<CalendarIcon />}
                size="small"
                type="text"
                aria-expanded={datePickerOpen}
              />
            </Popover>
          </div>
        </td>
        <td className="quantity-change-cell animal-detail-col">
          <div className="quantity-change-editor">
            <Input
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
            <Select
              aria-label={`第 ${index + 1} 行增加类型`}
              className="quantity-type-select"
              options={[
                { label: "类型", value: "" },
                { label: "购入", value: "购入" },
                { label: "转入", value: "转入" },
                { label: "分笼", value: "分笼" },
              ]}
              value={row.addedType}
              onChange={(value) => update("addedType", value)}
              onKeyDown={handleTab}
              data-quantity-focusable="true"
              data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
              data-quantity-row={index}
              data-quantity-field="addedType"
            />
            {row.addedType === "转入" ? (
              <Input
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
            <Input
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
            <Select
              aria-label={`第 ${index + 1} 行减少类型`}
              className="quantity-type-select"
              options={[
                { label: "类型", value: "" },
                { label: "取材", value: "取材" },
                { label: "死亡", value: "死亡" },
                { label: "转出", value: "转出" },
              ]}
              value={row.removedType}
              onChange={(value) => update("removedType", value)}
              onKeyDown={handleTab}
              data-quantity-focusable="true"
              data-quantity-page={Math.floor(index / QUANTITY_ROWS_PER_PAGE)}
              data-quantity-row={index}
              data-quantity-field="removedType"
            />
            {row.removedType === "转出" ? (
              <Input
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
          <Input
            className="quantity-balance-input"
            aria-label={`第 ${index + 1} 行结余总数`}
            type="number"
            min="0"
            placeholder={showCalculatedPlaceholders && calculated.animals > 0 ? String(calculated.animals) : ""}
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
          <Input
            className="quantity-balance-input"
            aria-label={`第 ${index + 1} 行结余笼数`}
            type="number"
            min="0"
            placeholder={showCalculatedPlaceholders && calculated.cages > 0 ? String(calculated.cages) : ""}
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
  }),
);
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h2v3h6V2h2v3h3v17H4V5h3zm11 8H6v10h12zM6 7v1h12V7z" />
    </svg>
  );
}
