import type { IntakeBatchListItem } from "../../../contracts/intake";

/** Types do not strip full write responses; selection must retain only its declared summary. */
export function intakeBatchSummary(item: IntakeBatchListItem): IntakeBatchListItem {
  return {
    id: item.id,
    intakePurpose: item.intakePurpose,
    quarantineStatus: item.quarantineStatus,
    quarantineBatches: item.quarantineBatches?.map(({ id, name, completedAt }) => ({ id, name, completedAt })),
    purchaseOrderNo: item.purchaseOrderNo,
    orderNo: item.orderNo,
    batchNo: item.batchNo,
    iacuc: item.iacuc,
    supplier: item.supplier,
    species: item.species,
    strainRaw: item.strainRaw,
    strainStandard: item.strainStandard,
    sex: item.sex,
    quantity: item.quantity,
    roomName: item.roomName,
    intakeDate: item.intakeDate,
    pi: item.pi,
    owner: item.owner,
    status: item.status,
    notes: item.notes,
    finalCardCount: item.finalCardCount,
    confirmedCardCount: item.confirmedCardCount,
    remainingCardCount: item.remainingCardCount,
    updatedAt: item.updatedAt,
    ...(item.batchNumberInfo ? { batchNumberInfo: { ...item.batchNumberInfo } } : {}),
  };
}
