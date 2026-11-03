import type { RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { IntakeBatch } from "../../../../contracts/intake";
import type { SessionUser } from "../../../../contracts/session";
import { intakePeople } from "../../../../domain/intakePeople";
import { abbreviateSupplier, normalizeIntakeBatch, parseIntakeMessage } from "../../../../domain/intake";
import { aiParseIntakeMessage, standardizeIntakeStrain } from "../../../api/intake";
import { fetchIacucSearch } from "../../../api/iacuc";
import { queryKeys } from "../../../api/queryKeys";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import type { useIntakeRecognition } from "./useIntakeRecognition";

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

  async function applyParsedMessage(parsed: Partial<IntakeBatch>, valid: () => boolean) {
    const normalized = normalizeIntakeBatch(
      { ...parsed, supplier: abbreviateSupplier(parsed.supplier || ""), rawMessage: draft.rawMessage },
      roomNames,
    );
    const normalizedCode = String(parsed.iacuc || "")
      .trim()
      .toUpperCase();
    let match: { project?: string; pi?: string; owner?: string } | undefined;
    if (normalizedCode) {
      const result = await queryClient.ensureQueryData({
        queryKey: queryKeys.iacucSearch(normalizedCode, 1),
        queryFn: ({ signal }) => fetchIacucSearch(normalizedCode, 1, signal),
        staleTime: 5 * 60_000,
      });
      match = result.items.find(
        (candidate) =>
          String(candidate.iacuc || "")
            .trim()
            .toUpperCase() === normalizedCode,
      );
    }
    if (!valid()) return null;
    const isEditingSavedBatch = mode === "batches" && editing;
    const item = normalizeIntakeBatch(
      {
        ...draft,
        ...normalized,
        husbandryMonths: normalized.husbandryMonths ?? null,
        id: isEditingSavedBatch ? draft.id : String(normalized.id || draft.id),
        receiverName: normalized.receiverName || (isEditingSavedBatch ? draft.receiverName : user.displayName),
        vetPhone: normalized.vetPhone || (isEditingSavedBatch ? draft.vetPhone : user.phone),
        project: match?.project || normalized.project,
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
    };
  }

  async function parseMessage() {
    if (!requireRooms()) return;
    const startedRevision = revision.current;
    const isCurrentRequest = requests.begin();
    const valid = () => isCurrentRequest() && startedRevision === revision.current;
    const hasNewImages = recognition.reading || recognition.snapshot().length > 0;
    try {
      let parsed = parseIntakeMessage(draft.rawMessage, user.displayName, roomNames);
      if (parsed.strainRaw && parsed.strainStandard === parsed.strainRaw) {
        const result = await standardizeIntakeStrain(parsed.strainRaw);
        if (!valid()) return;
        parsed = { ...parsed, strainStandard: result.item || parsed.strainStandard };
      }
      const info = await applyParsedMessage(parsed, valid);
      if (!info) return;
      setNotice("");
      feedback.info(
        "预约消息已识别",
        info.batchNo
          ? `预约消息已识别，请核对批次信息${info.strainNote}。`
          : `未识别到完整批次号，请手动补充${info.strainNote}。`,
      );
      if (!hasNewImages) void onTextRecognized(info.item, info.excludeId);
    } catch (error) {
      if (valid()) setNotice(error instanceof Error ? error.message : "本地识别失败，请重试。");
    }
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
      const tokens = response.usage?.total_tokens;
      const usageText = typeof tokens === "number" && tokens > 0 ? `，本次 AI 识别消耗 ${tokens} tokens` : "";
      setNotice("");
      feedback.info("预约消息已识别（AI）", `${usageText}${info.strainNote}，请核对批次信息。`);
      if (!images.length) void onTextRecognized(info.item, info.excludeId);
    } catch (error) {
      if (valid()) setNotice(error instanceof Error ? error.message : "AI 识别失败，请重试。");
    } finally {
      request.finish();
    }
  }

  return { parseMessage, aiParseMessage };
}
