import {
  hashKey,
  skipToken,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from "../api/session";

type ListRead<T> = Pick<UseQueryResult<T>, "data" | "isError" | "isFetching" | "isSuccess" | "isPlaceholderData">;

/** Keep only a successful query identity in UI state; response objects stay in Query. */
export function useRetainedListData<T>(query: ListRead<T>, queryKey: QueryKey, resourceScope: string) {
  const client = useQueryClient();
  // Observe the already-owned session without introducing an authentication request.
  const { data: session } = useSession(false);
  const actor = session?.user;
  const actorScope = hashKey([actor?.id, actor?.role, [...(actor?.roomIds || [])].sort()]);
  const scope = hashKey([resourceScope, actorScope]);
  const requestedHash = hashKey(queryKey);
  const [displayed, setDisplayed] = useState({
    queryKey,
    hash: requestedHash,
    scope,
    actorScope,
    awaitingActor: false,
  });
  const sameActor = displayed.actorScope === actorScope;
  const actorReady = sameActor && !displayed.awaitingActor;
  const sameScope = displayed.scope === scope;
  const observedKey = sameScope ? displayed.queryKey : queryKey;
  const cached = client.getQueryCache().find<T>({ queryKey: observedKey, exact: true });
  // Reuse the original query function for this exact key, never the new page's
  // closure. A disabled observer pins the entry but never starts a second read.
  const previous = useQuery<T>({
    queryKey: observedKey,
    queryFn: cached?.options.queryFn ?? skipToken,
    enabled: false,
    refetchInterval: false,
  });
  useEffect(() => {
    if (!sameActor) {
      if (!actor) return;
      // A role/room change can leave successful responses under otherwise equal
      // keys. Reset this resource's pages before accepting the new actor scope.
      // resetQueries clears data synchronously and refetches active observers.
      void client.resetQueries({ queryKey: queryKey.slice(0, 1) });
      setDisplayed({ queryKey, hash: requestedHash, scope, actorScope, awaitingActor: true });
      return;
    }
    if (!query.isSuccess || query.isPlaceholderData) return;
    setDisplayed((current) =>
      current.scope === scope && current.hash === requestedHash && !current.awaitingActor
        ? current
        : { queryKey, hash: requestedHash, scope, actorScope, awaitingActor: false },
    );
  }, [actor, actorScope, client, query.isSuccess, query.isPlaceholderData, queryKey, requestedHash, sameActor, scope]);

  const current = !actorReady || (!sameScope && query.isPlaceholderData) ? undefined : query.data;
  const data = current ?? (sameScope && actorReady ? previous.data : undefined);
  return {
    data,
    loading: !data && !query.isError,
    retained: Boolean(data && (query.isError || query.isPlaceholderData || !query.data)),
    blocked: !actorReady || query.isError || query.isPlaceholderData || !query.data,
  };
}
