import type { SessionUser } from "./session";

export interface IacucIndexItem {
  iacuc: string;
  project: string;
  pi: string;
  owner: string;
  funding: string;
  projectStartDate?: string;
  projectEndDate?: string;
}

export type ManagedUser = SessionUser;

export interface PrincipalIdentity {
  pi: string;
  principalType: "pi" | "independent";
  freeCageAllowance: number;
  updatedAt: string;
}

export interface IacucIndexStatus {
  count: number;
  updatedAt: string;
  source: string;
}

export interface AuditEvent {
  id: string;
  message: string;
  actorDisplayName: string;
  action: string;
  entityType: string;
  at: string;
}

export interface SystemInfo {
  name: string;
  title: string;
  version: string;
  organization: string;
  department: string;
  developer: string;
  contactEmail: string;
  license: string;
  copyright: string;
  repositoryUrl: string;
  revisionShort: string;
}

export interface SystemUpdateStatus {
  currentVersion?: string | null;
  latestVersion?: string | null;
  latestUrl?: string | null;
  latestMessage?: string | null;
  updateAvailable?: boolean | null;
  checkedAt?: string;
  disabled?: boolean;
}
