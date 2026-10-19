import { randomUUID } from "node:crypto";
import type { Db } from "./client.js";
import { evaluateService } from "./findings.js";

/** A workflow run in storage form (see `toWorkflowRunRecord` in @releaselens/integrations). */
export interface WorkflowRunUpsert {
  externalId: string;
  workflowName: string;
  branch: string;
  commitSha: string;
  status: string;
  conclusion: string | null;
  startedAt: Date;
  completedAt: Date | null;
  url: string | null;
  providerUpdatedAt: Date;
}

/**
 * Inserts or updates one workflow run in a single statement.
 * - Repeated deliveries of the same event are no-ops (only strictly newer data wins).
 * - An event older than what is stored never overwrites it, so out-of-order
 *   webhooks cannot turn a completed run back into "in progress".
 * - Safe under concurrency: the database decides, not application code.
 * Returns true when the row was inserted or changed.
 */
export async function upsertWorkflowRun(
  db: Db,
  projectId: string,
  run: WorkflowRunUpsert,
  observedAt: Date,
): Promise<boolean> {
  const affected = await db.$executeRaw`
    INSERT INTO "WorkflowRun" (
      "id", "projectId", "externalId", "workflowName", "branch", "commitSha", "status",
      "conclusion", "startedAt", "completedAt", "url", "providerUpdatedAt", "observedAt"
    ) VALUES (
      ${randomUUID()}, ${projectId}, ${run.externalId}, ${run.workflowName}, ${run.branch},
      ${run.commitSha}, ${run.status}, ${run.conclusion}, ${run.startedAt}, ${run.completedAt},
      ${run.url}, ${run.providerUpdatedAt}, ${observedAt}
    )
    ON CONFLICT ("projectId", "externalId") DO UPDATE SET
      "workflowName" = EXCLUDED."workflowName",
      "branch" = EXCLUDED."branch",
      "commitSha" = EXCLUDED."commitSha",
      "status" = EXCLUDED."status",
      "conclusion" = EXCLUDED."conclusion",
      "startedAt" = EXCLUDED."startedAt",
      "completedAt" = EXCLUDED."completedAt",
      "url" = EXCLUDED."url",
      "providerUpdatedAt" = EXCLUDED."providerUpdatedAt",
      "observedAt" = EXCLUDED."observedAt"
    WHERE "WorkflowRun"."providerUpdatedAt" IS NULL
       OR "WorkflowRun"."providerUpdatedAt" < EXCLUDED."providerUpdatedAt"`;
  return affected > 0;
}

export type IntegrationStatus = "connected" | "suspended" | "disconnected";

/** Providers that sync on a schedule and keep a sync status. */
export type SyncedProvider = "GITHUB" | "AZURE_CONTAINER_APPS";

/** Records a successful sync: data is fresh and the last error is cleared. */
export async function recordSyncSuccess(
  db: Db,
  projectId: string,
  at: Date,
  provider: SyncedProvider = "GITHUB",
): Promise<void> {
  await db.integration.upsert({
    where: { projectId_provider: { projectId, provider } },
    create: {
      projectId,
      provider,
      status: "connected",
      lastAttemptAt: at,
      lastSuccessfulSyncAt: at,
    },
    update: {
      status: "connected",
      lastAttemptAt: at,
      lastSuccessfulSyncAt: at,
      lastErrorKind: null,
    },
  });
}

/** Records a failed sync. The last successful time is kept, so data ages and becomes stale. */
export async function recordSyncFailure(
  db: Db,
  projectId: string,
  at: Date,
  errorKind: string,
  provider: SyncedProvider = "GITHUB",
): Promise<void> {
  await db.integration.upsert({
    where: { projectId_provider: { projectId, provider } },
    create: { projectId, provider, lastAttemptAt: at, lastErrorKind: errorKind },
    update: { lastAttemptAt: at, lastErrorKind: errorKind },
  });
}

export async function setGithubIntegrationStatus(
  db: Db,
  projectIds: string[],
  status: IntegrationStatus,
): Promise<void> {
  if (projectIds.length === 0) return;
  await db.integration.updateMany({
    where: { projectId: { in: projectIds }, provider: "GITHUB" },
    data: { status },
  });
}

/** Re-runs diagnostics for every service and environment in a project. */
export async function evaluateProject(
  db: Db,
  projectId: string,
  evaluatedAt: Date,
): Promise<number> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { services: true, environments: true },
  });
  let findings = 0;
  for (const service of project.services) {
    for (const environment of project.environments) {
      const result = await evaluateService(db, {
        serviceId: service.id,
        environmentId: environment.id,
        evaluatedAt,
      });
      findings += result.findings.length;
    }
  }
  return findings;
}
