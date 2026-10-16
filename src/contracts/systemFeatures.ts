export const SYSTEM_FEATURE_KEYS = [
  "intake",
  "quarantine",
  "cages",
  "animal",
  "billing",
  "technical-services",
  "settlement",
] as const;

export type SystemFeatureKey = (typeof SYSTEM_FEATURE_KEYS)[number];

export type SystemFeatureFlags = Record<SystemFeatureKey, boolean>;

export interface SystemFeatures {
  enabled: SystemFeatureFlags;
  updatedAt: string | null;
}

export interface SystemFeaturesResponse {
  item: SystemFeatures;
}

export const DEFAULT_SYSTEM_FEATURE_FLAGS: SystemFeatureFlags = {
  intake: true,
  quarantine: true,
  cages: true,
  animal: true,
  billing: true,
  "technical-services": true,
  settlement: true,
};
