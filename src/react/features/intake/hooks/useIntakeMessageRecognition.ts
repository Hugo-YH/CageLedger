import { useRef, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { IntakeBatch } from "../../../../contracts/intake";
import type { SessionUser } from "../../../../contracts/session";
import { intakePeople } from "../../../../domain/intakePeople";
import {
  abbreviateSupplier,
  intakeBatchIacucs,
  intakeIdentifierLimitMessage,
  normalizeIntakeBatch,
  parseIntakeMessage,
  parseIntakeOrderIdentifiers,
} from "../../../../domain/intake";
import { aiParseIntakeMessage, standardizeIntakeStrain } from "../../../api/intake";
import { fetchIacucSearch } from "../../../api/iacuc";
import { queryKeys } from "../../../api/queryKeys";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import type { useIntakeRecognition } from "./useIntakeRecognition";

type ProjectMatch = { project?: string; pi?: string; owner?: string } | undefined;

export function useIntakeMessageRecognition({
  draft,
  user,
  mode,
  editing,
  roomNames,
  revision,
  recognition,
  requireRooms,
  replaceDraft,
  setNotice,
  onTextRecognized,
}: {
  draft: IntakeBatch;
  user: SessionUser;
  mode: "entry" | "batches";
  editing: boolean;
  roomNames: string[];
  revision: RefObject<number>;
  recognition: ReturnType<typeof useIntakeRecognition>;
  requireRooms: () => boolean;
  replaceDraft: (item: IntakeBatch) => void;
  setNotice: (notice: string) => void;
  onTextRecognized: (item: IntakeBatch, excludeId?: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const feedback = useOperationFeedback();
  const requests = useLatestRequest();
  const localRequest = useRef<{ key: string; promise: Promise<void> } | null>(null);

  function normalizeParsedMessage(parsed: Partial<IntakeBatch>) {
    const normalized = normalizeIntakeBatch(
      { ...parsed, supplier: abbreviateSupplier(parsed.supplier || ""), rawMessage: draft.rawMessage },
      roomNames,
    );
    const limitMessage = intakeIdentifierLimitMessage(normalized);
    if (limitMessage) throw new Error(limitMessage);
    return normalized;
  }

  async function findProject(parsed: Partial<IntakeBatch>, normalized: IntakeBatch): Promise<ProjectMatch> {
    const multipleIacucs = intakeBatchIacucs(normalized.batchNo).length > 1;
    const normalizedCode = String(multipleIacucs ? "" : parsed.iacuc || "")
      .trim()
      .toUpperCase();
    if (normalizedCode) {
      const result = await queryClient.ensureQueryData({
        queryKey: queryKeys.iacucSearch(normalizedCode, 1),
        queryFn: ({ signal }) => fetchIacucSearch(normalizedCode, 1, signal),
        staleTime: 5 * 60_000,
      });
      return result.items.find(
        (candidate) =>
          String(candidate.iacuc || "")
            .trim()
            .toUpperCase() === normalizedCode,
      );
    }
  }

  async function applyParsedMessage(
    parsed: Partial<IntakeBatch>,
    valid: () => boolean,
    preloaded?: { match: ProjectMatch },
  ) {
    const normalized = normalizeParsedMessage(parsed);
    const multipleIacucs = intakeBatchIacucs(normalized.batchNo).length > 1;
    const match = preloaded ? preloaded.match : await findProject(parsed, normalized);
    if (!valid()) return null;
    const isEditingSavedBatch = editing;
    const item = normalizeIntakeBatch(
      {
        ...draft,
        ...normalized,
        ...(multipleIacucs ? { iacuc: "", project: "" } : {}),
        husbandryMonths: normalized.husbandryMonths ?? null,
        id: isEditingSavedBatch ? draft.id : String(normalized.id || draft.id),
        receiverName: normalized.receiverName || (isEditingSavedBatch ? draft.receiverName : user.displayName),
        vetPhone: normalized.vetPhone || (isEditingSavedBatch ? draft.vetPhone : user.phone),
        project: multipleIacucs ? "" : match?.project || normalized.project,
        ...intakePeople(draft, normalized, match),
      },
      roomNames,
    );
    replaceDraft(item);
    const strainRaw = String(normalized.strainRaw || "").trim();
    const strainStandard = String(normalized.strainStandard || "").trim();
    const strainNote =
      strainRaw && strainStandard && strainRaw !== strainStandard ? `，品系已按 MGI 标准化为 ${strainStandard}` : "";
    return {
      item,
      batchNo: Boolean(normalized.batchNo),
      strainNote,
      excludeId: isEditingSavedBatch ? draft.id : undefined,
      multipleIacucs,
      multipleIdentifiers: Boolean(item.identifiers),
    };
  }

  async function recognizeLocalMessage() {
    if (parseIntakeOrderIdentifiers(draft.rawMessage).hasConflict) {
      requests.invalidate();
      feedback.warning("采购与订单编号需核对", "采购单号与订单编号不对应，请核对后再识别。");
      return;
    }
    const startedRevision = revision.current;
    const isCurrentRequest = requests.begin();
    const valid = () => isCurrentRequest() && startedRevision === revision.current;
    try {
      let parsed = parseIntakeMessage(draft.rawMessage, user.displayName, roomNames);
      const normalized = normalizeParsedMessage(parsed);
      const [strain, match] = await Promise.all([
        parsed.strainRaw && parsed.strainStandard === parsed.strainRaw
          ? standardizeIntakeStrain(parsed.strainRaw)
          : undefined,
        findProject(parsed, normalized),
      ]);
      if (!valid()) return;
      if (strain) parsed = { ...parsed, strainStandard: strain.item || parsed.strainStandard };
      const info = await applyParsedMessage(parsed, valid, { match });
      if (!info) return;
      if (info.multipleIacucs) {
        const message = "已保留全部编号，但包含不同 IACUC，请按项目拆分预约后保存。";
        setNotice(message);
        feedback.warning("请核对预约项目", message);
        return;
      }
      setNotice("");
      feedback.info(
        "预约消息已识别",
        info.multipleIdentifiers
          ? `已识别同一预约的多个编号，总数量只记录一次，请核对后保存${info.strainNote}。`
          : info.batchNo
            ? `预约消息已识别，请核对批次信息${info.strainNote}。`
            : `未识别到完整批次号，请手动补充${info.strainNote}。`,
      );
      void onTextRecognized(info.item, info.excludeId);
    } catch (error) {
      if (valid()) setNotice(error instanceof Error ? error.message : "本地识别失败，请重试。");
    }
  }

  function parseMessage() {
    if (!requireRooms() || recognition.reading) return Promise.resolve();
    const key = JSON.stringify([revision.current, draft.rawMessage, draft.id, roomNames, user.id, mode, editing]);
    if (localRequest.current?.key === key) return localRequest.current.promise;
    const promise = recognizeLocalMessage();
    localRequest.current = { key, promise };
    void promise.finally(() => {
      if (localRequest.current?.promise === promise) localRequest.current = null;
    });
    return promise;
  }

  async function aiParseMessage() {
    if (!requireRooms() || recognition.reading) return;
    const request = recognition.begin();
    if (!request) return;
    const startedRevision = revision.current;
    const isCurrentRequest = requests.begin();
    const valid = () => request.isCurrent() && isCurrentRequest() && startedRevision === revision.current;
    const images = recognition.snapshot();
    try {
      const response = await aiParseIntakeMessage(draft.rawMessage, roomNames, images, request.signal);
      if (!valid()) return;
      const evidence = response.recognition
        ? { ...response.recognition, images: draft.recognition?.images }
        : undefined;
      const info = await applyParsedMessage(
        { ...response.item, ...(evidence ? { recognition: evidence } : {}) },
        valid,
      );
      if (!info) return;
      if (info.multipleIacucs) {
        const message = "已保留全部编号，但包含不同 IACUC，请按项目拆分预约后保存。";
        setNotice(message);
        feedback.warning("请核对预约项目", message);
        return;
      }
      const tokens = response.usage?.total_tokens;
      const usageText = typeof tokens === "number" && tokens > 0 ? `，本次 AI 识别消耗 ${tokens} tokens` : "";
      setNotice("");
      feedback.info(
        "预约消息已识别（AI）",
        info.multipleIdentifiers
          ? `已识别同一预约的多个编号，总数量只记录一次，请核对后保存${usageText}${info.strainNote}。`
          : `请核对批次信息${usageText}${info.strainNote}。`,
      );
      void onTextRecognized(info.item, info.excludeId);
    } catch (error) {
      if (valid()) setNotice(error instanceof Error ? error.message : "AI 识别失败，请重试。");
    } finally {
      request.finish();
    }
  }

  return { parseMessage, aiParseMessage };
}
