import type { Confidence, Provider, Severity } from "@releaselens/contracts";
import type {
  Confidence as DbConfidence,
  FindingState as DbFindingState,
  Provider as DbProvider,
  Severity as DbSeverity,
} from "./generated/prisma/client.js";

// Contract values are lowercase strings; Prisma enum keys are uppercase.
// These maps are the only place the two meet.

export const PROVIDER_TO_DB = {
  github: "GITHUB",
  "azure-container-apps": "AZURE_CONTAINER_APPS",
  "health-probe": "HEALTH_PROBE",
  prisma: "PRISMA",
} as const satisfies Record<Provider, DbProvider>;

export const PROVIDER_FROM_DB = {
  GITHUB: "github",
  AZURE_CONTAINER_APPS: "azure-container-apps",
  HEALTH_PROBE: "health-probe",
  PRISMA: "prisma",
} as const satisfies Record<DbProvider, Provider>;

export const SEVERITY_TO_DB = {
  info: "INFO",
  warning: "WARNING",
  high: "HIGH",
  critical: "CRITICAL",
} as const satisfies Record<Severity, DbSeverity>;

export const SEVERITY_FROM_DB = {
  INFO: "info",
  WARNING: "warning",
  HIGH: "high",
  CRITICAL: "critical",
} as const satisfies Record<DbSeverity, Severity>;

export const CONFIDENCE_TO_DB = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
} as const satisfies Record<Confidence, DbConfidence>;

export const CONFIDENCE_FROM_DB = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const satisfies Record<DbConfidence, Confidence>;

export type FindingState = "open" | "acknowledged" | "resolved";

export const FINDING_STATE_FROM_DB = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
} as const satisfies Record<DbFindingState, FindingState>;

/** ISO timestamp without a `.000` millisecond suffix, for readable output. */
export function iso(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}
