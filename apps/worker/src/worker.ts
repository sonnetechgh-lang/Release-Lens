import { createDb } from "@releaselens/db";
import {
  AzureContainerAppsProvider,
  GithubAppClient,
  createAzureCredential,
  createFixtureFetch,
  simulatedCredential,
  type DeploymentTargetProvider,
} from "@releaselens/integrations";
import {
  QUEUES,
  createDeploymentSyncQueue,
  createReconcileQueue,
  createWebhookQueue,
  enqueueDeploymentSync,
  enqueueReconcile,
  enqueueWebhook,
  providerBackoff,
  redisConnection,
  type DeploymentSyncJob,
  type GithubReconcileJob,
  type GithubWebhookJob,
} from "@releaselens/jobs";
import { redact } from "@releaselens/redact";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import pino, { type Logger } from "pino";
import type { WorkerConfig } from "./config.js";
import type { WorkerDeps } from "./deps.js";
import { syncAllDeploymentTargets, syncDeploymentTargets } from "./processors/deployments.js";
import { reconcileAll, reconcileProject } from "./processors/reconcile.js";
import { sweep } from "./processors/sweep.js";
import { InvalidPayloadError, processDelivery } from "./processors/webhook.js";

export function createLogger(config: Pick<WorkerConfig, "env" | "logLevel">): Logger {
  return pino({
    level: config.logLevel,
    base: { service: "releaselens-worker" },
    formatters: { log: (object) => redact(object) },
    serializers: { err: (err: unknown) => redact(err) },
    ...(config.env === "development"
      ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
      : {}),
  });
}

const SCHEDULE_RECONCILE_ALL = "reconcile-all";
const SCHEDULE_SWEEP = "sweep";
const SCHEDULE_DEPLOYMENT_SYNC_ALL = "deployment-sync-all";

/** The deployment target reader for the configured Azure mode, or null when it is off. */
export async function createDeploymentTarget(
  azure: WorkerConfig["azure"],
): Promise<DeploymentTargetProvider | null> {
  if (azure.mode === "off") return null;
  if (azure.mode === "simulated") {
    return new AzureContainerAppsProvider({
      credential: simulatedCredential,
      fetch: createFixtureFetch(azure.fixturesDir),
      timeoutMs: azure.requestTimeoutMs,
    });
  }
  return new AzureContainerAppsProvider({
    credential: await createAzureCredential(),
    timeoutMs: azure.requestTimeoutMs,
  });
}

export interface RunningWorker {
  deps: WorkerDeps;
  close(): Promise<void>;
}

/**
 * Starts the queue consumers and the recurring schedules.
 * Retries use exponential backoff with jitter, or the provider's own wait time
 * for rate limits. Invalid payloads are not retried.
 */
export async function startWorker(
  config: WorkerConfig,
  log = createLogger(config),
): Promise<RunningWorker> {
  const db = createDb(config.databaseUrl);
  const webhookQueue = createWebhookQueue(config.redisUrl);
  const reconcileQueue = createReconcileQueue(config.redisUrl);
  const deploymentSyncQueue = createDeploymentSyncQueue(config.redisUrl);

  const deps: WorkerDeps = {
    db,
    github: config.githubApp === null ? null : new GithubAppClient(config.githubApp),
    deploymentTarget: await createDeploymentTarget(config.azure),
    log,
    now: () => new Date(),
    enqueueDelivery: (deliveryId) => enqueueWebhook(webhookQueue, deliveryId),
    enqueueReconcile: (projectId) => enqueueReconcile(reconcileQueue, projectId),
    enqueueDeploymentSync: (projectId) => enqueueDeploymentSync(deploymentSyncQueue, projectId),
  };

  const settings = {
    backoffStrategy: (attemptsMade: number, _type?: string, err?: Error) =>
      providerBackoff(attemptsMade, err),
  };

  const webhookWorker = new Worker<GithubWebhookJob>(
    QUEUES.githubWebhooks,
    async (job: Job<GithubWebhookJob>) => {
      try {
        return await processDelivery(deps, job.data.deliveryId);
      } catch (error) {
        if (error instanceof InvalidPayloadError) throw new UnrecoverableError(error.message);
        throw error;
      }
    },
    { connection: redisConnection(config.redisUrl), concurrency: config.concurrency, settings },
  );

  const reconcileWorker = new Worker<GithubReconcileJob>(
    QUEUES.githubReconcile,
    async (job: Job<GithubReconcileJob>) => {
      if (job.name === SCHEDULE_SWEEP) return sweep(deps);
      if (job.data.projectId === undefined) return reconcileAll(deps);
      return reconcileProject(deps, job.data.projectId);
    },
    { connection: redisConnection(config.redisUrl), concurrency: config.concurrency, settings },
  );

  const deploymentSyncWorker = new Worker<DeploymentSyncJob>(
    QUEUES.deploymentSync,
    async (job: Job<DeploymentSyncJob>) => {
      if (job.data.projectId === undefined) return syncAllDeploymentTargets(deps);
      return syncDeploymentTargets(deps, job.data.projectId);
    },
    { connection: redisConnection(config.redisUrl), concurrency: config.concurrency, settings },
  );

  for (const worker of [webhookWorker, reconcileWorker, deploymentSyncWorker]) {
    worker.on("failed", (job, err) => {
      log.warn(
        { queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade, err },
        "Job failed",
      );
    });
    worker.on("error", (err) => {
      log.error({ queue: worker.name, err }, "Worker error");
    });
  }

  await reconcileQueue.upsertJobScheduler(
    SCHEDULE_RECONCILE_ALL,
    { every: config.reconcileIntervalMs },
    { name: SCHEDULE_RECONCILE_ALL, data: {} },
  );
  await reconcileQueue.upsertJobScheduler(
    SCHEDULE_SWEEP,
    { every: 60_000 },
    { name: SCHEDULE_SWEEP, data: {} },
  );
  // With Azure off, remove a schedule left over from an earlier configuration.
  if (deps.deploymentTarget === null) {
    await deploymentSyncQueue.removeJobScheduler(SCHEDULE_DEPLOYMENT_SYNC_ALL);
  } else {
    await deploymentSyncQueue.upsertJobScheduler(
      SCHEDULE_DEPLOYMENT_SYNC_ALL,
      { every: config.azure.syncIntervalMs },
      { name: SCHEDULE_DEPLOYMENT_SYNC_ALL, data: {} },
    );
  }

  log.info(
    {
      githubApp: config.githubApp !== null,
      reconcileEveryMs: config.reconcileIntervalMs,
      azureMode: config.azure.mode,
      azureSyncEveryMs: config.azure.syncIntervalMs,
    },
    "Worker started",
  );

  return {
    deps,
    async close() {
      await Promise.all([
        webhookWorker.close(),
        reconcileWorker.close(),
        deploymentSyncWorker.close(),
      ]);
      await Promise.all([
        webhookQueue.close(),
        reconcileQueue.close(),
        deploymentSyncQueue.close(),
      ]);
      await db.$disconnect();
    },
  };
}
