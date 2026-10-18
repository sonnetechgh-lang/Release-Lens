import {
  parseSnapshot,
  type DiagnosticSnapshot,
  type DiagnosticSnapshotInput,
  type DeploymentEvidence,
  type HealthCheckEvidence,
  type SyncStatusEvidence,
  type WorkflowRunEvidence,
} from "@releaselens/contracts";
import type { Db } from "./client.js";
import { PROVIDER_FROM_DB, iso } from "./mapping.js";

export interface SnapshotScope {
  serviceId: string;
  environmentId: string;
  /** The "now" for the evaluation. Evidence observed after it is ignored. */
  evaluatedAt: Date;
}

const MAX_RUNS = 100;
const MAX_HEALTH_CHECKS = 100;
const HEALTH_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Evidence IDs are prefixed by type so they stay readable in reports. */
export const evidenceId = {
  run: (id: string) => `run:${id}`,
  deployment: (id: string) => `deploy:${id}`,
  health: (id: string) => `hc:${id}`,
  sync: (id: string) => `sync:${id}`,
};

/**
 * Builds the diagnostics input for one service in one environment from stored
 * evidence. The result is validated with the shared schema, so the rules engine
 * only ever sees well-formed data.
 */
export async function loadSnapshot(db: Db, scope: SnapshotScope): Promise<DiagnosticSnapshot> {
  const { serviceId, environmentId, evaluatedAt } = scope;

  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
    include: { project: { include: { integrations: true } } },
  });
  const environment = await db.environment.findUniqueOrThrow({ where: { id: environmentId } });
  if (environment.projectId !== service.projectId) {
    throw new Error("Service and environment belong to different projects");
  }
  const project = service.project;

  const [runs, deployment, healthChecks] = await Promise.all([
    db.workflowRun.findMany({
      where: { projectId: project.id, startedAt: { lte: evaluatedAt } },
      orderBy: { startedAt: "desc" },
      take: MAX_RUNS,
    }),
    db.deployment.findFirst({
      where: { serviceId, environmentId, isActive: true, observedAt: { lte: evaluatedAt } },
      orderBy: { activeSince: "desc" },
    }),
    db.healthCheckResult.findMany({
      where: {
        serviceId,
        environmentId,
        observedAt: { lte: evaluatedAt, gte: new Date(evaluatedAt.getTime() - HEALTH_LOOKBACK_MS) },
      },
      orderBy: { observedAt: "desc" },
      take: MAX_HEALTH_CHECKS,
    }),
  ]);

  const input: DiagnosticSnapshotInput = {
    schemaVersion: 1,
    evaluatedAt: iso(evaluatedAt),
    project: { id: project.slug, name: project.name },
    service: { id: service.slug, name: service.name },
    environment: {
      id: environment.slug,
      name: environment.name,
      releaseBranch: environment.releaseBranch,
      deployWorkflowName: environment.deployWorkflowName ?? undefined,
    },
    policy: (environment.policy ?? {}) as DiagnosticSnapshotInput["policy"],
    workflowRuns: runs.map((run) => ({
      id: evidenceId.run(run.id),
      observedAt: iso(run.observedAt),
      url: run.url ?? undefined,
      provider: "github" as const,
      runId: run.externalId,
      workflowName: run.workflowName,
      branch: run.branch,
      commitSha: run.commitSha,
      status: run.status as WorkflowRunEvidence["status"],
      conclusion: (run.conclusion ?? undefined) as WorkflowRunEvidence["conclusion"],
      startedAt: iso(run.startedAt),
      completedAt: run.completedAt ? iso(run.completedAt) : undefined,
      producedImageDigest: run.producedImageDigest ?? undefined,
    })),
    deployment: deployment
      ? {
          id: evidenceId.deployment(deployment.id),
          observedAt: iso(deployment.observedAt),
          url: deployment.url ?? undefined,
          provider: "azure-container-apps" as const,
          revisionName: deployment.revisionName,
          imageReference: deployment.imageReference,
          imageDigest: deployment.imageDigest ?? undefined,
          commitSha: deployment.commitSha ?? undefined,
          commitShaSource: (deployment.commitShaSource ??
            undefined) as DeploymentEvidence["commitShaSource"],
          activeSince: iso(deployment.activeSince),
          providerStatus: deployment.providerStatus as DeploymentEvidence["providerStatus"],
        }
      : undefined,
    healthChecks: healthChecks.map((check) => ({
      id: evidenceId.health(check.id),
      observedAt: iso(check.observedAt),
      provider: "health-probe" as const,
      endpoint: check.endpoint,
      outcome: check.outcome as HealthCheckEvidence["outcome"],
      httpStatus: check.httpStatus ?? undefined,
      durationMs: check.durationMs,
      failureKind: (check.failureKind ?? undefined) as HealthCheckEvidence["failureKind"],
    })),
    syncStatus: project.integrations.map((integration) => ({
      id: evidenceId.sync(integration.id),
      provider: PROVIDER_FROM_DB[integration.provider],
      lastAttemptAt: integration.lastAttemptAt ? iso(integration.lastAttemptAt) : undefined,
      lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt
        ? iso(integration.lastSuccessfulSyncAt)
        : undefined,
      lastErrorKind: (integration.lastErrorKind ??
        undefined) as SyncStatusEvidence["lastErrorKind"],
    })),
  };

  // String columns are checked here, so bad stored values fail loudly instead of
  // reaching the rules engine.
  const result = parseSnapshot(input);
  if (!result.success) {
    throw new Error(`Stored evidence for service ${serviceId} is invalid:\n${result.error}`);
  }
  return result.snapshot;
}
