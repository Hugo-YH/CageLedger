import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IntakeBatch, IntakeBatchListItem } from "../../../api/contracts";
import { useIntakeBatchDetail } from "../../../api/intake";

/** Capture full edit data only after the user opens a record; late results never reopen it. */
export function useIntakeEditorRead(roomsReady: boolean, onLoaded: (item: IntakeBatch) => void, scope: string) {
  const [pending, setPending] = useState<{ item: IntakeBatchListItem; scope: string } | null>(null);
  const target = pending?.scope === scope ? pending.item : null;
  const cancel = useCallback(() => setPending(null), []);
  const query = useIntakeBatchDetail(target?.id || "");
  const load = useRef(onLoaded);
  useLayoutEffect(() => {
    load.current = onLoaded;
  }, [onLoaded]);
  useEffect(() => {
    setPending((current) => (current && current.scope !== scope ? null : current));
  }, [scope]);
  useEffect(() => {
    if (!target || !roomsReady || query.isFetching || query.isError || query.data?.item.id !== target.id) return;
    load.current(query.data.item);
    setPending(null);
  }, [target, roomsReady, query.isFetching, query.isError, query.data]);
  return {
    target,
    begin: (item: IntakeBatchListItem) => setPending({ item, scope }),
    cancel,
    error: query.isError ? query.error : null,
    retry: () => void query.refetch(),
  };
}
