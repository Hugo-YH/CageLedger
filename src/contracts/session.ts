export type UserRole = "admin" | "room_admin";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  roomIds: string[];
  active: boolean;
}

export interface SessionResponse {
  user: SessionUser | null;
}
