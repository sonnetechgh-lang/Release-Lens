import { Queue, type ConnectionOptions } from "bullmq";

/** Queue names shared by the API (producer) and the worker (consumer). */
export const QUEUES = {
  githubWebhooks: "github-webhooks",
  githubReconcile: "github-reconcile",
} as const;

/** The job only carries the delivery ID; the payload stays in PostgreSQL. */
export interface GithubWebhookJob {
  deliveryId: string;
}

/** Reconcile one project, or every GitHub project when projectId is omitted. */
export interface GithubReconcileJob {
  projectId?: string;
}

/** Name of the custom backoff strategy the worker registers. */
export const PROVIDER_BACKOFF = "provider";

export function redisConnection(url: string): ConnectionOptions {
  // BullMQ workers need maxRetriesPerRequest: null so blocking commands are not aborted.
  return { url, maxRetriesPerRequest: null };
}

const retained = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export function createWebhookQueue(redisUrl: string): Queue<GithubWebhookJob> {
  return new Queue<GithubWebhookJob>(QUEUES.githubWebhooks, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 6,
      backoff: { type: PROVIDER_BACKOFF, delay: 2000 },
      ...retained,
    },
  });
}

export function createReconcileQueue(redisUrl: string): Queue<GithubReconcileJob> {
  return new Queue<GithubReconcileJob>(QUEUES.githubReconcile, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: PROVIDER_BACKOFF, delay: 5000 },
      ...retained,
    },
  });
}

/**
 * Enqueues a stored delivery. The job ID is the delivery ID, so enqueueing the
 * same delivery twice (GitHub redelivery, sweeper) creates only one job.
 */
export async function enqueueWebhook(
  queue: Queue<GithubWebhookJob>,
  deliveryId: string,
): Promise<void> {
  await queue.add("delivery", { deliveryId }, { jobId: `delivery-${deliveryId}` });
}

export async function enqueueReconcile(
  queue: Queue<GithubReconcileJob>,
  projectId: string,
): Promise<void> {
  // Deduplicate while a reconcile for the same project is already waiting.
  await queue.add("project", { projectId }, { deduplication: { id: `reconcile-${projectId}` } });
}

/**
 * Exponential backoff with full jitter, or the provider's own wait time when it
 * gave one (rate limits).
 */
export function providerBackoff(attemptsMade: number, error: unknown, baseMs = 2000): number {
  const retryAfter = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  if (typeof retryAfter === "number" && retryAfter > 0) return Math.min(retryAfter, 60 * 60 * 1000);
  const cap = Math.min(baseMs * 2 ** Math.max(0, attemptsMade - 1), 10 * 60 * 1000);
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}
