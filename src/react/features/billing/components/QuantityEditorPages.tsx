import { memo } from "react";

import type { QuantitySheetRow } from "../../../api/contracts";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { QuantityEntryCells } from "./QuantityEntryCells";
import { QUANTITY_ROWS_PER_PAGE, type QuantityRowHandle } from "./quantityEntry";

export type { QuantityRowHandle } from "./quantityEntry";

const QUANTITY_LEFT_ROWS = 15;
const QUANTITY_VISIBLE_ROWS = 16;

export const QuantityEditorPages = memo(function QuantityEditorPages({
  rows,
  month,
  animalDetails,
  showCalculatedPlaceholders,
  rowRefs,
  onChanged,
}: {
  rows: QuantitySheetRow[];
  month: string;
  animalDetails: boolean;
  showCalculatedPlaceholders: boolean;
  rowRefs: React.MutableRefObject<Array<QuantityRowHandle | null>>;
  onChanged: () => void;
}) {
  const shortViewport = useMediaQuery("(max-height: 500px)");
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
              data-ui="data-table"
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
                            shortViewport={shortViewport}
                            showCalculatedPlaceholders={showCalculatedPlaceholders}
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
                          shortViewport={shortViewport}
                          showCalculatedPlaceholders={showCalculatedPlaceholders}
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
});

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
