import {
  evaluateProject,
  recordSyncFailure,
  recordSyncSuccess,
  setGithubIntegrationStatus,
  upsertWorkflowRun,
} from "@releaselens/db";
import { ProviderError, toWorkflowRunRecord } from "@releaselens/integrations";
import type { WorkerDeps } from "../deps.js";

export type ReconcileOutcome =
  | { status: "synced"; runs: number; changed: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; errorKind: string };

/**
 * Pulls recent workflow runs from GitHub so missed or delayed webhooks are filled
 * in. Failures are recorded as an error category on the integration; the last
 * successful sync time is left alone, so the data visibly goes stale instead of
 * looking healthy.
 */
export async function reconcileProject(
  deps: WorkerDeps,
  projectId: string,
): Promise<ReconcileOutcome> {
  const { db } = deps;
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { githubInstallation: true },
  });
  const installation = project?.githubInstallation;
  if (
    project === null ||
    installation === null ||
    installation === undefined ||
    project.repository === null
  ) {
    return { status: "skipped", reason: "not connected to GitHub" };
  }
  if (installation.deletedAt !== null) {
    await setGithubIntegrationStatus(db, [projectId], "disconnected");
    return { status: "skipped", reason: "installation removed" };
  }
  if (installation.suspendedAt !== null) {
    await setGithubIntegrationStatus(db, [projectId], "suspended");
    return { status: "skipped", reason: "installation suspended" };
  }
  if (deps.github === null) return { status: "skipped", reason: "GitHub App not configured" };

  const now = deps.now();
  try {
    const runs = await deps.github.listWorkflowRuns(
      Number(installation.installationId),
      project.repository,
    );
    let changed = 0;
    for (const run of runs) {
      if (await upsertWorkflowRun(db, projectId, toWorkflowRunRecord(run), now)) changed++;
    }
    await recordSyncSuccess(db, projectId, now);
    await evaluateProject(db, projectId, now);
    return { status: "synced", runs: runs.length, changed };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    await recordSyncFailure(db, projectId, now, error.kind);
    // Diagnostics still run, so stale GitHub data shows up as an evidence finding.
    await evaluateProject(db, projectId, now);
    deps.log.warn({ projectId, errorKind: error.kind }, "GitHub reconciliation failed");
    if (error.retryable) throw error;
    return { status: "failed", errorKind: error.kind };
  }
}

/** Queues a reconcile for every project connected to GitHub. */
export async function reconcileAll(deps: WorkerDeps): Promise<number> {
  const projects = await deps.db.project.findMany({
    where: { githubInstallationId: { not: null } },
    select: { id: true },
  });
  for (const { id } of projects) await deps.enqueueReconcile(id);
  return projects.length;
}
