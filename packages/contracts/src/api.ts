import type { Confidence, Severity } from "./common.js";
import type { Provider } from "./evidence.js";
import type { FindingCategory, Statement } from "./finding.js";

// Response shapes of the ReleaseLens HTTP API, shared by the API and the dashboard.
// All timestamps are ISO 8601 strings in UTC.

export type AppMode = "demo" | "standard";
export type Role = "owner" | "viewer";
export type FindingState = "open" | "acknowledged" | "resolved";

export interface MeResponse {
  mode: AppMode;
  user: {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    isDemo: boolean;
  };
  memberships: { org: { slug: string; name: string }; role: Role }[];
}

export interface AuthConfigResponse {
  mode: AppMode;
  githubEnabled: boolean;
  demoLoginEnabled: boolean;
}

export type SeverityCounts = Record<Severity, number>;

export interface ProjectSummary {
  org: { slug: string; name: string };
  slug: string;
  name: string;
  description: string | null;
  repository: string | null;
  serviceCount: number;
  environmentCount: number;
  openFindings: SeverityCounts;
  /** Highest severity among open findings, or null when there are none. */
  worstSeverity: Severity | null;
  lastEvaluatedAt: string | null;
}

export interface IntegrationStatus {
  provider: Provider;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorKind: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  role: Role;
  services: { slug: string; name: string }[];
  environments: { slug: string; name: string; releaseBranch: string }[];
  integrations: IntegrationStatus[];
}

export interface DeploymentItem {
  id: string;
  service: { slug: string; name: string };
  environment: { slug: string; name: string };
  revisionName: string;
  imageReference: string;
  imageDigest: string | null;
  /** Commit built into the image, when a workflow run produced this digest or metadata names it. */
  commitSha: string | null;
  workflowRun: { runId: string; url: string | null } | null;
  activeSince: string;
  providerStatus: string;
  isActive: boolean;
  observedAt: string;
}

export interface WorkflowRunItem {
  id: string;
  runId: string;
  workflowName: string;
  branch: string;
  commitSha: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  url: string | null;
}

export interface FindingItem {
  id: string;
  fingerprint: string;
  ruleId: string;
  ruleVersion: number;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  state: FindingState;
  title: string;
  service: { slug: string; name: string };
  environment: { slug: string; name: string };
  facts: Statement[];
  inferences: Statement[];
  unknowns: string[];
  nextSteps: string[];
  evidenceIds: string[];
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
}

export interface ApiError {
  statusCode: number;
  message: string;
  requestId?: string;
}
