import {
  Prisma,
  evaluateProject,
  recordSyncSuccess,
  setGithubIntegrationStatus,
  upsertWorkflowRun,
  type Db,
} from "@releaselens/db";
import {
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  WorkflowRunEventSchema,
  toWorkflowRunRecord,
  type GithubInstallation,
} from "@releaselens/integrations";
import type { WorkerDeps } from "../deps.js";

export type DeliveryOutcome = "processed" | "ignored" | "skipped" | "failed";

/** Raised for payloads that will never process successfully; the job is not retried. */
export class InvalidPayloadError extends Error {
  override readonly name = "InvalidPayloadError";
}

async function upsertInstallation(db: Db, installation: GithubInstallation): Promise<string> {
  const data = {
    accountLogin: installation.account?.login ?? "unknown",
    accountType: installation.account?.type ?? "unknown",
    repositorySelection: installation.repository_selection ?? null,
    suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
  };
  const row = await db.githubInstallation.upsert({
    where: { installationId: BigInt(installation.id) },
    create: { installationId: BigInt(installation.id), ...data },
    update: { ...data, deletedAt: null },
  });
  return row.id;
}

async function projectIdsForInstallation(db: Db, installationId: number): Promise<string[]> {
  const projects = await db.project.findMany({
    where: { githubInstallation: { installationId: BigInt(installationId) } },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}

async function handleWorkflowRun(deps: WorkerDeps, payload: unknown): Promise<DeliveryOutcome> {
  const parsed = WorkflowRunEventSchema.safeParse(payload);
  if (!parsed.success)
    throw new InvalidPayloadError("workflow_run payload does not match the expected shape");
  const event = parsed.data;
  if (event.installation === undefined) return "ignored";

  // A run belongs to a project only if both the repository and the installation match.
  const projects = await deps.db.project.findMany({
    where: {
      githubRepositoryId: BigInt(event.repository.id),
      githubInstallation: { installationId: BigInt(event.installation.id), deletedAt: null },
    },
    select: { id: true },
  });
  if (projects.length === 0) return "ignored"; // repository not connected to any project

  const record = toWorkflowRunRecord(event.workflow_run);
  const now = deps.now();
  for (const { id } of projects) {
    await upsertWorkflowRun(deps.db, id, record, now);
    await recordSyncSuccess(deps.db, id, now);
    await evaluateProject(deps.db, id, now);
  }
  return "processed";
}

async function handleInstallation(deps: WorkerDeps, payload: unknown): Promise<DeliveryOutcome> {
  const parsed = InstallationEventSchema.safeParse(payload);
  if (!parsed.success)
    throw new InvalidPayloadError("installation payload does not match the expected shape");
  const { action, installation } = parsed.data;
  const { db } = deps;

  await upsertInstallation(db, installation);
  const projectIds = await projectIdsForInstallation(db, installation.id);

  switch (action) {
    case "deleted":
      await db.githubInstallation.update({
        where: { installationId: BigInt(installation.id) },
        data: { deletedAt: deps.now() },
      });
      await setGithubIntegrationStatus(db, projectIds, "disconnected");
      break;
    case "suspend":
      await setGithubIntegrationStatus(db, projectIds, "suspended");
      break;
    case "unsuspend":
    case "created":
    case "new_permissions_accepted":
      await setGithubIntegrationStatus(db, projectIds, "connected");
      for (const id of projectIds) await deps.enqueueReconcile(id);
      break;
    default:
      return "ignored";
  }
  return "processed";
}

async function handleInstallationRepositories(
  deps: WorkerDeps,
  payload: unknown,
): Promise<DeliveryOutcome> {
  const parsed = InstallationRepositoriesEventSchema.safeParse(payload);
  if (!parsed.success) {
    throw new InvalidPayloadError(
      "installation_repositories payload does not match the expected shape",
    );
  }
  const removed = (parsed.data.repositories_removed ?? []).map((r) => BigInt(r.id));
  if (parsed.data.action !== "removed" || removed.length === 0) return "ignored";

  const projects = await deps.db.project.findMany({
    where: {
      githubRepositoryId: { in: removed },
      githubInstallation: { installationId: BigInt(parsed.data.installation.id) },
    },
    select: { id: true },
  });
  await setGithubIntegrationStatus(
    deps.db,
    projects.map((p) => p.id),
    "disconnected",
  );
  return "processed";
}

/**
 * Processes one stored webhook delivery. Idempotent: a delivery that was already
 * handled is skipped, and every write is an upsert, so retries are safe.
 */
export async function processDelivery(
  deps: WorkerDeps,
  deliveryId: string,
): Promise<DeliveryOutcome> {
  const { db } = deps;
  const delivery = await db.webhookDelivery.findUnique({ where: { deliveryId } });
  if (delivery === null || delivery.status === "processed" || delivery.status === "ignored") {
    return "skipped";
  }
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: { attempts: { increment: 1 } },
  });

  let outcome: DeliveryOutcome;
  try {
    switch (delivery.event) {
      case "workflow_run":
        outcome = await handleWorkflowRun(deps, delivery.payload);
        break;
      case "installation":
        outcome = await handleInstallation(deps, delivery.payload);
        break;
      case "installation_repositories":
        outcome = await handleInstallationRepositories(deps, delivery.payload);
        break;
      default:
        // ping, push, workflow_job, deployment_status, ...: accepted but not used yet.
        outcome = "ignored";
    }
  } catch (error) {
    if (error instanceof InvalidPayloadError) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        // The payload is kept for debugging; retention deletes old deliveries.
        data: { status: "failed", lastErrorKind: "invalid-payload", processedAt: deps.now() },
      });
      deps.log.warn({ deliveryId, event: delivery.event }, "Webhook payload rejected");
    }
    throw error;
  }

  // The payload is no longer needed once handled; dropping it limits retained data.
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: outcome, processedAt: deps.now(), lastErrorKind: null, payload: Prisma.DbNull },
  });
  deps.log.info({ deliveryId, event: delivery.event, outcome }, "Webhook delivery handled");
  return outcome;
}
