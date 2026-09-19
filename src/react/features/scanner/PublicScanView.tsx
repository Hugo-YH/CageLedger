import { Button, Descriptions, Result, Skeleton, Tag } from "antd";

import { usePublicCageCard } from "../../api/cageCard";

export function PublicScanView({ qrId = routeQrId() }: { qrId?: string }) {
  const details = usePublicCageCard(qrId);
  const item = details.data;
  const rows: Array<[string, unknown]> = [
    ["笼号", item?.cageCode || item?.slotCode],
    ["房间", item?.roomName],
    ["笼架/笼位", [item?.rackName, item?.slotCode].filter(Boolean).join(" · ")],
    ["IACUC 编号", item?.iacuc],
    ["项目名称", item?.project],
    ["项目负责人", item?.pi],
    ["实验负责人", item?.owner],
    ["动物品系", item?.strainStandard || item?.speciesLabel || item?.species],
    ["数量", item?.animalCount == null || item.animalCount === "" ? "" : `${item.animalCount} 只`],
    ["性别", item?.sex],
    ["出生日期/年龄", [item?.birthDate, item?.age].filter(Boolean).join(" · ")],
    ["入驻日期", item?.startDate || item?.actualMoveInDate],
    ["预计结束日期", item?.endDate],
  ];
  return (
    <main className="public-scan-page" data-feature="public-scan">
      <section className="public-scan-card">
        <div className="public-scan-brand">
          <img src="/cageledger-icon.svg" alt="" />
          <div>
            <strong>CageLedger</strong>
            <span>实验动物笼卡扫码查询</span>
          </div>
        </div>
        {details.isPending ? (
          <div aria-busy="true" aria-label="笼卡信息正在加载" className="public-scan-state" role="status">
            <span className="app-visually-hidden">笼卡信息正在加载</span>
            <Skeleton active paragraph={{ rows: 5 }} title={{ width: "42%" }} />
          </div>
        ) : details.error ? (
          <Result
            status="warning"
            title={<h1>未找到笼卡信息</h1>}
            subTitle={
              <>
                <p>{details.error.message}</p>
                <small>{qrId}</small>
              </>
            }
            extra={
              <Button loading={details.isFetching} onClick={() => void details.refetch()}>
                重试
              </Button>
            }
          />
        ) : (
          <>
            <div className="public-scan-header">
              <div>
                <span className="public-scan-eyebrow">当前状态</span>
                <h1>{item?.batchNo || item?.qrId || "笼卡详情"}</h1>
              </div>
              <Tag>{item?.statusLabel || "状态未知"}</Tag>
            </div>
            <Descriptions
              bordered
              column={{ xs: 1, sm: 1, md: 2 }}
              items={rows.map(([label, value]) => ({
                key: label,
                label,
                children: value === "" || value == null ? "-" : String(value),
              }))}
            />
          </>
        )}
      </section>
    </main>
  );
}

function routeQrId() {
  return decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) || "")
    .trim()
    .toUpperCase();
}
