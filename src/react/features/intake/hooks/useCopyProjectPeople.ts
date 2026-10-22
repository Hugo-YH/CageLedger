import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useRef, useState } from "react";

import type { IntakeBatch } from "../../../api/contracts";
import { fetchIacucSearch } from "../../../api/iacuc";
import { queryKeys } from "../../../api/queryKeys";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import { copyTextToClipboard } from "../../../utils/clipboard";

export function useCopyProjectPeople() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const latest = useLatestRequest();
  const busy = useRef(false);
  const [copyingId, setCopyingId] = useState("");

  async function copy(item: Pick<IntakeBatch, "id" | "iacuc">) {
    if (busy.current) return;
    const code = item.iacuc.trim().toUpperCase();
    if (!code) {
      void message.warning("该批次缺少 IACUC 编号，无法查询项目汇总表。");
      return;
    }
    busy.current = true;
    setCopyingId(item.id);
    const isCurrent = latest.begin();
    try {
      const result = await client.fetchQuery({
        queryKey: queryKeys.iacucSearch(code, 80),
        queryFn: ({ signal }) => fetchIacucSearch(code, 80, signal),
        staleTime: 0,
      });
      if (!isCurrent()) return;
      const matches = result.items.filter((project) => project.iacuc.trim().toUpperCase() === code);
      if (!matches.length) throw new Error(`项目汇总表中未找到 ${code}，未复制。`);
      const people = matches.map((project) => ({
        pi: (project.pi || "").replace(/[\t\r\n]+/g, "").trim(),
        owner: (project.owner || "").replace(/[\t\r\n]+/g, "").trim(),
      }));
      if (people.some(({ pi, owner }) => !pi || !owner || pi === "-" || owner === "-")) {
        throw new Error("项目汇总表的项目负责人或实验负责人未填写完整，未复制。");
      }
      const texts = new Set(people.map(({ pi, owner }) => `${pi}组${owner}`));
      if (texts.size !== 1 || (result.count ?? result.items.length) > result.items.length) {
        throw new Error("项目汇总表中有多条匹配记录，请核对负责人信息后再复制。");
      }
      const text = [...texts][0];
      const copied = await copyTextToClipboard(text);
      if (!isCurrent()) return;
      if (copied) void message.success(`已复制：${text}`);
      else void message.error("复制失败，请允许浏览器访问剪贴板后重试。");
    } catch (error) {
      if (isCurrent()) {
        void message.error(error instanceof Error ? error.message : "读取项目汇总表失败，请重试。");
      }
    } finally {
      busy.current = false;
      if (isCurrent()) setCopyingId("");
    }
  }

  return { copy, copyingId };
}
