import { useQuery } from "@tanstack/react-query";

import { requestJson } from "../../api/client";

type CageCardDetails = Record<string, string | number | null | undefined>;

export function PublicScanView({ qrId = routeQrId() }: { qrId?: string }) {
  const details = useQuery({
    queryKey: ["public-cage-card", qrId],
    queryFn: () => requestJson<CageCardDetails>(`/api/public/cage-card/${encodeURIComponent(qrId)}`),
    enabled: Boolean(qrId),
    retry: false,
  });
  const item = details.data || {};
  const rows: Array<[string, unknown]> = [
    ["笼号", item.cageCode || item.slotCode],
    ["房间", item.roomName],
    ["笼架/笼位", [item.rackName, item.slotCode].filter(Boolean).join(" · ")],
    ["IACUC 编号", item.iacuc],
    ["项目名称", item.project],
    ["项目负责人", item.pi],
    ["实验负责人", item.owner],
    ["动物品系", item.strainStandard || item.speciesLabel || item.species],
    ["数量", item.animalCount ? `${item.animalCount} 只` : ""],
    ["性别", item.sex],
    ["出生日期/年龄", [item.birthDate, item.age].filter(Boolean).join(" · ")],
    ["入驻日期", item.startDate || item.actualMoveInDate],
    ["预计结束日期", item.endDate],
  ];
  return (
    <main className="public-scan-page">
      <section className="public-scan-card">
        <div className="public-scan-brand">
          <img src="/cageledger-icon.svg" alt="" />
          <div>
            <strong>CageLedger</strong>
            <span>实验动物笼卡扫码查询</span>
          </div>
        </div>
        {details.isPending ? (
          <div className="public-scan-state">正在读取笼卡信息...</div>
        ) : details.error ? (
          <div className="public-scan-state error">
            <h1>未找到笼卡信息</h1>
            <p>{details.error.message}</p>
            <small>{qrId}</small>
          </div>
        ) : (
          <>
            <div className="public-scan-header">
              <div>
                <span className="public-scan-eyebrow">当前状态</span>
                <h1>{String(item.batchNo || item.qrId || "笼卡详情")}</h1>
              </div>
              <span className="public-scan-status">{String(item.statusLabel || "待接收")}</span>
            </div>
            <dl className="public-scan-grid">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{String(value || "-")}</dd>
                </div>
              ))}
            </dl>
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
