import { createContext, useContext } from "react";

import type { ManagedUser } from "../../../api/contracts";

export type UserSavePayload = {
  id?: string;
  user: Partial<ManagedUser> & { password?: string };
  expectedUpdatedAt?: string;
};

export const UserSaveActionContext = createContext<(pendingId: string, payload: UserSavePayload) => Promise<void>>(() =>
  Promise.reject(new Error("UserSaveProvider is required")),
);
export const UserSaveStatusContext = createContext<string | null>(null);

export function useUserSaveAction() {
  return useContext(UserSaveActionContext);
}
