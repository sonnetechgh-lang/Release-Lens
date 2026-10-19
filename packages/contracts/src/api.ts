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
  /** connected, or suspended/disconnected when the GitHub App lost access. */
  status: "connected" | "suspended" | "disconnected";
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorKind: string | null;
}

/**
 * How this server reads Azure: `off` (targets are saved but not read), `simulated`
 * (recorded responses, no Azure account needed), or `azure` (the real Azure API).
 */
export type AzureMode = "off" | "simulated" | "azure";

/** An Azure Container App that runs one service in one environment. */
export interface DeploymentTargetItem {
  id: string;
  provider: Provider;
  service: { slug: string; name: string };
  environment: { slug: string; name: string };
  subscriptionId: string;
  resourceGroup: string;
  containerApp: string;
  /** Container whose image identifies the release, when the app runs several. */
  containerName: string | null;
  /** Link to the app in the Azure portal. */
  portalUrl: string;
  /** When ReleaseLens last read a revision of this app, or null if it never has. */
  lastObservedAt: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  role: Role;
  services: { slug: string; name: string }[];
  environments: { slug: string; name: string; releaseBranch: string }[];
  integrations: IntegrationStatus[];
  deploymentTargets: DeploymentTargetItem[];
  azureMode: AzureMode;
}

export interface CreateDeploymentTargetRequest {
  service: string;
  environment: string;
  subscriptionId: string;
  resourceGroup: string;
  containerApp: string;
  containerName?: string;
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
  /** Share of traffic (0–100) the revision received when last observed, if the provider reports it. */
  trafficWeight: number | null;
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

export interface GithubRepositoryOption {
  id: number;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  /** Slug of the project already connected to this repository in this organization. */
  connectedProject: string | null;
}

export interface GithubInstallationOption {
  installationId: number;
  account: string;
  accountType: string;
  suspended: boolean;
  repositories: GithubRepositoryOption[];
  /** Error category when the repositories could not be listed. */
  error: string | null;
}

export interface GithubSetupResponse {
  appConfigured: boolean;
  /** Link to install the GitHub App on an account, when the app slug is configured. */
  installUrl: string | null;
  installations: GithubInstallationOption[];
}

export interface CreateProjectRequest {
  installationId: number;
  repositoryId: number;
  /** Defaults to the repository's default branch. */
  releaseBranch?: string;
  /** Only runs of this workflow count as releases. All workflows count if omitted. */
  deployWorkflowName?: string;
  /** Defaults to "Production". */
  environmentName?: string;
}

export interface CreateProjectResponse {
  org: { slug: string; name: string };
  slug: string;
}
