import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { SessionResponse } from "../../contracts/session";
import { queryKeys } from "./queryKeys";

export function mutationActor(client: QueryClient) {
  return client.getQueryData<SessionResponse>(queryKeys.session)?.user;
}

export function isMutationActorCurrent(client: QueryClient, actor: ReturnType<typeof mutationActor>) {
  return mutationActor(client) === actor;
}

/** Publish a complete write response only after the old target read is cancelled. */
export async function publishMutationItem<T>(
  client: QueryClient,
  actor: ReturnType<typeof mutationActor>,
  key: QueryKey,
  response: T,
) {
  if (!isMutationActorCurrent(client, actor)) return false;
  await client.cancelQueries({ queryKey: key, exact: true });
  if (!isMutationActorCurrent(client, actor)) return false;
  client.setQueryData<T>(key, response);
  return true;
}
