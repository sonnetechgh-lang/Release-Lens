import type { Db } from "@releaselens/db";
import type { DeploymentTargetProvider, GithubAppClient } from "@releaselens/integrations";
import type { DeploymentSyncJob, GithubReconcileJob, GithubWebhookJob } from "@releaselens/jobs";
import type { Queue } from "bullmq";
import type { Logger } from "pino";

/** The subset of the GitHub client the worker uses. Tests pass a fake. */
export type GithubApi = Pick<GithubAppClient, "listWorkflowRuns">;

/** Everything a processor needs. Processors never reach for globals, so they are easy to test. */
export interface WorkerDeps {
  db: Db;
  /** Null when no GitHub App is configured; webhooks still work, reconciliation is skipped. */
  github: GithubApi | null;
  /** Null when AZURE_PROVIDER_MODE is off; deployment targets are then not read. */
  deploymentTarget: Pick<DeploymentTargetProvider, "listRevisions"> | null;
  log: Logger;
  now: () => Date;
  enqueueDelivery: (deliveryId: string) => Promise<void>;
  enqueueReconcile: (projectId: string) => Promise<void>;
  enqueueDeploymentSync: (projectId: string) => Promise<void>;
}

export type Queues = {
  webhooks: Queue<GithubWebhookJob>;
  reconcile: Queue<GithubReconcileJob>;
  deploymentSync: Queue<DeploymentSyncJob>;
};
