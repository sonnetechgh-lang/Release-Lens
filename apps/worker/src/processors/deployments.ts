import {
  applyRevisions,
  evaluateProject,
  recordSyncFailure,
  recordSyncSuccess,
} from "@releaselens/db";
import { ProviderError } from "@releaselens/integrations";
import type { WorkerDeps } from "../deps.js";

export type DeploymentSyncOutcome =
  | { status: "synced"; targets: number; revisions: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; errorKind: string; failedTargets: number };

/**
 * Reads every deployment target of a project and stores the revisions.
 * - Targets are read one by one; a failing target does not stop the others.
 * - Any failure is recorded as an error category on the project's Azure integration,
 *   and the last successful sync time is left alone, so the data visibly goes stale.
 * - Diagnostics run either way. Retryable failures (timeouts, throttling, Azure
 *   errors) are rethrown so the job is retried with backoff, honoring Retry-After.
 */
export async function syncDeploymentTargets(
  deps: WorkerDeps,
  projectId: string,
): Promise<DeploymentSyncOutcome> {
  const { db, log } = deps;
  const targets = await db.deploymentTarget.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  if (targets.length === 0) return { status: "skipped", reason: "no deployment targets" };
  if (deps.deploymentTarget === null) {
    return { status: "skipped", reason: "Azure provider is off" };
  }

  const now = deps.now();
  let revisions = 0;
  const failures: ProviderError[] = [];
  for (const target of targets) {
    try {
      const observed = await deps.deploymentTarget.listRevisions({
        subscriptionId: target.subscriptionId,
        resourceGroup: target.resourceGroup,
        name: target.resourceName,
        ...(target.containerName === null ? {} : { containerName: target.containerName }),
      });
      revisions += await applyRevisions(
        db,
        { serviceId: target.serviceId, environmentId: target.environmentId },
        observed,
        now,
      );
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      failures.push(error);
      log.warn(
        { projectId, targetId: target.id, errorKind: error.kind },
        "Reading deployment target failed",
      );
    }
  }

  const first = failures[0];
  if (first === undefined) {
    await recordSyncSuccess(db, projectId, now, "AZURE_CONTAINER_APPS");
  } else {
    await recordSyncFailure(db, projectId, now, first.kind, "AZURE_CONTAINER_APPS");
  }
  await evaluateProject(db, projectId, now);

  if (first === undefined) return { status: "synced", targets: targets.length, revisions };
  const retryable = failures.find((f) => f.retryable);
  if (retryable !== undefined) throw retryable;
  return { status: "failed", errorKind: first.kind, failedTargets: failures.length };
}

/** Queues a sync for every project with at least one deployment target. */
export async function syncAllDeploymentTargets(deps: WorkerDeps): Promise<number> {
  const projects = await deps.db.project.findMany({
    where: { deploymentTargets: { some: {} } },
    select: { id: true },
  });
  for (const { id } of projects) await deps.enqueueDeploymentSync(id);
  return projects.length;
}
